//! 試算表公式：解析與計算。這裡不碰 Y.Doc，只透過 `Layout`、`Cells` 認識表格。
//!
//! 使用者看到的是 `=SUM(A1:A5)`，存進文件的是 `=SUM(⟦列id|欄id⟧:⟦列id|欄id⟧)`。
//! 增刪列欄或多人同時編輯後參照仍然指向同一格，顯示時再換回當下的座標。
//! 被刪除的格子顯示成 `#REF!`。絕對參照的 `$` 記在代號最後：`⟦列id|欄id|cr⟧`。

pub const ERR_REF: &str = "#REF!";
pub const ERR_DIV: &str = "#DIV/0!";
pub const ERR_VALUE: &str = "#VALUE!";
pub const ERR_NAME: &str = "#NAME?";
pub const ERR_CIRCULAR: &str = "#CIRC!";
pub const ERR_NA: &str = "#N/A";
const ERR_SYNTAX: &str = "#ERROR!";

const OPEN: char = '⟦';
const CLOSE: char = '⟧';

trait RoundTo {
    fn pipe_round(self, up: bool) -> f64;
}

impl RoundTo for f64 {
    fn pipe_round(self, up: bool) -> f64 {
        if up { self.ceil() } else { self.floor() }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Empty,
    Number(f64),
    Text(String),
    Bool(bool),
    Error(&'static str),
}

pub trait Layout {
    /// 目前座標的穩定代號；格子不存在時回傳 None。
    fn locate(&self, table: Option<&str>, col: usize, row: usize) -> Option<String>;
    /// 穩定代號現在的座標，例如 `B3`、`表格2::B3`。格子已刪除時回傳 None。
    fn label(&self, token: &str) -> Option<String>;
}

pub trait Cells {
    fn value(&mut self, table: Option<&str>, col: usize, row: usize) -> Value;
}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Text(String),
    Name(String),
    Ref { table: Option<String>, col: usize, row: usize },
    Op(&'static str),
    Open,
    Close,
    Comma,
    Colon,
    Error(&'static str),
}

struct Spanned {
    token: Token,
    start: usize,
    end: usize,
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$' || c == '.'
}

/// `A1`、`$B$12`。欄和列都從 0 起算。
fn parse_ref(text: &str) -> Option<(usize, usize)> {
    let cleaned = text.replace('$', "").to_ascii_uppercase();
    let letters = cleaned.chars().take_while(|c| c.is_ascii_uppercase()).count();
    if letters == 0 || letters > 3 || letters == cleaned.len() {
        return None;
    }
    let (col_text, row_text) = cleaned.split_at(letters);
    if !row_text.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let row: usize = row_text.parse().ok()?;
    let col = col_text.bytes().fold(0usize, |total, b| total * 26 + (b - b'A') as usize + 1);
    row.checked_sub(1).map(|row| (col - 1, row))
}

pub fn col_label(index: usize) -> String {
    let mut index = index + 1;
    let mut label = String::new();
    while index > 0 {
        let rest = (index - 1) % 26;
        label.insert(0, (b'A' + rest as u8) as char);
        index = (index - 1) / 26;
    }
    label
}

pub fn cell_label(col: usize, row: usize) -> String {
    format!("{}{}", col_label(col), row + 1)
}

/// 表格名稱有空白或符號時要加引號。
pub fn table_prefix(name: &str) -> String {
    if name.chars().all(is_name_char) {
        format!("{name}::")
    } else {
        format!("'{}'::", name.replace('\'', "''"))
    }
}

const OPERATORS: [&str; 13] = ["<=", ">=", "<>", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%"];

fn tokenize(source: &str) -> Result<Vec<Spanned>, &'static str> {
    let chars: Vec<(usize, char)> = source.char_indices().collect();
    let offset = |index: usize| chars.get(index).map_or(source.len(), |(at, _)| *at);
    let is = |index: usize, test: fn(char) -> bool| chars.get(index).is_some_and(|(_, c)| test(*c));
    let quoted = |i: &mut usize, mark: char| -> Result<String, &'static str> {
        let mut text = String::new();
        *i += 1;
        loop {
            let Some((_, next)) = chars.get(*i).copied() else { return Err(ERR_SYNTAX) };
            *i += 1;
            if next != mark {
                text.push(next);
            } else if chars.get(*i).is_some_and(|(_, c)| *c == mark) {
                text.push(mark);
                *i += 1;
            } else {
                return Ok(text);
            }
        }
    };
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let (start, c) = chars[i];
        if c.is_whitespace() {
            i += 1;
            continue;
        }
        let single = match c {
            '(' => Some(Token::Open),
            ')' => Some(Token::Close),
            ',' | ';' => Some(Token::Comma),
            ':' => Some(Token::Colon),
            _ => None,
        };
        if let Some(token) = single {
            i += 1;
            tokens.push(Spanned { token, start, end: offset(i) });
            continue;
        }
        if c == '"' {
            let text = quoted(&mut i, '"')?;
            tokens.push(Spanned { token: Token::Text(text), start, end: offset(i) });
            continue;
        }
        if c == '#' {
            let begin = i;
            while is(i, |c| !c.is_whitespace() && !matches!(c, ')' | ',' | ';' | ':' | '+' | '*')) {
                i += 1;
            }
            let text: String = chars[begin..i].iter().map(|(_, c)| c).collect();
            let code = [ERR_REF, ERR_DIV, ERR_VALUE, ERR_NAME, ERR_NA].into_iter().find(|code| *code == text);
            tokens.push(Spanned { token: Token::Error(code.unwrap_or(ERR_SYNTAX)), start, end: offset(i) });
            continue;
        }
        if c.is_ascii_digit() || (c == '.' && is(i + 1, |c| c.is_ascii_digit())) {
            let begin = i;
            while is(i, |c| c.is_ascii_digit() || c == '.') {
                i += 1;
            }
            // 科學記號：1e5、2E-3。
            if is(i, |c| matches!(c, 'e' | 'E')) {
                let mut probe = i + 1;
                if is(probe, |c| matches!(c, '+' | '-')) {
                    probe += 1;
                }
                if is(probe, |c| c.is_ascii_digit()) {
                    i = probe;
                    while is(i, |c| c.is_ascii_digit()) {
                        i += 1;
                    }
                }
            }
            let text: String = chars[begin..i].iter().map(|(_, c)| c).collect();
            let number = text.parse().map_err(|_| ERR_SYNTAX)?;
            tokens.push(Spanned { token: Token::Number(number), start, end: offset(i) });
            continue;
        }
        if c == '\'' || is_name_char(c) {
            let name: String = if c == '\'' {
                quoted(&mut i, '\'')?
            } else {
                let begin = i;
                while is(i, is_name_char) {
                    i += 1;
                }
                chars[begin..i].iter().map(|(_, c)| c).collect()
            };
            if is(i, |c| c == ':') && is(i + 1, |c| c == ':') {
                i += 2;
                let begin = i;
                while is(i, is_name_char) {
                    i += 1;
                }
                let target: String = chars[begin..i].iter().map(|(_, c)| c).collect();
                let Some((col, row)) = parse_ref(&target) else { return Err(ERR_SYNTAX) };
                tokens.push(Spanned { token: Token::Ref { table: Some(name), col, row }, start, end: offset(i) });
                continue;
            }
            let token = match parse_ref(&name) {
                Some((col, row)) if c != '\'' => Token::Ref { table: None, col, row },
                _ => Token::Name(name),
            };
            tokens.push(Spanned { token, start, end: offset(i) });
            continue;
        }
        let rest = &source[start..];
        let Some(op) = OPERATORS.into_iter().find(|op| rest.starts_with(op)) else {
            return Err(ERR_SYNTAX);
        };
        i += op.chars().count();
        tokens.push(Spanned { token: Token::Op(op), start, end: offset(i) });
    }
    Ok(tokens)
}

/// `T::A1:B2` 的後半要沿用前半的表格。
fn inherited_table(tokens: &[Spanned], index: usize) -> Option<String> {
    let colon = tokens.get(index.checked_sub(1)?)?;
    let first = tokens.get(index.checked_sub(2)?)?;
    match (&colon.token, &first.token) {
        (Token::Colon, Token::Ref { table, .. }) => table.clone(),
        _ => None,
    }
}

/// 一個參照裡哪些部分是絕對的：`c` 是欄，`r` 是列。
fn absolute_flags(reference: &str) -> &'static str {
    let coordinate = reference.rsplit("::").next().unwrap_or(reference);
    let column = coordinate.starts_with('$');
    let row = coordinate.trim_start_matches('$').contains('$');
    match (column, row) {
        (true, true) => "cr",
        (true, false) => "c",
        (false, true) => "r",
        (false, false) => "",
    }
}

