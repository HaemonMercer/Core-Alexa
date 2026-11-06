//! 卡片的區塊與 Markdown 互換。
//!
//! 卡片用 Writer 的區塊編輯，區塊才是資料來源。`content` 從區塊產生，白板、Library 和
//! Note References 繼續讀這份 Markdown。舊卡片第一次開啟時反過來從 `content` 建立區塊。
//! 語法要和 `src/markdown/parse.ts` 一致。

use super::types::WriterBlock;
use std::collections::HashMap;

const CALLOUT_MARK: &str = "💡 ";
const OPEN_MARK: &str = "▾ ";
const CLOSED_MARK: &str = "▸ ";
const MAX_LEADING_SPACES: usize = 3;
const MIN_FENCE: usize = 3;
const MAX_NUMBER_DIGITS: usize = 9;
const TAB_WIDTH: usize = 4;

#[derive(Debug, Clone, PartialEq)]
pub(super) struct CardBlock {
    pub(super) kind: String,
    pub(super) text: String,
    pub(super) indent: u32,
    pub(super) checked: bool,
    pub(super) collapsed: bool,
    pub(super) language: Option<String>,
    pub(super) table: Option<Vec<Vec<String>>>,
}

impl CardBlock {
    fn new(kind: &str, text: String, indent: u32) -> Self {
        Self { kind: kind.to_string(), text, indent, checked: false, collapsed: false, language: None, table: None }
    }
}

/// 圖片區塊要畫在白板上時需要的資料，放在圖片筆記裡。
pub(super) struct ImageFile {
    pub(super) file: String,
    pub(super) width: f64,
    pub(super) height: f64,
}

struct Item {
    lead: usize,
    marker: String,
    ordered: bool,
    /// `None` 表示標記後面沒有內容。
    spaces: Option<usize>,
    body: String,
}

fn is_blank(line: &str) -> bool {
    line.chars().all(|char| char == ' ' || char == '\t')
}

fn leading_spaces(line: &str) -> usize {
    line.bytes().take_while(|byte| *byte == b' ').count()
}

/// 拿掉最多三個前導空白，多了就不是區塊語法。
fn after_lead(line: &str) -> Option<&str> {
    let lead = leading_spaces(line);
    (lead <= MAX_LEADING_SPACES).then(|| &line[lead..])
}

fn heading(line: &str) -> Option<(usize, String)> {
    let rest = after_lead(line)?;
    let level = rest.bytes().take_while(|byte| *byte == b'#').count();
    if level == 0 || level > 6 {
        return None;
    }
    let text = &rest[level..];
    if !(text.is_empty() || text.starts_with([' ', '\t'])) {
        return None;
    }
    let text = text.trim();
    // 結尾的 `##` 是裝飾，前面要有空白才算。
    let without_tail = text.trim_end_matches('#');
    let text = if without_tail.is_empty() {
        ""
    } else if without_tail.ends_with([' ', '\t']) {
        without_tail.trim_end()
    } else {
        text
    };
    Some((level, text.to_string()))
}

fn fence(line: &str) -> Option<(char, usize, String)> {
    let rest = after_lead(line)?;
    let mark = rest.chars().next().filter(|char| matches!(char, '`' | '~'))?;
    let size = rest.chars().take_while(|char| *char == mark).count();
    let info = rest[size..].trim();
    (size >= MIN_FENCE && !info.contains('`')).then(|| (mark, size, info.to_string()))
}

fn closes_fence(line: &str, mark: char, size: usize) -> bool {
    after_lead(line).is_some_and(|rest| {
        let run = rest.chars().take_while(|char| *char == mark).count();
        run >= size && is_blank(&rest[run..])
    })
}

fn is_rule(line: &str) -> bool {
    let Some(rest) = after_lead(line) else { return false };
    let Some(mark) = rest.chars().next().filter(|char| matches!(char, '-' | '*' | '_')) else { return false };
    rest.chars().all(|char| char == mark || char == ' ' || char == '\t')
        && rest.chars().filter(|char| *char == mark).count() >= MIN_FENCE
}

