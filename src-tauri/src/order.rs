//! 上下層順序用的分數索引字串，格式與 `fractional-indexing` 套件相同，
//! 既有資料的 `zKey` 可以直接沿用。

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

fn integer_length(head: u8) -> Option<usize> {
    match head {
        b'a'..=b'z' => Some((head - b'a') as usize + 2),
        b'A'..=b'Z' => Some((b'Z' - head) as usize + 2),
        _ => None,
    }
}

fn increment_integer(integer: &[u8]) -> Option<Vec<u8>> {
    let mut digits = integer[1..].to_vec();
    for index in (0..digits.len()).rev() {
        let value = DIGITS.iter().position(|digit| *digit == digits[index])?;
        if value + 1 < DIGITS.len() {
            digits[index] = DIGITS[value + 1];
            let mut next = vec![integer[0]];
            next.extend(digits);
            return Some(next);
        }
        digits[index] = DIGITS[0];
    }

    // 所有位數都進位了，換下一個開頭字元並調整長度。
    let head = match integer[0] {
        b'z' => return None,
        b'Z' => b'a',
        other => other + 1,
    };
    let length = integer_length(head)? - 1;
    digits.resize(length, DIGITS[0]);
    let mut next = vec![head];
    next.extend(digits);
    Some(next)
}

/// 產生排在 `top` 之後的鍵；`top` 為 None 時回傳第一個鍵。
pub fn key_after(top: Option<&str>) -> Result<String, String> {
    let Some(top) = top else {
        return Ok("a0".to_string());
    };
    let bytes = top.as_bytes();
    let invalid = || format!("invalid order key: {top}");
    let length = bytes.first().copied().and_then(integer_length).ok_or_else(invalid)?;
    let integer = bytes.get(..length).ok_or_else(invalid)?;
    let next = increment_integer(integer).ok_or_else(invalid)?;
    String::from_utf8(next).map_err(|_| invalid())
}

/// `low` 與 `high` 之間的小數字串。`high` 為 None 表示沒有上限。
fn midpoint(low: &[u8], high: Option<&[u8]>) -> Option<Vec<u8>> {
    if let Some(high) = high {
        // 較短的一邊視為後面補 0，否則 `V` 與 `V0V` 之間會算出超過上限的鍵。
        let common = high
            .iter()
            .enumerate()
            .take_while(|(index, digit)| low.get(*index).copied().unwrap_or(DIGITS[0]) == **digit)
            .count();
        if common > 0 {
            let mut key = high[..common].to_vec();
            key.extend(midpoint(low.get(common..).unwrap_or_default(), Some(&high[common..]))?);
            return Some(key);
        }
    }
    let position = |digit: u8| DIGITS.iter().position(|candidate| *candidate == digit);
    let from = match low.first() {
        Some(digit) => position(*digit)?,
        None => 0,
    };
    let to = match high.and_then(|high| high.first()) {
        Some(digit) => position(*digit)?,
        None => DIGITS.len(),
    };
    if to - from > 1 {
        return Some(vec![DIGITS[(from + to).div_ceil(2)]]);
    }
    if let Some(high) = high.filter(|high| high.len() > 1) {
        return Some(high[..1].to_vec());
    }
    let mut key = vec![DIGITS[from]];
    key.extend(midpoint(low.get(1..).unwrap_or_default(), None)?);
    Some(key)
}

/// 排在 `before` 之後、`after` 之前的鍵，任一邊可以省略。
/// 鍵的格式是純小數，不能和 `key_after` 的鍵混用。
pub fn key_between(before: Option<&str>, after: Option<&str>) -> Result<String, String> {
    let low = before.unwrap_or("").as_bytes();
    let high = after.map(str::as_bytes);
    let key = midpoint(low, high).ok_or("invalid order key")?;
    String::from_utf8(key).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_javascript_package() {
        let cases = [
            ("a0", "a1"),
            ("a9", "aA"),
            ("aZ", "aa"),
            ("az", "b00"),
            ("b0z", "b10"),
            ("bzz", "c000"),
            ("Zz", "a0"),
            ("Yzz", "Z0"),
            ("a0V", "a1"),
            ("a1V", "a2"),
        ];
        for (top, expected) in cases {
            assert_eq!(key_after(Some(top)).unwrap(), expected, "after {top}");
        }
        assert_eq!(key_after(None).unwrap(), "a0");
    }

    #[test]
    fn rejects_invalid_keys() {
        assert!(key_after(Some("")).is_err());
        assert!(key_after(Some("!")).is_err());
        assert!(key_after(Some("b0")).is_err());
    }
    #[test]
    fn key_between_stays_strictly_between_neighbours() {
        let mut low = "V".to_string();
        let high = "W".to_string();
        for _ in 0..200 {
            let next = key_between(Some(&low), Some(&high)).unwrap();
            assert!(low < next && next < high, "{low} {next} {high}");
            low = next;
        }
        let mut high = "W".to_string();
        let low = "V".to_string();
        for _ in 0..200 {
            let next = key_between(Some(&low), Some(&high)).unwrap();
            assert!(low < next && next < high, "{low} {next} {high}");
            high = next;
        }
    }

    #[test]
    fn key_between_handles_open_ends() {
        let first = key_between(None, Some("V")).unwrap();
        assert!(first.as_str() < "V");
        let last = key_between(Some("V"), None).unwrap();
        assert!(last.as_str() > "V");
        assert!(!key_between(None, None).unwrap().is_empty());
    }
}