/// 在 `表格::B3` 這樣的座標加上 `$`。
fn mark_absolute(label: &str, flags: &str) -> String {
    let prefix = label.rfind("::").map_or(0, |at| at + 2);
    let (table, coordinate) = label.split_at(prefix);
    let letters = coordinate.chars().take_while(char::is_ascii_alphabetic).count();
    let (col, row) = coordinate.split_at(letters);
    let mark = |flag: char| if flags.contains(flag) { "$" } else { "" };
    format!("{table}{}{col}{}{row}", mark('c'), mark('r'))
}

/// 公式搬動時移動相對參照，絕對參照不動。移到表格外面的變成 `#REF!`。
/// 參數是使用者看到的公式，不是存檔的格式。
pub fn shift_refs(raw: &str, rows: i64, cols: i64) -> String {
    let Some(body) = raw.strip_prefix('=') else { return raw.to_string() };
    let Ok(tokens) = tokenize(body) else { return raw.to_string() };
    let mut shifted = String::from("=");
    let mut cursor = 0;
    for spanned in &tokens {
        let Token::Ref { col, row, .. } = &spanned.token else { continue };
        let text = &body[spanned.start..spanned.end];
        let flags = absolute_flags(text);
        let prefix = text.rfind("::").map_or(0, |at| at + 2);
        let next_col = *col as i64 + if flags.contains('c') { 0 } else { cols };
        let next_row = *row as i64 + if flags.contains('r') { 0 } else { rows };
        shifted.push_str(&body[cursor..spanned.start]);
        if next_col < 0 || next_row < 0 {
            shifted.push_str(ERR_REF);
        } else {
            shifted.push_str(&text[..prefix]);
            shifted.push_str(&mark_absolute(&cell_label(next_col as usize, next_row as usize), flags));
        }
        cursor = spanned.end;
    }
    shifted.push_str(&body[cursor..]);
    shifted
}