fn quote_body(line: &str) -> Option<&str> {
    let rest = after_lead(line)?.strip_prefix('>')?;
    Some(rest.strip_prefix(' ').unwrap_or(rest))
}

fn item(line: &str) -> Option<Item> {
    let lead = leading_spaces(line);
    let rest = after_lead(line)?;
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let (marker_len, ordered) = if digits > 0 {
        if digits > MAX_NUMBER_DIGITS || !matches!(rest.as_bytes().get(digits), Some(b'.' | b')')) {
            return None;
        }
        (digits + 1, true)
    } else {
        if !matches!(rest.as_bytes().first(), Some(b'-' | b'*' | b'+')) {
            return None;
        }
        (1, false)
    };
    let after = &rest[marker_len..];
    let spaces = leading_spaces(after);
    if !after.is_empty() && spaces == 0 {
        return None;
    }
    Some(Item {
        lead,
        marker: rest[..marker_len].to_string(),
        ordered,
        spaces: (!after.is_empty()).then_some(spaces),
        body: after[spaces..].to_string(),
    })
}

fn expand_tabs(line: &str) -> String {
    let start = line.find(|char| char != ' ' && char != '\t').unwrap_or(line.len());
    format!("{}{}", line[..start].replace('\t', &" ".repeat(TAB_WIDTH)), &line[start..])
}

fn table_cells(line: &str) -> Vec<String> {
    let line = line.trim();
    let line = line.strip_prefix('|').unwrap_or(line);
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut chars = line.chars().peekable();
    while let Some(char) = chars.next() {
        match char {
            '\\' if chars.peek() == Some(&'|') => {
                cell.push('|');
                chars.next();
            }
            '|' => cells.push(std::mem::take(&mut cell).trim().to_string()),
            _ => cell.push(char),
        }
    }
    // 沒有結尾的 `|` 時，最後一段也是一格。
    if !cell.trim().is_empty() {
        cells.push(cell.trim().to_string());
    }
    cells
}

fn is_table_divider(line: &str) -> bool {
    let cells = table_cells(line);
    line.trim().starts_with('|')
        && !cells.is_empty()
        && cells.iter().all(|cell| {
            let dashes = cell.trim_start_matches(':').trim_end_matches(':');
            !dashes.is_empty() && dashes.chars().all(|char| char == '-')
        })
}

fn table_starts(lines: &[String], index: usize) -> bool {
    lines[index].trim().starts_with('|') && lines.get(index + 1).is_some_and(|next| is_table_divider(next))
}

fn starts_block(lines: &[String], index: usize) -> bool {
    let line = &lines[index];
    if heading(line).is_some()
        || fence(line).is_some()
        || is_rule(line)
        || quote_body(line).is_some()
        || table_starts(lines, index)
    {
        return true;
    }
    // 空項目與非 1 開頭的編號不打斷段落，一般文字才不會意外變成清單。
    item(line).is_some_and(|item| {
        !item.body.is_empty() && (!item.ordered || item.marker.starts_with('1') && item.marker.len() == 2)
    })
}

fn first_filled(lines: &[String], from: usize) -> usize {
    (from..lines.len()).find(|index| !is_blank(&lines[*index])).unwrap_or(lines.len())
}

/// 這一行要接在項目後面：縮排夠深，或是子清單。
fn continues_item(line: &str, width: usize) -> bool {
    let indent = leading_spaces(line);
    indent >= width || (indent >= 2 && item(&line[indent..]).is_some())
}

