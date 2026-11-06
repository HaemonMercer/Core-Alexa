//! 自動填充：從選取的格子推算接下來的內容。這裡只處理文字，不碰 Y.Doc。
//!
//! `offset` 是目標相對於第一個樣本的距離，往上或往左拖時是負的，同一套算法都適用。

use super::formula::{self, Value};
use std::time::{SystemTime, UNIX_EPOCH};

/// 依序循環的清單。比對時要完全相同。
const LISTS: [&[&str]; 13] = [
    &["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
    &["週一", "週二", "週三", "週四", "週五", "週六", "週日"],
    &["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
    &["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
    &["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
    &["第一季", "第二季", "第三季", "第四季"],
    &["Q1", "Q2", "Q3", "Q4"],
    &["春", "夏", "秋", "冬"],
    &["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"],
    &["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    &["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    &["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    &["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
];

/// 小數點後保留的位數，避免 0.1 累加出 0.30000000000000004。
const ROUND_DIGITS: i32 = 10;

#[derive(Debug, PartialEq)]
pub enum Filled {
    /// 推算出來的新內容。
    Text(String),
    /// 照抄第幾個樣本；公式的相對參照由呼叫端移動。
    Copy(usize),
}

/// 一列或一欄的樣本往下推。`samples` 是使用者看到的內容，公式以 `=` 開頭。
pub fn series(samples: &[String], offset: i64) -> Filled {
    let count = samples.len() as i64;
    let copy = Filled::Copy(offset.rem_euclid(count) as usize);
    if samples.iter().any(|text| text.starts_with('=') || text.trim().is_empty()) {
        return copy;
    }
    if let Some(numbers) = samples.iter().map(|text| number_of(text)).collect::<Option<Vec<f64>>>() {
        return if count < 2 { copy } else { Filled::Text(trend(&numbers, offset)) };
    }
    dates(samples, offset).or_else(|| list(samples, offset)).or_else(|| numbered(samples, offset)).unwrap_or(copy)
}

fn number_of(text: &str) -> Option<f64> {
    match formula::parse_literal(text) {
        Value::Number(number) => Some(number),
        _ => None,
    }
}

/// 最小平方法的直線，等差數列就是剛好落在線上。
fn trend(numbers: &[f64], offset: i64) -> String {
    let count = numbers.len() as f64;
    let mean_x = (count - 1.0) / 2.0;
    let mean_y = numbers.iter().sum::<f64>() / count;
    let (mut top, mut bottom) = (0.0, 0.0);
    for (index, number) in numbers.iter().enumerate() {
        let x = index as f64 - mean_x;
        top += x * (number - mean_y);
        bottom += x * x;
    }
    let value = mean_y + top / bottom * (offset as f64 - mean_x);
    let scale = 10f64.powi(ROUND_DIGITS);
    formula::format_general((value * scale).round() / scale)
}

/// 樣本之間的固定間距。只有一個樣本時走一步，間距不固定或不是整數時回傳 None。
fn even_step(values: &[i64]) -> Option<i64> {
    let [first, rest @ ..] = values else { return None };
    let Some(second) = rest.first() else { return Some(1) };
    let step = second - first;
    values.windows(2).all(|pair| pair[1] - pair[0] == step).then_some(step)
}

struct ParsedDate {
    days: i64,
    separator: char,
    padded: bool,
}

/// `2026-11-06`、`2026/1/5`。
fn parse_date(text: &str) -> Option<ParsedDate> {
    let separator = text.chars().find(|c| matches!(c, '-' | '/'))?;
    let parts: Vec<&str> = text.split(separator).collect();
    let [year, month, day] = parts[..] else { return None };
    if year.len() != 4 {
        return None;
    }
    let (y, m, d): (i64, i64, i64) = (year.parse().ok()?, month.parse().ok()?, day.parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=month_days(y, m)).contains(&d) {
        return None;
    }
    Some(ParsedDate { days: days_from_civil(y, m, d), separator, padded: month.len() == 2 && day.len() == 2 })
}

fn month_days(year: i64, month: i64) -> i64 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// 公曆日期換成 1970-01-01 起的天數。
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((month + 9) % 12) + 2) / 5 + day - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, doy - (153 * mp + 2) / 5 + 1)
}

fn format_date(days: i64, separator: char, padded: bool) -> String {
    let (year, month, day) = civil_from_days(days);
    if padded {
        format!("{year}{separator}{month:02}{separator}{day:02}")
    } else {
        format!("{year}{separator}{month}{separator}{day}")
    }
}

/// 今天的日期，給 `TODAY()`。
pub fn today() -> String {
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_secs() as i64);
    format_date(seconds.div_euclid(86_400), '-', true)
}

fn dates(samples: &[String], offset: i64) -> Option<Filled> {
    let parsed = samples.iter().map(|text| parse_date(text.trim())).collect::<Option<Vec<ParsedDate>>>()?;
    let days: Vec<i64> = parsed.iter().map(|date| date.days).collect();
    let step = even_step(&days)?;
    Some(Filled::Text(format_date(days[0] + step * offset, parsed[0].separator, parsed[0].padded)))
}

fn list(samples: &[String], offset: i64) -> Option<Filled> {
    LISTS.iter().find_map(|items| {
        let places = samples.iter().map(|text| items.iter().position(|item| item == text).map(|at| at as i64)).collect::<Option<Vec<i64>>>()?;
        let step = even_step(&places)?;
        let at = (places[0] + step * offset).rem_euclid(items.len() as i64);
        Some(Filled::Text(items[at as usize].to_string()))
    })
}

/// 拆開最後一段數字：`第3週` 是 (`第`, `3`, `週`)。
fn split_number(text: &str) -> Option<(&str, &str, &str)> {
    let end = text.char_indices().rev().find(|(_, c)| c.is_ascii_digit()).map(|(at, _)| at + 1)?;
    let start = text[..end].rfind(|c: char| !c.is_ascii_digit()).map_or(0, |at| at + text[at..].chars().next().map_or(1, char::len_utf8));
    Some((&text[..start], &text[start..end], &text[end..]))
}

/// `第1週`、`Item 2`、`A-007`。
fn numbered(samples: &[String], offset: i64) -> Option<Filled> {
    let parts = samples.iter().map(|text| split_number(text)).collect::<Option<Vec<_>>>()?;
    let (prefix, first, suffix) = parts[0];
    if parts.iter().any(|(before, _, after)| *before != prefix || *after != suffix) {
        return None;
    }
    let numbers = parts.iter().map(|(_, digits, _)| digits.parse().ok()).collect::<Option<Vec<i64>>>()?;
    let value = numbers[0] + even_step(&numbers)? * offset;
    if value < 0 {
        return None;
    }
    // `007` 的零要留著。
    let width = if first.starts_with('0') { first.len() } else { 0 };
    Some(Filled::Text(format!("{prefix}{value:0width$}{suffix}")))
}