/// 把使用者打的公式換成穩定代號。找不到的格子保留原樣，計算時會是 `#REF!`。
pub fn to_stored(raw: &str, layout: &dyn Layout) -> String {
    let Some(body) = raw.strip_prefix('=') else { return raw.to_string() };
    let Ok(tokens) = tokenize(body) else { return raw.to_string() };
    let mut stored = String::from("=");
    let mut cursor = 0;
    for (index, spanned) in tokens.iter().enumerate() {
        let Token::Ref { table, col, row } = &spanned.token else { continue };
        let table = table.clone().or_else(|| inherited_table(&tokens, index));
        let Some(token) = layout.locate(table.as_deref(), *col, *row) else { continue };
        stored.push_str(&body[cursor..spanned.start]);
        stored.push(OPEN);
        stored.push_str(&token);
        let flags = absolute_flags(&body[spanned.start..spanned.end]);
        if !flags.is_empty() {
            stored.push('|');
            stored.push_str(flags);
        }
        stored.push(CLOSE);
        cursor = spanned.end;
    }
    stored.push_str(&body[cursor..]);
    stored
}

/// 把穩定代號換回當下的座標。
pub fn to_display(stored: &str, layout: &dyn Layout) -> String {
    let mut text = String::with_capacity(stored.len());
    let mut rest = stored;
    while let Some(start) = rest.find(OPEN) {
        text.push_str(&rest[..start]);
        let after = &rest[start + OPEN.len_utf8()..];
        let Some(end) = after.find(CLOSE) else {
            text.push_str(&rest[start..]);
            return text;
        };
        let token = &after[..end];
        // 代號是 `列id|欄id`，後面多一段就是絕對參照的記號。
        let (cell, flags) = if token.matches('|').count() > 1 { token.rsplit_once('|').unwrap_or((token, "")) } else { (token, "") };
        match layout.label(cell) {
            Some(label) => text.push_str(&mark_absolute(&label, flags)),
            None => text.push_str(ERR_REF),
        }
        rest = &after[end + CLOSE.len_utf8()..];
    }
    text.push_str(rest);
    text
}