/// 項目開頭的標記。回傳區塊類型、拿掉標記後的文字與是否打勾或收合。
fn item_kind(ordered: bool, body: &str) -> (&'static str, String, bool) {
    if ordered {
        return ("number", body.to_string(), false);
    }
    for (mark, kind, flag) in [
        ("[ ] ", "todo", false),
        ("[x] ", "todo", true),
        ("[X] ", "todo", true),
        (OPEN_MARK, "toggle", false),
        (CLOSED_MARK, "toggle", true),
    ] {
        if let Some(rest) = body.strip_prefix(mark) {
            return (kind, rest.to_string(), flag);
        }
        if body == mark.trim_end() {
            return (kind, String::new(), flag);
        }
    }
    ("bullet", body.to_string(), false)
}

fn parse_list(lines: &[String], start: usize, level: u32, out: &mut Vec<CardBlock>) -> usize {
    let ordered = item(&lines[start]).is_some_and(|first| first.ordered);
    let mut index = start;
    while index < lines.len() {
        let Some(current) = item(&lines[index]).filter(|found| !is_rule(&lines[index]) && found.ordered == ordered) else {
            break;
        };
        let spaces = current.spaces.unwrap_or(1);
        let width = current.lead + current.marker.len() + if spaces > 4 { 1 } else { spaces };
        let first = if spaces > 4 { format!("{}{}", " ".repeat(spaces - 1), current.body) } else { current.body };
        let (kind, text, flag) = item_kind(ordered, &first);
        let mut body = vec![text];
        index += 1;
        loop {
            let next = first_filled(lines, index);
            if next == lines.len() {
                break;
            }
            let line = expand_tabs(&lines[next]);
            if !continues_item(&line, width) {
                break;
            }
            body.extend(std::iter::repeat_n(String::new(), next - index));
            body.push(line[leading_spaces(&line).min(width)..].to_string());
            index = next + 1;
        }

        let mut inside = Vec::new();
        parse_blocks(&body, level + 1, &mut inside);
        let mut head = CardBlock::new(kind, String::new(), level);
        if inside.first().is_some_and(|block| block.kind == "paragraph") {
            head.text = inside.remove(0).text;
        }
        head.checked = kind == "todo" && flag;
        head.collapsed = kind == "toggle" && flag;
        out.push(head);
        out.append(&mut inside);

        // 項目之間的空行不結束清單。
        let next = first_filled(lines, index);
        let goes_on = next < lines.len() && item(&lines[next]).is_some_and(|found| found.ordered == ordered) && !is_rule(&lines[next]);
        if !goes_on {
            break;
        }
        index = next;
    }
    index
}

fn parse_blocks(lines: &[String], level: u32, out: &mut Vec<CardBlock>) {
    let mut count = 0;
    let mut index = 0;
    while index < lines.len() {
        let line = &lines[index];

        if is_blank(line) {
            // 區塊之間固定一個空行，多出來的空行是使用者留的空段落。
            let next = first_filled(lines, index);
            let empty = (next - index).saturating_sub(usize::from(count > 0));
            for _ in 0..empty {
                out.push(CardBlock::new("paragraph", String::new(), level));
                count += 1;
            }
            index = next;
            continue;
        }

        count += 1;
        if let Some((mark, size, language)) = fence(line) {
            let mut body = Vec::new();
            index += 1;
            while index < lines.len() && !closes_fence(&lines[index], mark, size) {
                body.push(lines[index].as_str());
                index += 1;
            }
            index += 1;
            let mut block = CardBlock::new("code", body.join("\n"), level);
            block.language = (!language.is_empty()).then_some(language);
            out.push(block);
        } else if let Some((depth, text)) = heading(line) {
            out.push(CardBlock::new(&format!("h{}", depth.min(3)), text, level));
            index += 1;
        } else if is_rule(line) {
            out.push(CardBlock::new("divider", String::new(), level));
            index += 1;
        } else if quote_body(line).is_some() {
            let mut body = Vec::new();
            while let Some(text) = lines.get(index).and_then(|line| quote_body(line)) {
                body.push(text.to_string());
                index += 1;
            }
            let mut inside = Vec::new();
            parse_blocks(&body, level, &mut inside);
            for mut block in inside {
                if block.kind == "paragraph" && block.text.is_empty() {
                    continue;
                }
                if block.kind == "paragraph" {
                    match block.text.strip_prefix(CALLOUT_MARK) {
                        Some(text) => {
                            block.text = text.to_string();
                            block.kind = "callout".to_string();
                        }
                        None => block.kind = "quote".to_string(),
                    }
                }
                out.push(block);
            }
        } else if item(line).is_some() {
            index = parse_list(lines, index, level, out);
        } else if table_starts(lines, index) {
            let mut rows = vec![table_cells(line)];
            index += 2;
            while lines.get(index).is_some_and(|row| row.trim().starts_with('|')) {
                rows.push(table_cells(&lines[index]));
                index += 1;
            }
            let width = rows.iter().map(Vec::len).max().unwrap_or(1);
            for row in &mut rows {
                row.resize(width, String::new());
            }
            let mut block = CardBlock::new("table", String::new(), level);
            block.table = Some(rows);
            out.push(block);
        } else {
            let mut body = vec![line.as_str()];
            index += 1;
            while index < lines.len() && !is_blank(&lines[index]) && !starts_block(lines, index) {
                body.push(lines[index].as_str());
                index += 1;
            }
            out.push(CardBlock::new("paragraph", body.join("\n"), level));
        }
    }
}