#[derive(Debug, Clone)]
enum Expr {
    Literal(Value),
    Cell { table: Option<String>, col: usize, row: usize },
    Range { table: Option<String>, from: (usize, usize), to: (usize, usize) },
    Unary(&'static str, Box<Expr>),
    Percent(Box<Expr>),
    Binary(&'static str, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

struct Parser {
    tokens: Vec<Spanned>,
    at: usize,
}

type Parsed = Result<Expr, &'static str>;

impl Parser {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.at).map(|spanned| &spanned.token)
    }

    fn take_op(&mut self, ops: &[&'static str]) -> Option<&'static str> {
        if let Some(Token::Op(op)) = self.peek() {
            let op = *op;
            if ops.contains(&op) {
                self.at += 1;
                return Some(op);
            }
        }
        None
    }

    fn binary(&mut self, ops: &[&'static str], next: fn(&mut Parser) -> Parsed) -> Parsed {
        let mut left = next(self)?;
        while let Some(op) = self.take_op(ops) {
            let right = next(self)?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn comparison(&mut self) -> Parsed {
        self.binary(&["=", "<>", "<", ">", "<=", ">="], Self::concat)
    }

    fn concat(&mut self) -> Parsed {
        self.binary(&["&"], Self::additive)
    }

    fn additive(&mut self) -> Parsed {
        self.binary(&["+", "-"], Self::multiplicative)
    }

    fn multiplicative(&mut self) -> Parsed {
        self.binary(&["*", "/"], Self::power)
    }

    fn power(&mut self) -> Parsed {
        let base = self.unary()?;
        if self.take_op(&["^"]).is_some() {
            let exponent = self.power()?;
            return Ok(Expr::Binary("^", Box::new(base), Box::new(exponent)));
        }
        Ok(base)
    }

    fn unary(&mut self) -> Parsed {
        if let Some(op) = self.take_op(&["-", "+"]) {
            return Ok(Expr::Unary(op, Box::new(self.unary()?)));
        }
        let mut value = self.primary()?;
        while self.take_op(&["%"]).is_some() {
            value = Expr::Percent(Box::new(value));
        }
        Ok(value)
    }

    fn call(&mut self, name: String) -> Parsed {
        let name = name.to_ascii_uppercase();
        self.at += 1;
        let mut args = Vec::new();
        if self.peek() == Some(&Token::Close) {
            self.at += 1;
            return Ok(Expr::Call(name, args));
        }
        loop {
            args.push(self.comparison()?);
            match self.peek() {
                Some(Token::Comma) => self.at += 1,
                Some(Token::Close) => {
                    self.at += 1;
                    return Ok(Expr::Call(name, args));
                }
                _ => return Err(ERR_SYNTAX),
            }
        }
    }

    fn primary(&mut self) -> Parsed {
        let Some(token) = self.peek().cloned() else { return Err(ERR_SYNTAX) };
        self.at += 1;
        match token {
            Token::Number(number) => Ok(Expr::Literal(Value::Number(number))),
            Token::Text(text) => Ok(Expr::Literal(Value::Text(text))),
            Token::Error(code) => Ok(Expr::Literal(Value::Error(code))),
            Token::Ref { table, col, row } => {
                if self.peek() != Some(&Token::Colon) {
                    return Ok(Expr::Cell { table, col, row });
                }
                self.at += 1;
                let Some(Token::Ref { table: other, col: end_col, row: end_row }) = self.peek().cloned() else {
                    return Err(ERR_SYNTAX);
                };
                self.at += 1;
                Ok(Expr::Range { table: table.or(other), from: (col, row), to: (end_col, end_row) })
            }
            Token::Name(name) if self.peek() == Some(&Token::Open) => self.call(name),
            Token::Name(name) => match name.to_ascii_uppercase().as_str() {
                "TRUE" => Ok(Expr::Literal(Value::Bool(true))),
                "FALSE" => Ok(Expr::Literal(Value::Bool(false))),
                _ => Ok(Expr::Literal(Value::Error(ERR_NAME))),
            },
            Token::Open => {
                let inner = self.comparison()?;
                if self.peek() != Some(&Token::Close) {
                    return Err(ERR_SYNTAX);
                }
                self.at += 1;
                Ok(inner)
            }
            _ => Err(ERR_SYNTAX),
        }
    }
}

fn parse(source: &str) -> Parsed {
    let tokens = tokenize(source)?;
    let mut parser = Parser { tokens, at: 0 };
    let expr = parser.comparison()?;
    if parser.at != parser.tokens.len() {
        return Err(ERR_SYNTAX);
    }
    Ok(expr)
}

/// 一格打的字代表什麼值。
pub fn parse_literal(raw: &str) -> Value {
    let text = raw.trim();
    if text.is_empty() {
        return Value::Empty;
    }
    match text {
        "TRUE" | "true" => return Value::Bool(true),
        "FALSE" | "false" => return Value::Bool(false),
        _ => {}
    }
    let cleaned = text.replace(',', "");
    let (body, scale) = match cleaned.strip_suffix('%') {
        Some(body) => (body, 0.01),
        None => (cleaned.as_str(), 1.0),
    };
    let body = body.strip_prefix('$').unwrap_or(body);
    // 只接受數字開頭，`inf`、`nan` 是文字。
    if body.trim_start_matches('-').starts_with(|c: char| c.is_ascii_digit() || c == '.') {
        if let Ok(number) = body.parse::<f64>() {
            return Value::Number(number * scale);
        }
    }
    Value::Text(text.to_string())
}

fn to_number(value: &Value) -> Result<f64, &'static str> {
    match value {
        Value::Empty => Ok(0.0),
        Value::Number(number) => Ok(*number),
        Value::Bool(flag) => Ok(f64::from(u8::from(*flag))),
        Value::Text(text) => match parse_literal(text) {
            Value::Number(number) => Ok(number),
            _ => Err(ERR_VALUE),
        },
        Value::Error(code) => Err(code),
    }
}

fn to_text(value: &Value) -> Result<String, &'static str> {
    match value {
        Value::Empty => Ok(String::new()),
        Value::Number(number) => Ok(format_general(*number)),
        Value::Bool(flag) => Ok(if *flag { "TRUE" } else { "FALSE" }.to_string()),
        Value::Text(text) => Ok(text.clone()),
        Value::Error(code) => Err(code),
    }
}

fn to_bool(value: &Value) -> Result<bool, &'static str> {
    match value {
        Value::Empty => Ok(false),
        Value::Bool(flag) => Ok(*flag),
        Value::Number(number) => Ok(*number != 0.0),
        Value::Text(_) => Err(ERR_VALUE),
        Value::Error(code) => Err(code),
    }
}

/// 一般格式：整數不帶小數，小數最多十位，去掉計算誤差造成的尾數。
pub fn format_general(number: f64) -> String {
    if !number.is_finite() {
        return ERR_VALUE.to_string();
    }
    let text = format!("{number:.10}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" { "0".to_string() } else { trimmed.to_string() }
}

/// 千分位，`digits` 是小數位數。
pub fn format_grouped(number: f64, digits: usize) -> String {
    let text = format!("{:.*}", digits, number.abs());
    let (whole, fraction) = text.split_once('.').unwrap_or((text.as_str(), ""));
    let mut grouped = String::new();
    for (index, c) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let sign = if number < 0.0 && text.chars().any(|c| matches!(c, '1'..='9')) { "-" } else { "" };
    if fraction.is_empty() { format!("{sign}{grouped}") } else { format!("{sign}{grouped}.{fraction}") }
}

/// 參數展開後的一塊資料；單格也是一塊。
struct Block {
    rows: usize,
    cols: usize,
    values: Vec<Value>,
    is_range: bool,
}

impl Block {
    fn scalar(value: Value) -> Self {
        Self { rows: 1, cols: 1, values: vec![value], is_range: false }
    }
}

struct Evaluator<'a> {
    cells: &'a mut dyn Cells,
}

type Evaluated = Result<Value, &'static str>;

impl Evaluator<'_> {
    fn eval(&mut self, expr: &Expr) -> Value {
        match expr {
            Expr::Literal(value) => value.clone(),
            Expr::Cell { table, col, row } => self.cells.value(table.as_deref(), *col, *row),
            Expr::Range { .. } => self.block(expr).values.into_iter().next().unwrap_or(Value::Error(ERR_REF)),
            Expr::Unary(op, inner) => match to_number(&self.eval(inner)) {
                Ok(number) => Value::Number(if *op == "-" { -number } else { number }),
                Err(code) => Value::Error(code),
            },
            Expr::Percent(inner) => match to_number(&self.eval(inner)) {
                Ok(number) => Value::Number(number / 100.0),
                Err(code) => Value::Error(code),
            },
            Expr::Binary(op, left, right) => {
                let left = self.eval(left);
                let right = self.eval(right);
                binary(op, &left, &right)
            }
            Expr::Call(name, args) => self.call(name, args).unwrap_or_else(Value::Error),
        }
    }

    fn block(&mut self, expr: &Expr) -> Block {
        match expr {
            Expr::Range { table, from, to } => {
                let (left, right) = (from.0.min(to.0), from.0.max(to.0));
                let (top, bottom) = (from.1.min(to.1), from.1.max(to.1));
                let mut values = Vec::with_capacity((right - left + 1) * (bottom - top + 1));
                for row in top..=bottom {
                    for col in left..=right {
                        values.push(self.cells.value(table.as_deref(), col, row));
                    }
                }
                Block { rows: bottom - top + 1, cols: right - left + 1, values, is_range: true }
            }
            Expr::Cell { table, col, row } => {
                Block { is_range: true, ..Block::scalar(self.cells.value(table.as_deref(), *col, *row)) }
            }
            other => Block::scalar(self.eval(other)),
        }
    }

    /// 彙總函式用：範圍裡的文字與空白略過，直接打的文字才算錯。
    fn numbers(&mut self, args: &[Expr]) -> Result<Vec<f64>, &'static str> {
        let mut numbers = Vec::new();
        for arg in args {
            let block = self.block(arg);
            for value in &block.values {
                match value {
                    Value::Number(number) => numbers.push(*number),
                    Value::Error(code) => return Err(code),
                    Value::Bool(_) | Value::Text(_) if !block.is_range => numbers.push(to_number(value)?),
                    _ => {}
                }
            }
        }
        Ok(numbers)
    }

    fn number_arg(&mut self, args: &[Expr], index: usize) -> Result<f64, &'static str> {
        to_number(&self.eval(args.get(index).ok_or(ERR_VALUE)?))
    }

    fn text_arg(&mut self, args: &[Expr], index: usize) -> Result<String, &'static str> {
        to_text(&self.eval(args.get(index).ok_or(ERR_VALUE)?))
    }

    fn call(&mut self, name: &str, args: &[Expr]) -> Evaluated {
        let number = |value: f64| Ok(Value::Number(value));
        match name {
            "SUM" => number(self.numbers(args)?.iter().sum()),
            "PRODUCT" => number(self.numbers(args)?.iter().product()),
            "AVERAGE" | "AVG" => {
                let values = self.numbers(args)?;
                if values.is_empty() {
                    return Err(ERR_DIV);
                }
                number(values.iter().sum::<f64>() / values.len() as f64)
            }
            "MIN" => number(self.numbers(args)?.into_iter().reduce(f64::min).unwrap_or(0.0)),
            "MAX" => number(self.numbers(args)?.into_iter().reduce(f64::max).unwrap_or(0.0)),
            "MEDIAN" => {
                let mut values = self.numbers(args)?;
                if values.is_empty() {
                    return Err(ERR_NA);
                }
                values.sort_by(f64::total_cmp);
                let middle = values.len() / 2;
                number(if values.len() % 2 == 0 { (values[middle - 1] + values[middle]) / 2.0 } else { values[middle] })
            }
            "COUNT" => number(self.numbers(args)?.len() as f64),
            "COUNTA" => {
                let mut count = 0;
                for arg in args {
                    count += self.block(arg).values.iter().filter(|value| **value != Value::Empty).count();
                }
                number(count as f64)
            }
            "ABS" => number(self.number_arg(args, 0)?.abs()),
            "INT" => number(self.number_arg(args, 0)?.floor()),
            "SQRT" => {
                let value = self.number_arg(args, 0)?;
                if value < 0.0 { Err(ERR_VALUE) } else { number(value.sqrt()) }
            }
            "POWER" => number(self.number_arg(args, 0)?.powf(self.number_arg(args, 1)?)),
            "MOD" => {
                let (value, divisor) = (self.number_arg(args, 0)?, self.number_arg(args, 1)?);
                if divisor == 0.0 { Err(ERR_DIV) } else { number(value - divisor * (value / divisor).floor()) }
            }
            "PI" => number(std::f64::consts::PI),
            "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
                let value = self.number_arg(args, 0)?;
                let digits = if args.len() > 1 { self.number_arg(args, 1)? } else { 0.0 };
                let scale = 10f64.powf(digits.trunc());
                let scaled = value * scale;
                let rounded = match name {
                    "ROUND" => scaled.round(),
                    "ROUNDUP" if scaled >= 0.0 => scaled.ceil(),
                    "ROUNDUP" => scaled.floor(),
                    _ => scaled.trunc(),
                };
                number(rounded / scale)
            }
            "IF" => {
                let condition = to_bool(&self.eval(args.first().ok_or(ERR_VALUE)?))?;
                match args.get(if condition { 1 } else { 2 }) {
                    Some(branch) => Ok(self.eval(branch)),
                    None => Ok(Value::Bool(condition)),
                }
            }
            "IFERROR" => {
                let value = self.eval(args.first().ok_or(ERR_VALUE)?);
                if matches!(value, Value::Error(_)) {
                    return Ok(args.get(1).map_or(Value::Empty, |fallback| self.eval(fallback)));
                }
                Ok(value)
            }
            "AND" | "OR" => {
                let mut flags = Vec::new();
                for arg in args {
                    for value in self.block(arg).values {
                        if value != Value::Empty {
                            flags.push(to_bool(&value)?);
                        }
                    }
                }
                Ok(Value::Bool(if name == "AND" { flags.iter().all(|f| *f) } else { flags.iter().any(|f| *f) }))
            }
            "NOT" => Ok(Value::Bool(!to_bool(&self.eval(args.first().ok_or(ERR_VALUE)?))?)),
            "CONCAT" | "CONCATENATE" => {
                let mut joined = String::new();
                for arg in args {
                    for value in self.block(arg).values {
                        joined.push_str(&to_text(&value)?);
                    }
                }
                Ok(Value::Text(joined))
            }
            "LEN" => number(self.text_arg(args, 0)?.chars().count() as f64),
            "UPPER" => Ok(Value::Text(self.text_arg(args, 0)?.to_uppercase())),
            "LOWER" => Ok(Value::Text(self.text_arg(args, 0)?.to_lowercase())),
            "TRIM" => Ok(Value::Text(self.text_arg(args, 0)?.trim().to_string())),
            "LEFT" | "RIGHT" => {
                let text: Vec<char> = self.text_arg(args, 0)?.chars().collect();
                let count = if args.len() > 1 { self.number_arg(args, 1)?.max(0.0) as usize } else { 1 }.min(text.len());
                let part = if name == "LEFT" { &text[..count] } else { &text[text.len() - count..] };
                Ok(Value::Text(part.iter().collect()))
            }
            "MID" => {
                let text: Vec<char> = self.text_arg(args, 0)?.chars().collect();
                let start = (self.number_arg(args, 1)?.max(1.0) as usize - 1).min(text.len());
                let count = self.number_arg(args, 2)?.max(0.0) as usize;
                Ok(Value::Text(text[start..(start + count).min(text.len())].iter().collect()))
            }
            "COUNTIF" | "SUMIF" | "AVERAGEIF" => self.conditional(name, args),
            "COUNTIFS" | "SUMIFS" => self.conditional_many(name == "SUMIFS", args),
            "COUNTBLANK" => {
                let block = self.block(args.first().ok_or(ERR_VALUE)?);
                number(block.values.iter().filter(|value| matches!(value, Value::Empty)).count() as f64)
            }
            "SIGN" => number(self.number_arg(args, 0)?.signum()),
            "CEILING" | "FLOOR" => {
                let value = self.number_arg(args, 0)?;
                let unit = if args.len() > 1 { self.number_arg(args, 1)? } else { 1.0 };
                if unit == 0.0 {
                    return Err(ERR_DIV);
                }
                number((value / unit).pipe_round(name == "CEILING") * unit)
            }
            "STDEV" | "VAR" => {
                let numbers = self.numbers(args)?;
                if numbers.len() < 2 {
                    return Err(ERR_DIV);
                }
                let mean = numbers.iter().sum::<f64>() / numbers.len() as f64;
                let variance = numbers.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / (numbers.len() - 1) as f64;
                number(if name == "VAR" { variance } else { variance.sqrt() })
            }
            "LARGE" | "SMALL" => {
                let mut numbers = self.numbers(&args[..1.min(args.len())])?;
                numbers.sort_by(f64::total_cmp);
                if name == "LARGE" {
                    numbers.reverse();
                }
                let rank = self.number_arg(args, 1)? as usize;
                rank.checked_sub(1).and_then(|at| numbers.get(at)).map_or(Err(ERR_VALUE), |value| number(*value))
            }
            "SUBSTITUTE" => Ok(Value::Text(self.text_arg(args, 0)?.replace(&self.text_arg(args, 1)?, &self.text_arg(args, 2)?))),
            "FIND" => {
                let (wanted, text) = (self.text_arg(args, 0)?, self.text_arg(args, 1)?);
                let at = text.find(&wanted).ok_or(ERR_VALUE)?;
                number((text[..at].chars().count() + 1) as f64)
            }
            "TEXTJOIN" => {
                let separator = self.text_arg(args, 0)?;
                let skip_empty = to_bool(&self.eval(args.get(1).ok_or(ERR_VALUE)?))?;
                let mut parts = Vec::new();
                for arg in args.iter().skip(2) {
                    for value in self.block(arg).values {
                        let text = to_text(&value)?;
                        if !skip_empty || !text.is_empty() {
                            parts.push(text);
                        }
                    }
                }
                Ok(Value::Text(parts.join(&separator)))
            }
            "HLOOKUP" => {
                let target = self.eval(args.first().ok_or(ERR_VALUE)?);
                let table = self.block(args.get(1).ok_or(ERR_VALUE)?);
                let row = self.number_arg(args, 2)? as usize;
                if row == 0 || row > table.rows {
                    return Err(ERR_REF);
                }
                (0..table.cols)
                    .find(|col| same_value(&table.values[*col], &target))
                    .map(|col| table.values[(row - 1) * table.cols + col].clone())
                    .ok_or(ERR_NA)
            }
            "XLOOKUP" => {
                let target = self.eval(args.first().ok_or(ERR_VALUE)?);
                let lookup = self.block(args.get(1).ok_or(ERR_VALUE)?);
                let result = self.block(args.get(2).ok_or(ERR_VALUE)?);
                match lookup.values.iter().position(|value| same_value(value, &target)) {
                    Some(at) => result.values.get(at).cloned().ok_or(ERR_REF),
                    None => args.get(3).map_or(Err(ERR_NA), |fallback| Ok(self.eval(fallback))),
                }
            }
            "TODAY" => Ok(Value::Text(super::fill::today())),
            "VLOOKUP" => self.vlookup(args),
            "INDEX" => {
                let block = self.block(args.first().ok_or(ERR_VALUE)?);
                let row = self.number_arg(args, 1)? as usize;
                let col = if args.len() > 2 { self.number_arg(args, 2)? as usize } else { 1 };
                if row == 0 || col == 0 || row > block.rows || col > block.cols {
                    return Err(ERR_REF);
                }
                Ok(block.values[(row - 1) * block.cols + col - 1].clone())
            }
            "MATCH" => {
                let target = self.eval(args.first().ok_or(ERR_VALUE)?);
                let block = self.block(args.get(1).ok_or(ERR_VALUE)?);
                block
                    .values
                    .iter()
                    .position(|value| same_value(value, &target))
                    .map(|index| Value::Number((index + 1) as f64))
                    .ok_or(ERR_NA)
            }
            _ => Err(ERR_NAME),
        }
    }

    fn conditional(&mut self, name: &str, args: &[Expr]) -> Evaluated {
        let range = self.block(args.first().ok_or(ERR_VALUE)?);
        let criterion = self.eval(args.get(1).ok_or(ERR_VALUE)?);
        let target = args.get(2).map(|arg| self.block(arg));
        let mut count = 0usize;
        let mut total = 0.0;
        for (index, value) in range.values.iter().enumerate() {
            if !matches_criterion(value, &criterion) {
                continue;
            }
            let picked = target.as_ref().map_or(value, |block| block.values.get(index).unwrap_or(&Value::Empty));
            match picked {
                Value::Number(number) => {
                    total += number;
                    count += 1;
                }
                _ if name == "COUNTIF" => count += 1,
                _ => {}
            }
        }
        match name {
            "COUNTIF" => Ok(Value::Number(count as f64)),
            "SUMIF" => Ok(Value::Number(total)),
            _ if count == 0 => Err(ERR_DIV),
            _ => Ok(Value::Number(total / count as f64)),
        }
    }

    /// `SUMIFS(加總範圍, 範圍1, 條件1, …)`、`COUNTIFS(範圍1, 條件1, …)`，全部條件都要符合。
    fn conditional_many(&mut self, sums: bool, args: &[Expr]) -> Evaluated {
        let pairs = &args[usize::from(sums).min(args.len())..];
        if pairs.is_empty() || pairs.len() % 2 != 0 {
            return Err(ERR_VALUE);
        }
        let criteria: Vec<(Block, Value)> = pairs.chunks(2).map(|pair| (self.block(&pair[0]), self.eval(&pair[1]))).collect();
        let target = if sums { Some(self.block(args.first().ok_or(ERR_VALUE)?)) } else { None };
        let (mut count, mut total) = (0usize, 0.0);
        for index in 0..criteria[0].0.values.len() {
            if !criteria.iter().all(|(block, criterion)| block.values.get(index).is_some_and(|value| matches_criterion(value, criterion))) {
                continue;
            }
            count += 1;
            if let Some(Value::Number(value)) = target.as_ref().and_then(|block| block.values.get(index)) {
                total += value;
            }
        }
        Ok(Value::Number(if sums { total } else { count as f64 }))
    }

    fn vlookup(&mut self, args: &[Expr]) -> Evaluated {
        let target = self.eval(args.first().ok_or(ERR_VALUE)?);
        let table = self.block(args.get(1).ok_or(ERR_VALUE)?);
        let col = self.number_arg(args, 2)? as usize;
        if col == 0 || col > table.cols {
            return Err(ERR_REF);
        }
        (0..table.rows)
            .find(|row| same_value(&table.values[row * table.cols], &target))
            .map(|row| table.values[row * table.cols + col - 1].clone())
            .ok_or(ERR_NA)
    }
}