pub(super) fn blocks_from_markdown(markdown: &str) -> Vec<CardBlock> {
    let source = markdown.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<String> = source.split('\n').map(str::to_string).collect();
    let mut blocks = Vec::new();
    parse_blocks(&lines, 0, &mut blocks);
    blocks
}

/// 行首的文字長得像區塊語法時要跳脫，白板才不會畫成標題或清單。
fn escape_line_start(line: &str) -> String {
    if is_rule(line) {
        return format!("\\{line}");
    }
    let lead = leading_spaces(line);
    if lead > MAX_LEADING_SPACES {
        return line.to_string();
    }
    let rest = &line[lead..];
    let marked = heading(rest).is_some()
        || rest.starts_with('>')
        || rest.starts_with("```")
        || rest.starts_with("~~~")
        || item(rest).is_some_and(|found| !found.ordered);
    if marked {
        return format!("{}\\{rest}", " ".repeat(lead));
    }
    if item(rest).is_some() {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        return format!("{}{}\\{}", " ".repeat(lead), &rest[..digits], &rest[digits..]);
    }
    line.to_string()
}

fn safe_lines(text: &str) -> Vec<String> {
    text.split('\n').map(escape_line_start).collect()
}

fn is_list(kind: &str) -> bool {
    matches!(kind, "bullet" | "number" | "todo" | "toggle")
}

fn table_cell(text: &str) -> String {
    text.replace('\n', " ").replace('|', "\\|")
}

fn table_markdown(rows: &[Vec<String>]) -> String {
    let row_line = |row: &Vec<String>| format!("| {} |", row.iter().map(|cell| table_cell(cell)).collect::<Vec<_>>().join(" | "));
    let width = rows.first().map_or(0, Vec::len);
    let mut lines: Vec<String> = rows.iter().map(row_line).collect();
    lines.insert(1.min(lines.len()), format!("|{}", " --- |".repeat(width)));
    lines.join("\n")
}

fn code_markdown(text: &str, language: &str) -> String {
    let longest = text.split(|char| char != '`').map(str::len).max().unwrap_or(0).max(2);
    let fence = "`".repeat(longest + 1);
    format!("{fence}{language}\n{text}\n{fence}")
}

/// 百分比是使用者拖出來的圖片寬度，沒有就是原本大小。
fn image_markdown(image: &ImageFile, width: Option<f64>) -> String {
    let percent = width.map_or(String::new(), |width| format!("&p={}", width.round()));
    format!("![](media:{}?w={}&h={}{percent})", image.file, image.width.round(), image.height.round())
}