fn same_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Text(a), Value::Text(b)) => a.eq_ignore_ascii_case(b),
        _ => left == right,
    }
}

fn matches_criterion(value: &Value, criterion: &Value) -> bool {
    let Value::Text(text) = criterion else { return same_value(value, criterion) };
    for op in ["<=", ">=", "<>", "<", ">", "="] {
        let Some(rest) = text.strip_prefix(op) else { continue };
        return matches!(binary(op, value, &parse_literal(rest)), Value::Bool(true));
    }
    same_value(value, &parse_literal(text))
}

fn compare(left: &Value, right: &Value) -> Result<std::cmp::Ordering, &'static str> {
    use std::cmp::Ordering;
    if let Value::Error(code) = left {
        return Err(code);
    }
    if let Value::Error(code) = right {
        return Err(code);
    }
    Ok(match (left, right) {
        (Value::Text(a), Value::Text(b)) => a.to_lowercase().cmp(&b.to_lowercase()),
        (Value::Text(_), _) => Ordering::Greater,
        (_, Value::Text(_)) => Ordering::Less,
        _ => to_number(left)?.total_cmp(&to_number(right)?),
    })
}

fn binary(op: &str, left: &Value, right: &Value) -> Value {
    use std::cmp::Ordering::{Equal, Greater, Less};
    let result = (|| -> Evaluated {
        match op {
            "&" => Ok(Value::Text(to_text(left)? + &to_text(right)?)),
            "=" => Ok(Value::Bool(compare(left, right)? == Equal)),
            "<>" => Ok(Value::Bool(compare(left, right)? != Equal)),
            "<" => Ok(Value::Bool(compare(left, right)? == Less)),
            ">" => Ok(Value::Bool(compare(left, right)? == Greater)),
            "<=" => Ok(Value::Bool(compare(left, right)? != Greater)),
            ">=" => Ok(Value::Bool(compare(left, right)? != Less)),
            _ => {
                let (a, b) = (to_number(left)?, to_number(right)?);
                Ok(Value::Number(match op {
                    "+" => a + b,
                    "-" => a - b,
                    "*" => a * b,
                    "^" => a.powf(b),
                    _ if b == 0.0 => return Err(ERR_DIV),
                    _ => a / b,
                }))
            }
        }
    })();
    result.unwrap_or_else(Value::Error)
}

/// `source` 是座標形式的公式，不含開頭的 `=`。
pub fn evaluate(source: &str, cells: &mut dyn Cells) -> Value {
    match parse(source) {
        Ok(expr) => Evaluator { cells }.eval(&expr),
        Err(code) => Value::Error(code),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    struct Grid(HashMap<(usize, usize), Value>);

    impl Cells for Grid {
        fn value(&mut self, table: Option<&str>, col: usize, row: usize) -> Value {
            if table == Some("沒有") {
                return Value::Error(ERR_REF);
            }
            self.0.get(&(col, row)).cloned().unwrap_or(Value::Empty)
        }
    }

    fn run(source: &str) -> Value {
        let mut cells = HashMap::new();
        for (row, value) in [1.0, 2.0, 3.0, 4.0].iter().enumerate() {
            cells.insert((0, row), Value::Number(*value));
        }
        cells.insert((1, 0), Value::Text("甲".to_string()));
        cells.insert((1, 1), Value::Text("乙".to_string()));
        evaluate(source, &mut Grid(cells))
    }

    #[test]
    fn 四則運算依優先順序() {
        assert_eq!(run("1+2*3^2"), Value::Number(19.0));
        assert_eq!(run("(1+2)*3"), Value::Number(9.0));
        assert_eq!(run("50%*4"), Value::Number(2.0));
    }

    #[test]
    fn 範圍函式略過文字() {
        assert_eq!(run("SUM(A1:B4)"), Value::Number(10.0));
        assert_eq!(run("AVERAGE(A1:A4)"), Value::Number(2.5));
        assert_eq!(run("COUNTA(A1:B4)"), Value::Number(6.0));
        assert_eq!(run("MEDIAN(A1:A4)"), Value::Number(2.5));
    }

    #[test]
    fn 條件與查找() {
        assert_eq!(run("IF(A1>0,\"正\",\"負\")"), Value::Text("正".to_string()));
        assert_eq!(run("COUNTIF(A1:A4,\">2\")"), Value::Number(2.0));
        assert_eq!(run("SUMIF(A1:A4,\">=3\")"), Value::Number(7.0));
        assert_eq!(run("VLOOKUP(2,A1:B4,2)"), Value::Text("乙".to_string()));
        assert_eq!(run("MATCH(3,A1:A4)"), Value::Number(3.0));
        assert_eq!(run("INDEX(A1:B4,2,2)"), Value::Text("乙".to_string()));
    }

    #[test]
    fn 錯誤會傳遞且顯示代碼() {
        assert_eq!(run("1/0"), Value::Error(ERR_DIV));
        assert_eq!(run("SUM(1/0,2)"), Value::Error(ERR_DIV));
        assert_eq!(run("IFERROR(1/0,9)"), Value::Number(9.0));
        assert_eq!(run("沒有這個(1)"), Value::Error(ERR_NAME));
        assert_eq!(run("1+"), Value::Error(ERR_SYNTAX));
        assert_eq!(run("#REF!+1"), Value::Error(ERR_REF));
    }

    #[test]
    fn 表格名稱與引號() {
        assert_eq!(run("沒有::A1"), Value::Error(ERR_REF));
        assert_eq!(run("'表格 1'::A2+1"), Value::Number(3.0));
        assert_eq!(table_prefix("表格 1"), "'表格 1'::");
        assert_eq!(table_prefix("表格1"), "表格1::");
    }

    #[test]
    fn 欄名與數字格式() {
        assert_eq!(col_label(0), "A");
        assert_eq!(col_label(25), "Z");
        assert_eq!(col_label(26), "AA");
        assert_eq!(parse_ref("$AA$10"), Some((26, 9)));
        assert_eq!(parse_ref("SUM"), None);
        assert_eq!(format_general(0.1 + 0.2), "0.3");
        assert_eq!(format_grouped(1234567.891, 2), "1,234,567.89");
        assert_eq!(format_grouped(-999.0, 0), "-999");
        assert_eq!(parse_literal("12%"), Value::Number(0.12));
        assert_eq!(parse_literal("1,234"), Value::Number(1234.0));
        assert_eq!(parse_literal("nan"), Value::Text("nan".to_string()));
    }
}