/// 項目標記和第一行以外的內容要對齊的寬度，放在一行行前面。
fn item_markdown(marker: &str, text: &str) -> String {
    let lines = safe_lines(text);
    let width = marker.split(' ').next().map_or(1, |first| first.chars().count());
    let indent = " ".repeat(width + 1);
    let body = lines.join(&format!("\n{indent}"));
    if body.is_empty() { marker.to_string() } else { format!("{marker} {body}") }
}

/// `None` 表示這個區塊畫不出來，例如圖片筆記已被刪除。
fn block_markdown(block: &WriterBlock, number: u32, images: &HashMap<String, ImageFile>) -> Option<String> {
    let quoted = |text: &str| text.split('\n').map(|line| format!("> {line}")).collect::<Vec<_>>().join("\n");
    Some(match block.kind.as_str() {
        "h1" | "h2" | "h3" => {
            let level = block.kind[1..].parse::<usize>().unwrap_or(1);
            format!("{} {}", "#".repeat(level), block.text.replace('\n', " ")).trim_end().to_string()
        }
        "bullet" => item_markdown("-", &block.text),
        "number" => item_markdown(&format!("{number}."), &block.text),
        "todo" => item_markdown(if block.checked { "- [x]" } else { "- [ ]" }, &block.text),
        "toggle" => item_markdown(if block.collapsed { "- ▸" } else { "- ▾" }, &block.text),
        "quote" => quoted(&block.text),
        "callout" => quoted(&format!("{CALLOUT_MARK}{}", block.text)),
        "code" => code_markdown(&block.text, block.language.as_deref().unwrap_or("")),
        "divider" => "---".to_string(),
        "table" => table_markdown(block.table.as_ref()?),
        "image" => image_markdown(images.get(block.note_id.as_ref()?)?, block.width),
        "paragraph" => safe_lines(&block.text).join("\n"),
        _ => return None,
    })
}

/// 把區塊排成 Markdown。子區塊對齊上層項目的內容；上層不是清單時，Markdown 沒有縮排，靠左。
pub(super) fn markdown_from_blocks(blocks: &[WriterBlock], images: &HashMap<String, ImageFile>) -> String {
    let last = blocks.iter().rposition(|block| block.kind != "paragraph" || !block.text.trim().is_empty());
    let Some(last) = last else { return String::new() };

    let mut output = String::new();
    let mut parents: Vec<(u32, usize)> = Vec::new();
    let mut counters: Vec<u32> = Vec::new();
    let mut previous: Option<&WriterBlock> = None;
    for block in &blocks[..=last] {
        let depth = block.indent as usize;
        counters.truncate(depth + 1);
        counters.resize(depth + 1, 0);
        counters[depth] = if block.kind == "number" { counters[depth] + 1 } else { 0 };
        let number = counters[depth];

        let Some(body) = block_markdown(block, number, images) else { continue };
        while parents.last().is_some_and(|(level, _)| *level >= block.indent) {
            parents.pop();
        }
        let column = parents.last().map_or(0, |(_, column)| *column);
        let pad = " ".repeat(column);
        if is_list(&block.kind) {
            let marker = body.split_whitespace().next().unwrap_or("-").chars().count();
            parents.push((block.indent, column + marker + 1));
        }

        if let Some(before) = previous {
            let after_blank = before.kind == "paragraph" && before.text.is_empty();
            let tight = is_list(&block.kind) && is_list(&before.kind) && !block.text.is_empty();
            output.push_str(if after_blank || tight { "\n" } else { "\n\n" });
        }
        let lines: Vec<String> = body
            .split('\n')
            .map(|line| if line.is_empty() { String::new() } else { format!("{pad}{line}") })
            .collect();
        output.push_str(&lines.join("\n"));
        previous = Some(block);
    }
    output
}
