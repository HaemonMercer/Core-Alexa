//! Excels：參考 Numbers。一份試算表有多個分頁，每個分頁是一張空白頁面，
//! 上面自由擺放多個表格和圖表。
//!
//! 列與欄從一開始就有穩定的 id，`cells` 的鍵是 `列id:欄id`，插入或刪除列欄不必動其他格子，
//! 多人同時增刪也不會指錯位置。公式、引入內容與圖表都靠這些 id 指向格子。
//! 計算在讀取時進行，不把結果存進文件。

use super::fill::{series, Filled};
use super::formula::{self, cell_label, table_prefix, Cells, Layout, Value};
use super::office::{field_flag, field_number, field_string, field_text, set_text, sort_by_key, valid_color};
use super::types::{
    CellInput, CellMerge, CellRange, CellView, NoteType, RangeView, SheetAxis, SheetObject, SheetOp, SheetState, SheetTab,
    SheetTable, SheetTableInfo, StylePatch,
};
use super::yjs::new_id;
use super::Alexa;
use crate::order::{key_after, key_between};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use yrs::{Map, MapPrelim, MapRef, Out, ReadTxn, Transact, TransactionMut};

const CARD_SIZE: (f64, f64) = (320.0, 220.0);
const ROOTS: [&str; 6] = ["tabs", "tables", "rows", "cols", "cells", "objects"];
const DEFAULT_ROWS: usize = 8;
const DEFAULT_COLS: usize = 5;
pub(super) const DEFAULT_ROW_HEIGHT: f64 = 28.0;
pub(super) const DEFAULT_COL_WIDTH: f64 = 110.0;
const MIN_SIZE: f64 = 20.0;
const MAX_INSERT: usize = 500;
const TABLE_GAP: f64 = 48.0;
const OBJECT_SIZE: (f64, f64) = (420.0, 300.0);
const SUMMARY_ROWS: usize = 6;

fn cell_key(row: &str, col: &str) -> String {
    format!("{row}:{col}")
}

#[derive(Debug, Clone, Default)]
struct RawCell {
    value: String,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    align: Option<String>,
    valign: Option<String>,
    fill: Option<String>,
    color: Option<String>,
    format: Option<String>,
}

/// 存檔的合併範圍。和引入內容一樣記著所有列欄的 id，增刪列欄後範圍仍然正確。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredMerge {
    rows: Vec<String>,
    cols: Vec<String>,
}

#[derive(Debug, Clone)]
struct RawAxis {
    id: String,
    key: String,
    size: f64,
}

#[derive(Debug, Clone)]
struct RawTable {
    id: String,
    tab_id: String,
    key: String,
    name: String,
    x: f64,
    y: f64,
    header_rows: usize,
    header_cols: usize,
    footer_rows: usize,
    rows: Vec<RawAxis>,
    cols: Vec<RawAxis>,
    merges: Vec<StoredMerge>,
    filter_on: bool,
    filters: HashMap<String, Vec<String>>,
}

struct SheetData {
    tabs: Vec<(String, String, String)>,
    tables: Vec<RawTable>,
    cells: HashMap<String, RawCell>,
    objects: Vec<SheetObject>,
    row_at: HashMap<String, (usize, usize)>,
    col_at: HashMap<String, (usize, usize)>,
}

fn read_axes<T: ReadTxn>(txn: &T, map: &MapRef, default: f64) -> HashMap<String, Vec<RawAxis>> {
    let mut by_table: HashMap<String, Vec<RawAxis>> = HashMap::new();
    for (id, value) in map.iter(txn) {
        let Out::YMap(item) = value else { continue };
        let Some(table) = field_string(&item, txn, "tableId") else { continue };
        let size = field_number(&item, txn, "size");
        by_table.entry(table).or_default().push(RawAxis {
            id: id.to_string(),
            key: field_string(&item, txn, "orderKey").unwrap_or_default(),
            size: if size > 0.0 { size } else { default },
        });
    }
    for axes in by_table.values_mut() {
        sort_by_key(axes, |axis| (axis.key.as_str(), axis.id.as_str()));
    }
    by_table
}

fn read_data<T: ReadTxn>(txn: &T, roots: &[MapRef; 6]) -> SheetData {
    let [tabs, tables, rows, cols, cells, objects] = roots;
    let mut tab_list: Vec<(String, String, String)> = tabs
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            Some((
                id.to_string(),
                field_string(&item, txn, "name").unwrap_or_default(),
                field_string(&item, txn, "orderKey").unwrap_or_default(),
            ))
        })
        .collect();
    sort_by_key(&mut tab_list, |tab| (tab.2.as_str(), tab.0.as_str()));

    let mut rows_of = read_axes(txn, rows, DEFAULT_ROW_HEIGHT);
    let mut cols_of = read_axes(txn, cols, DEFAULT_COL_WIDTH);
    let mut table_list: Vec<RawTable> = tables
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            let tab_id = field_string(&item, txn, "tabId")?;
            Some(RawTable {
                id: id.to_string(),
                key: field_string(&item, txn, "orderKey").unwrap_or_default(),
                name: field_string(&item, txn, "name").unwrap_or_default(),
                x: field_number(&item, txn, "x"),
                y: field_number(&item, txn, "y"),
                header_rows: field_number(&item, txn, "headerRows") as usize,
                header_cols: field_number(&item, txn, "headerCols") as usize,
                footer_rows: field_number(&item, txn, "footerRows") as usize,
                rows: rows_of.remove(id).unwrap_or_default(),
                cols: cols_of.remove(id).unwrap_or_default(),
                merges: field_string(&item, txn, "merges").and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default(),
                filter_on: field_flag(&item, txn, "filterOn"),
                filters: field_string(&item, txn, "filters").and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default(),
                tab_id,
            })
        })
        .collect();
    sort_by_key(&mut table_list, |table| (table.key.as_str(), table.id.as_str()));

    let cell_map = cells
        .iter(txn)
        .filter_map(|(key, value)| {
            let Out::YMap(item) = value else { return None };
            Some((
                key.to_string(),
                RawCell {
                    value: field_text(&item, txn, "value"),
                    bold: field_flag(&item, txn, "bold"),
                    italic: field_flag(&item, txn, "italic"),
                    underline: field_flag(&item, txn, "underline"),
                    strike: field_flag(&item, txn, "strike"),
                    align: field_string(&item, txn, "align").filter(|text| !text.is_empty()),
                    valign: field_string(&item, txn, "valign").filter(|text| !text.is_empty()),
                    fill: field_string(&item, txn, "fill").filter(|text| !text.is_empty()),
                    color: field_string(&item, txn, "color").filter(|text| !text.is_empty()),
                    format: field_string(&item, txn, "format").filter(|text| !text.is_empty()),
                },
            ))
        })
        .collect();

    let object_list = objects
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            Some(SheetObject {
                id: id.to_string(),
                tab_id: field_string(&item, txn, "tabId")?,
                note_id: field_string(&item, txn, "noteId")?,
                note_type: String::new(),
                x: field_number(&item, txn, "x"),
                y: field_number(&item, txn, "y"),
                w: field_number(&item, txn, "w"),
                h: field_number(&item, txn, "h"),
            })
        })
        .collect();

    let mut row_at = HashMap::new();
    let mut col_at = HashMap::new();
    for (table_index, table) in table_list.iter().enumerate() {
        for (index, row) in table.rows.iter().enumerate() {
            row_at.insert(row.id.clone(), (table_index, index));
        }
        for (index, col) in table.cols.iter().enumerate() {
            col_at.insert(col.id.clone(), (table_index, index));
        }
    }
    SheetData { tabs: tab_list, tables: table_list, cells: cell_map, objects: object_list, row_at, col_at }
}

struct SheetLayout<'a> {
    data: &'a SheetData,
    table: usize,
}

impl SheetData {
    fn table_index(&self, current: usize, name: Option<&str>) -> Option<usize> {
        match name {
            None => Some(current),
            Some(name) => self.tables.iter().position(|table| table.name == name),
        }
    }
}

impl Layout for SheetLayout<'_> {
    fn locate(&self, table: Option<&str>, col: usize, row: usize) -> Option<String> {
        let target = &self.data.tables[self.data.table_index(self.table, table)?];
        Some(format!("{}|{}", target.rows.get(row)?.id, target.cols.get(col)?.id))
    }

    fn label(&self, token: &str) -> Option<String> {
        let (row, col) = token.split_once('|')?;
        let (row_table, row_index) = *self.data.row_at.get(row)?;
        let (col_table, col_index) = *self.data.col_at.get(col)?;
        if row_table != col_table {
            return None;
        }
        let label = cell_label(col_index, row_index);
        Some(if row_table == self.table {
            label
        } else {
            format!("{}{label}", table_prefix(&self.data.tables[row_table].name))
        })
    }
}

/// 計算全部格子。每格只算一次，走到自己時是循環參照。
struct Calc<'a> {
    data: &'a SheetData,
    memo: HashMap<String, Value>,
    visiting: HashSet<String>,
}

impl<'a> Calc<'a> {
    fn new(data: &'a SheetData) -> Self {
        Self { data, memo: HashMap::new(), visiting: HashSet::new() }
    }

    fn value_of(&mut self, table: usize, row: &str, col: &str) -> Value {
        let key = cell_key(row, col);
        if let Some(value) = self.memo.get(&key) {
            return value.clone();
        }
        let raw = self.data.cells.get(&key).map_or("", |cell| cell.value.as_str());
        let value = match raw.strip_prefix('=') {
            None => formula::parse_literal(raw),
            Some(_) if !self.visiting.insert(key.clone()) => return Value::Error(formula::ERR_CIRCULAR),
            Some(_) => {
                let layout = SheetLayout { data: self.data, table };
                let source = formula::to_display(raw, &layout);
                let result = formula::evaluate(&source[1..], &mut Scope { calc: self, table });
                self.visiting.remove(&key);
                result
            }
        };
        self.memo.insert(key, value.clone());
        value
    }
}

struct Scope<'c, 'a> {
    calc: &'c mut Calc<'a>,
    table: usize,
}

impl Cells for Scope<'_, '_> {
    fn value(&mut self, table: Option<&str>, col: usize, row: usize) -> Value {
        let data = self.calc.data;
        let Some(index) = data.table_index(self.table, table) else {
            return Value::Error(formula::ERR_REF);
        };
        let target = &data.tables[index];
        let (Some(row), Some(col)) = (target.rows.get(row), target.cols.get(col)) else {
            return Value::Error(formula::ERR_REF);
        };
        self.calc.value_of(index, &row.id, &col.id)
    }
}

fn format_number(number: f64, format: Option<&str>) -> String {
    match format {
        Some("number") => formula::format_grouped(number, 2),
        Some("integer") => formula::format_grouped(number, 0),
        Some("percent") => format!("{}%", formula::format_general((number * 10000.0).round() / 100.0)),
        Some("currency") => {
            let text = formula::format_grouped(number.abs(), 2);
            if number < 0.0 { format!("-${text}") } else { format!("${text}") }
        }
        _ => formula::format_general(number),
    }
}

fn view_of(value: &Value, raw: String, cell: Option<&RawCell>) -> CellView {
    let format = cell.and_then(|cell| cell.format.as_deref());
    let (kind, display, number) = match value {
        Value::Empty => ("empty", String::new(), None),
        Value::Number(number) => ("number", format_number(*number, format), Some(*number)),
        Value::Text(text) => ("text", text.clone(), None),
        Value::Bool(flag) => ("bool", if *flag { "TRUE" } else { "FALSE" }.to_string(), None),
        Value::Error(code) => ("error", (*code).to_string(), None),
    };
    CellView {
        raw,
        display,
        kind: kind.to_string(),
        number,
        bold: cell.is_some_and(|cell| cell.bold),
        italic: cell.is_some_and(|cell| cell.italic),
        underline: cell.is_some_and(|cell| cell.underline),
        strike: cell.is_some_and(|cell| cell.strike),
        align: cell.and_then(|cell| cell.align.clone()),
        valign: cell.and_then(|cell| cell.valign.clone()),
        fill: cell.and_then(|cell| cell.fill.clone()),
        color: cell.and_then(|cell| cell.color.clone()),
        format: cell.and_then(|cell| cell.format.clone()),
    }
}

/// 還有效的合併，和它存檔時的樣子放在一起。列欄全被刪除的略過；
/// 兩個人同時合併而重疊時，留下先寫入的。
fn live_merges(table: &RawTable) -> Vec<(&StoredMerge, CellMerge)> {
    let span = |axes: &[RawAxis], wanted: &[String]| {
        let first = axes.iter().position(|axis| wanted.contains(&axis.id))?;
        let last = axes.iter().rposition(|axis| wanted.contains(&axis.id))?;
        Some((first, last - first + 1))
    };
    let mut live: Vec<(&StoredMerge, CellMerge)> = Vec::new();
    for stored in &table.merges {
        let (Some((top, rows)), Some((left, cols))) = (span(&table.rows, &stored.rows), span(&table.cols, &stored.cols)) else {
            continue;
        };
        let merge = CellMerge { top, left, rows, cols };
        if rows * cols > 1 && !live.iter().any(|(_, other)| overlaps(other, &merge)) {
            live.push((stored, merge));
        }
    }
    live
}

fn overlaps(a: &CellMerge, b: &CellMerge) -> bool {
    a.top < b.top + b.rows && b.top < a.top + a.rows && a.left < b.left + b.cols && b.left < a.left + a.cols
}

fn covers(outer: &CellMerge, inner: &CellMerge) -> bool {
    outer.top <= inner.top
        && outer.left <= inner.left
        && inner.top + inner.rows <= outer.top + outer.rows
        && inner.left + inner.cols <= outer.left + outer.cols
}

/// 內容列裡不符合篩選的列。整列空白的不藏，才看得到剛新增的列。
fn hidden_rows(table: &RawTable, cells: &HashMap<String, CellView>) -> Vec<String> {
    if table.filters.is_empty() {
        return Vec::new();
    }
    let start = table.header_rows.min(table.rows.len());
    let end = table.rows.len().saturating_sub(table.footer_rows).max(start);
    let display = |row: &str, col: &str| cells.get(&cell_key(row, col)).map_or("", |cell| cell.display.as_str());
    table.rows[start..end]
        .iter()
        .filter(|row| {
            let blank = table.cols.iter().all(|col| display(&row.id, &col.id).is_empty());
            !blank && table.cols.iter().any(|col| {
                table.filters.get(&col.id).is_some_and(|kept| !kept.iter().any(|value| value == display(&row.id, &col.id)))
            })
        })
        .map(|row| row.id.clone())
        .collect()
}

fn render(data: &SheetData) -> SheetState {
    let mut calc = Calc::new(data);
    let tables = data
        .tables
        .iter()
        .enumerate()
        .map(|(index, table)| {
            let mut cells = HashMap::new();
            for row in &table.rows {
                for col in &table.cols {
                    let key = cell_key(&row.id, &col.id);
                    let Some(cell) = data.cells.get(&key) else { continue };
                    let value = calc.value_of(index, &row.id, &col.id);
                    let raw = formula::to_display(&cell.value, &SheetLayout { data, table: index });
                    cells.insert(key, view_of(&value, raw, Some(cell)));
                }
            }
            let hidden = hidden_rows(table, &cells);
            SheetTable {
                id: table.id.clone(),
                tab_id: table.tab_id.clone(),
                name: table.name.clone(),
                x: table.x,
                y: table.y,
                header_rows: table.header_rows,
                header_cols: table.header_cols,
                footer_rows: table.footer_rows,
                rows: table.rows.iter().map(|row| SheetAxis { id: row.id.clone(), size: row.size }).collect(),
                cols: table.cols.iter().map(|col| SheetAxis { id: col.id.clone(), size: col.size }).collect(),
                cells,
                merges: live_merges(table).into_iter().map(|(_, merge)| merge).collect(),
                filter_on: table.filter_on,
                filters: table.filters.iter().filter(|(col, _)| table.cols.iter().any(|axis| axis.id == **col)).map(|(col, kept)| (col.clone(), kept.clone())).collect(),
                hidden_rows: hidden,
            }
        })
        .collect();
    SheetState {
        tabs: data.tabs.iter().map(|(id, name, _)| SheetTab { id: id.clone(), name: name.clone() }).collect(),
        tables,
        objects: data.objects.clone(),
    }
}

fn new_axis(txn: &mut TransactionMut, map: &MapRef, id: &str, table: &str, key: String) {
    let item = map.insert(txn, id, MapPrelim::default());
    item.insert(txn, "tableId", table.to_string());
    item.insert(txn, "orderKey", key);
}

fn write_table(
    txn: &mut TransactionMut,
    roots: &[MapRef; 6],
    tab_id: &str,
    name: &str,
    x: f64,
    y: f64,
    key: String,
) -> Result<(), String> {
    let table_id = new_id();
    let item = roots[1].insert(txn, table_id.as_str(), MapPrelim::default());
    item.insert(txn, "tabId", tab_id.to_string());
    item.insert(txn, "orderKey", key);
    item.insert(txn, "name", name.to_string());
    item.insert(txn, "x", x);
    item.insert(txn, "y", y);
    item.insert(txn, "headerRows", 1.0);
    item.insert(txn, "headerCols", 1.0);
    item.insert(txn, "footerRows", 0.0);
    let mut row_key = None;
    for _ in 0..DEFAULT_ROWS {
        let key = key_after(row_key.as_deref())?;
        new_axis(txn, &roots[2], &new_id(), &table_id, key.clone());
        row_key = Some(key);
    }
    let mut col_key = None;
    for _ in 0..DEFAULT_COLS {
        let key = key_after(col_key.as_deref())?;
        new_axis(txn, &roots[3], &new_id(), &table_id, key.clone());
        col_key = Some(key);
    }
    Ok(())
}

fn item_of<T: ReadTxn>(map: &MapRef, txn: &T, id: &str, what: &str) -> Result<MapRef, String> {
    match map.get(txn, id) {
        Some(Out::YMap(item)) => Ok(item),
        _ => Err(format!("unknown {what}: {id}")),
    }
}

fn cell_item(cells: &MapRef, txn: &mut TransactionMut, key: &str) -> MapRef {
    let existing: Option<MapRef> = match cells.get(txn, key) {
        Some(Out::YMap(item)) => Some(item),
        _ => None,
    };
    existing.unwrap_or_else(|| cells.insert(txn, key, MapPrelim::default()))
}

fn table_of<'a>(data: &'a SheetData, id: &str) -> Result<&'a RawTable, String> {
    data.tables.iter().find(|table| table.id == id).ok_or_else(|| format!("unknown table: {id}"))
}

/// `count` 個排在 `index`（None 是最前面）之後的鍵。
fn keys_after(axes: &[RawAxis], index: Option<usize>, count: usize) -> Result<Vec<String>, String> {
    let lower = match index {
        Some(index) => axes.get(index + 1),
        None => axes.first(),
    }
    .map(|axis| axis.key.clone());
    let mut previous = index.map(|index| axes[index].key.clone());
    let mut keys = Vec::with_capacity(count);
    for _ in 0..count {
        let key = key_between(previous.as_deref(), lower.as_deref())?;
        previous = Some(key.clone());
        keys.push(key);
    }
    Ok(keys)
}

struct FillArea {
    source_rows: Vec<String>,
    source_cols: Vec<String>,
    target_rows: Vec<String>,
    target_cols: Vec<String>,
}

/// 這些列欄圍出來的範圍。
fn box_of(table: &RawTable, rows: &[String], cols: &[String]) -> Result<CellMerge, String> {
    let span = |axes: &[RawAxis], wanted: &[String]| {
        let first = axes.iter().position(|axis| wanted.contains(&axis.id))?;
        let last = axes.iter().rposition(|axis| wanted.contains(&axis.id))?;
        Some((first, last - first + 1))
    };
    let (Some((top, height)), Some((left, width))) = (span(&table.rows, rows), span(&table.cols, cols)) else {
        return Err("找不到選取的格子".to_string());
    };
    Ok(CellMerge { top, left, rows: height, cols: width })
}

fn next_name(existing: impl Iterator<Item = String>, base: &str) -> String {
    let taken: HashSet<String> = existing.collect();
    (1..).map(|n| format!("{base}{n}")).find(|name| !taken.contains(name)).unwrap_or_else(|| base.to_string())
}

fn valid_style(style: &StylePatch) -> Result<(), String> {
    for color in [&style.fill, &style.color].into_iter().flatten() {
        if !valid_color(color) {
            return Err(format!("invalid color: {color}"));
        }
    }
    if let Some(align) = style.align.as_deref() {
        if !matches!(align, "" | "left" | "center" | "right") {
            return Err(format!("invalid align: {align}"));
        }
    }
    if let Some(format) = style.format.as_deref() {
        if !matches!(format, "" | "number" | "integer" | "percent" | "currency") {
            return Err(format!("invalid format: {format}"));
        }
    }
    Ok(())
}

fn apply_style(item: &MapRef, txn: &mut TransactionMut, style: &StylePatch) {
    if let Some(bold) = style.bold {
        item.insert(txn, "bold", bold);
    }
    if let Some(italic) = style.italic {
        item.insert(txn, "italic", italic);
    }
    if let Some(underline) = style.underline {
        item.insert(txn, "underline", underline);
    }
    if let Some(strike) = style.strike {
        item.insert(txn, "strike", strike);
    }
    let texts = [
        ("align", &style.align),
        ("valign", &style.valign),
        ("fill", &style.fill),
        ("color", &style.color),
        ("format", &style.format),
    ];
    for (key, value) in texts {
        if let Some(value) = value {
            item.insert(txn, key, value.clone());
        }
    }
}

/// 填充時連樣式一起帶過去。
fn copy_style(item: &MapRef, txn: &mut TransactionMut, cell: Option<&RawCell>) {
    let blank = RawCell::default();
    let cell = cell.unwrap_or(&blank);
    item.insert(txn, "bold", cell.bold);
    item.insert(txn, "italic", cell.italic);
    item.insert(txn, "underline", cell.underline);
    item.insert(txn, "strike", cell.strike);
    let texts = [
        ("align", &cell.align),
        ("valign", &cell.valign),
        ("fill", &cell.fill),
        ("color", &cell.color),
        ("format", &cell.format),
    ];
    for (key, value) in texts {
        item.insert(txn, key, value.clone().unwrap_or_default());
    }
}

/// 排序用的比較：數字在文字前面，空白永遠在最後。
fn sort_order(a: &Value, b: &Value) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.total_cmp(b),
        (Value::Text(a), Value::Text(b)) => a.to_lowercase().cmp(&b.to_lowercase()),
        (Value::Number(_), _) => Ordering::Less,
        (_, Value::Number(_)) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}

impl Alexa {
    pub(super) fn init_sheet(&mut self, note_id: &str) -> Result<(), String> {
        let key = key_between(None, None)?;
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            let tab_id = new_id();
            let tab = roots[0].insert(txn, tab_id.as_str(), MapPrelim::default());
            tab.insert(txn, "name", "工作表1".to_string());
            tab.insert(txn, "orderKey", key.clone());
            write_table(txn, roots, &tab_id, "表格1", 40.0, 40.0, key)
        })?;
        self.forget_history(note_id);
        Ok(())
    }

    fn sheet_data(&mut self, note_id: &str) -> Result<SheetData, String> {
        self.check_type(note_id, NoteType::Sheet)?;
        self.ensure_note(note_id)?;
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let roots = ROOTS.map(|name| note.doc.get_or_insert_map(name));
        let txn = note.doc.transact();
        Ok(read_data(&txn, &roots))
    }

    /// 依分頁順序列出表格。Library 要列出每份 Excels，這裡不計算公式。
    pub(super) fn sheet_tables(&mut self, note_id: &str) -> Result<Vec<SheetTableInfo>, String> {
        let data = self.sheet_data(note_id)?;
        let tab_order = |tab_id: &str| data.tabs.iter().position(|tab| tab.0 == tab_id).unwrap_or(usize::MAX);
        let mut tables: Vec<&RawTable> = data.tables.iter().collect();
        tables.sort_by_key(|table| tab_order(&table.tab_id));
        Ok(tables
            .into_iter()
            .map(|table| SheetTableInfo {
                id: table.id.clone(),
                name: table.name.clone(),
                rows: table.rows.len(),
                cols: table.cols.len(),
            })
            .collect())
    }

    pub fn sheet(&mut self, note_id: &str) -> Result<SheetState, String> {
        let mut state = render(&self.sheet_data(note_id)?);
        // 圖表被刪除後，頁面上的位置就沒有意義了。
        let mut objects = std::mem::take(&mut state.objects);
        objects.retain_mut(|object| match self.note_type(&object.note_id) {
            Some(kind) => {
                object.note_type = kind;
                true
            }
            None => false,
        });
        state.objects = objects;
        Ok(state)
    }

    pub(super) fn refresh_sheet_summary(&mut self, note_id: &str) -> Result<(), String> {
        let state = self.sheet(note_id)?;
        let mut lines = Vec::new();
        if let Some(table) = state.tables.first() {
            for row in table.rows.iter().take(SUMMARY_ROWS) {
                let line: Vec<&str> = table
                    .cols
                    .iter()
                    .filter_map(|col| table.cells.get(&cell_key(&row.id, &col.id)))
                    .map(|cell| cell.display.as_str())
                    .filter(|text| !text.is_empty())
                    .collect();
                if !line.is_empty() {
                    lines.push(line.join(" · "));
                }
            }
        }
        self.set_summary(note_id, &lines.join("\n"))
    }

    pub fn edit_sheet(&mut self, note_id: &str, op: SheetOp) -> Result<SheetState, String> {
        let data = self.sheet_data(note_id)?;
        self.split_undo_step(note_id);
        self.apply_sheet(note_id, &data, op)?;
        self.split_undo_step(note_id);
        self.refresh_sheet_summary(note_id)?;
        self.sheet(note_id)
    }

    fn apply_sheet(&mut self, note_id: &str, data: &SheetData, op: SheetOp) -> Result<(), String> {
        match op {
            SheetOp::AddTab => {
                let last = data.tabs.last().map(|tab| tab.2.clone());
                let key = key_between(last.as_deref(), None)?;
                let name = next_name(data.tabs.iter().map(|tab| tab.1.clone()), "工作表");
                let table_name = next_name(data.tables.iter().map(|table| table.name.clone()), "表格");
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    let tab_id = new_id();
                    let tab = roots[0].insert(txn, tab_id.as_str(), MapPrelim::default());
                    tab.insert(txn, "name", name);
                    tab.insert(txn, "orderKey", key.clone());
                    write_table(txn, roots, &tab_id, &table_name, 40.0, 40.0, key)
                })
            }
            SheetOp::RenameTab { id, name } => self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                item_of(&roots[0], txn, &id, "tab")?.insert(txn, "name", name.trim().to_string());
                Ok(())
            }),
            SheetOp::DeleteTab { id } => {
                if data.tabs.len() < 2 {
                    return Err("至少要留一個分頁".to_string());
                }
                let ids: Vec<&RawTable> = data.tables.iter().filter(|table| table.tab_id == id).collect();
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    roots[0].remove(txn, &id);
                    for table in ids {
                        remove_table(txn, roots, data, table);
                    }
                    for object in data.objects.iter().filter(|object| object.tab_id == id) {
                        roots[5].remove(txn, &object.id);
                    }
                    Ok(())
                })
            }
            SheetOp::AddTable { tab_id, x, y } => {
                if !data.tabs.iter().any(|tab| tab.0 == tab_id) {
                    return Err(format!("unknown tab: {tab_id}"));
                }
                let last = data.tables.last().map(|table| table.key.clone());
                let key = key_between(last.as_deref(), None)?;
                let name = next_name(data.tables.iter().map(|table| table.name.clone()), "表格");
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    write_table(txn, roots, &tab_id, &name, x.max(0.0), y.max(0.0), key)
                })
            }
            SheetOp::PatchTable { id, name, x, y, header_rows, header_cols, footer_rows, filter } => {
                let table = table_of(data, &id)?;
                if name.as_deref().is_some_and(|name| {
                    name.trim().is_empty() || data.tables.iter().any(|other| other.id != id && other.name == name.trim())
                }) {
                    return Err("表格名稱不能空白或重複".to_string());
                }
                let rows = table.rows.len();
                let cols = table.cols.len();
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    let item = item_of(&roots[1], txn, &id, "table")?;
                    if let Some(name) = name {
                        item.insert(txn, "name", name.trim().to_string());
                    }
                    if let Some(x) = x {
                        item.insert(txn, "x", x.max(0.0));
                    }
                    if let Some(y) = y {
                        item.insert(txn, "y", y.max(0.0));
                    }
                    if let Some(count) = header_rows {
                        item.insert(txn, "headerRows", count.min(rows) as f64);
                    }
                    if let Some(count) = header_cols {
                        item.insert(txn, "headerCols", count.min(cols) as f64);
                    }
                    if let Some(count) = footer_rows {
                        item.insert(txn, "footerRows", count.min(rows) as f64);
                    }
                    if let Some(on) = filter {
                        item.insert(txn, "filterOn", on);
                        if !on {
                            item.remove(txn, "filters");
                        } else if table.header_rows == 0 && header_rows.is_none() {
                            // 篩選按鈕放在標題列上，第一列就當標題。
                            item.insert(txn, "headerRows", 1.0);
                        }
                    }
                    Ok(())
                })
            }
            SheetOp::DeleteTable { id } => {
                let table = table_of(data, &id)?;
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    remove_table(txn, roots, data, table);
                    Ok(())
                })
            }
            SheetOp::InsertRows { table_id, after, before, count } => {
                self.insert_axes(note_id, data, &table_id, after.as_deref(), before.as_deref(), count, true)
            }
            SheetOp::InsertCols { table_id, after, before, count } => {
                self.insert_axes(note_id, data, &table_id, after.as_deref(), before.as_deref(), count, false)
            }
            SheetOp::DeleteRows { table_id, ids } => {
                let table = table_of(data, &table_id)?;
                if ids.len() >= table.rows.len() {
                    return Err("表格至少要留一列".to_string());
                }
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    for id in &ids {
                        roots[2].remove(txn, id.as_str());
                        for col in &table.cols {
                            roots[4].remove(txn, cell_key(id, &col.id).as_str());
                        }
                    }
                    Ok(())
                })
            }
            SheetOp::DeleteCols { table_id, ids } => {
                let table = table_of(data, &table_id)?;
                if ids.len() >= table.cols.len() {
                    return Err("表格至少要留一欄".to_string());
                }
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    for id in &ids {
                        roots[3].remove(txn, id.as_str());
                        for row in &table.rows {
                            roots[4].remove(txn, cell_key(&row.id, id).as_str());
                        }
                    }
                    Ok(())
                })
            }
            SheetOp::SetRowHeight { id, size } => self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                item_of(&roots[2], txn, &id, "row")?.insert(txn, "size", size.max(MIN_SIZE));
                Ok(())
            }),
            SheetOp::SetColWidth { id, size } => self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                item_of(&roots[3], txn, &id, "col")?.insert(txn, "size", size.max(MIN_SIZE));
                Ok(())
            }),
            SheetOp::SetCells { cells } => {
                let stored = stored_cells(data, cells)?;
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    for (key, value) in stored {
                        let item = cell_item(&roots[4], txn, &key);
                        set_text(&item, txn, "value", &value);
                    }
                    Ok(())
                })
            }
            SheetOp::Paste { table_id, row, col, values } => self.paste(note_id, data, &table_id, &row, &col, values),
            SheetOp::Clear { rows, cols } => {
                let keys: Vec<String> = rows
                    .iter()
                    .flat_map(|row| cols.iter().map(move |col| cell_key(row, col)))
                    .filter(|key| data.cells.contains_key(key))
                    .collect();
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    for key in keys {
                        let item = cell_item(&roots[4], txn, &key);
                        set_text(&item, txn, "value", "");
                    }
                    Ok(())
                })
            }
            SheetOp::SetStyle { rows, cols, style } => {
                valid_style(&style)?;
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    for row in &rows {
                        for col in &cols {
                            let item = cell_item(&roots[4], txn, &cell_key(row, col));
                            apply_style(&item, txn, &style);
                        }
                    }
                    Ok(())
                })
            }
            SheetOp::Sort { table_id, col_id, descending } => self.sort_rows(note_id, data, &table_id, &col_id, descending),
            SheetOp::MergeCells { table_id, rows, cols } => self.merge_cells(note_id, data, &table_id, rows, cols),
            SheetOp::UnmergeCells { table_id, rows, cols } => {
                let table = table_of(data, &table_id)?;
                let area = box_of(table, &rows, &cols)?;
                let kept: Vec<&StoredMerge> =
                    live_merges(table).into_iter().filter(|(_, merge)| !overlaps(merge, &area)).map(|(stored, _)| stored).collect();
                self.write_table_json(note_id, &table_id, "merges", &kept)
            }
            SheetOp::SetFilter { table_id, col_id, values } => {
                let table = table_of(data, &table_id)?;
                if !table.cols.iter().any(|col| col.id == col_id) {
                    return Err(format!("unknown col: {col_id}"));
                }
                let mut filters = table.filters.clone();
                match values {
                    Some(values) => filters.insert(col_id, values),
                    None => filters.remove(&col_id),
                };
                self.write_table_json(note_id, &table_id, "filters", &filters)
            }
            SheetOp::Fill { table_id, source_rows, source_cols, target_rows, target_cols, series } => {
                self.fill(note_id, data, &table_id, FillArea { source_rows, source_cols, target_rows, target_cols }, series)
            }
            SheetOp::PlaceCard { tab_id, target, x, y } => {
                if !data.tabs.iter().any(|tab| tab.0 == tab_id) {
                    return Err(format!("unknown tab: {tab_id}"));
                }
                self.check_placeable(Some(&target))?;
                // 和白板一樣，同一張卡片在一個分頁上只放一次。
                if data.objects.iter().any(|object| object.tab_id == tab_id && object.note_id == target) {
                    return Ok(());
                }
                self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                    let item = roots[5].insert(txn, new_id().as_str(), MapPrelim::default());
                    item.insert(txn, "tabId", tab_id.clone());
                    item.insert(txn, "noteId", target.clone());
                    item.insert(txn, "x", (x - CARD_SIZE.0 / 2.0).max(0.0));
                    item.insert(txn, "y", (y - CARD_SIZE.1 / 2.0).max(0.0));
                    item.insert(txn, "w", CARD_SIZE.0);
                    item.insert(txn, "h", CARD_SIZE.1);
                    Ok(())
                })
            }
            SheetOp::MoveObject { id, x, y, w, h } => self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                let item = item_of(&roots[5], txn, &id, "object")?;
                item.insert(txn, "x", x.max(0.0));
                item.insert(txn, "y", y.max(0.0));
                item.insert(txn, "w", w.max(120.0));
                item.insert(txn, "h", h.max(90.0));
                Ok(())
            }),
            SheetOp::RemoveObject { id } => self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
                roots[5].remove(txn, &id);
                Ok(())
            }),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_axes(
        &mut self,
        note_id: &str,
        data: &SheetData,
        table_id: &str,
        after: Option<&str>,
        before: Option<&str>,
        count: usize,
        is_row: bool,
    ) -> Result<(), String> {
        let table = table_of(data, table_id)?;
        let axes = if is_row { &table.rows } else { &table.cols };
        let find = |id: &str| axes.iter().position(|axis| axis.id == id).ok_or_else(|| format!("unknown axis: {id}"));
        let index = match (after, before) {
            (Some(id), _) => Some(find(id)?),
            (_, Some(id)) => find(id)?.checked_sub(1),
            // 兩個都沒給就加在最後，表格角落的控制點用這個。
            _ => axes.len().checked_sub(1),
        };
        let keys = keys_after(axes, index, count.clamp(1, MAX_INSERT))?;
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            for key in keys {
                new_axis(txn, &roots[if is_row { 2 } else { 3 }], &new_id(), table_id, key);
            }
            Ok(())
        })
    }

    /// 貼上時超出表格的部分會自動長出列與欄。
    fn paste(
        &mut self,
        note_id: &str,
        data: &SheetData,
        table_id: &str,
        row: &str,
        col: &str,
        values: Vec<Vec<String>>,
    ) -> Result<(), String> {
        let table = table_of(data, table_id)?;
        let first_row = table.rows.iter().position(|axis| axis.id == row).ok_or("unknown row")?;
        let first_col = table.cols.iter().position(|axis| axis.id == col).ok_or("unknown col")?;
        let height = values.len();
        let width = values.iter().map(Vec::len).max().unwrap_or(0);
        let extra_rows = (first_row + height).saturating_sub(table.rows.len());
        let extra_cols = (first_col + width).saturating_sub(table.cols.len());
        if extra_rows > MAX_INSERT || extra_cols > MAX_INSERT {
            return Err("貼上的內容太大".to_string());
        }
        let row_keys = keys_after(&table.rows, table.rows.len().checked_sub(1), extra_rows)?;
        let col_keys = keys_after(&table.cols, table.cols.len().checked_sub(1), extra_cols)?;
        let row_ids: Vec<String> = table
            .rows
            .iter()
            .map(|axis| axis.id.clone())
            .chain(row_keys.iter().map(|_| new_id()))
            .collect();
        let col_ids: Vec<String> = table
            .cols
            .iter()
            .map(|axis| axis.id.clone())
            .chain(col_keys.iter().map(|_| new_id()))
            .collect();
        let mut writes = Vec::new();
        for (y, line) in values.into_iter().enumerate() {
            for (x, raw) in line.into_iter().enumerate() {
                writes.push(CellInput {
                    row: row_ids[first_row + y].clone(),
                    col: col_ids[first_col + x].clone(),
                    raw,
                });
            }
        }
        let table_index = data.tables.iter().position(|other| other.id == table_id).unwrap_or(0);
        let layout = SheetLayout { data, table: table_index };
        let stored: Vec<(String, String)> = writes
            .into_iter()
            .map(|cell| (cell_key(&cell.row, &cell.col), formula::to_stored(&cell.raw, &layout)))
            .collect();
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            for (id, key) in row_ids[table.rows.len()..].iter().zip(row_keys) {
                new_axis(txn, &roots[2], id, table_id, key);
            }
            for (id, key) in col_ids[table.cols.len()..].iter().zip(col_keys) {
                new_axis(txn, &roots[3], id, table_id, key);
            }
            for (key, value) in stored {
                let item = cell_item(&roots[4], txn, &key);
                set_text(&item, txn, "value", &value);
            }
            Ok(())
        })
    }

    fn write_table_json<T: Serialize>(&mut self, note_id: &str, table_id: &str, key: &'static str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            item_of(&roots[1], txn, table_id, "table")?.insert(txn, key, json);
            Ok(())
        })
    }

    /// 重疊的舊合併併進新範圍。內容留在左上角，取第一個有內容的格子。
    fn merge_cells(&mut self, note_id: &str, data: &SheetData, table_id: &str, rows: Vec<String>, cols: Vec<String>) -> Result<(), String> {
        let table = table_of(data, table_id)?;
        let mut area = box_of(table, &rows, &cols)?;
        let live = live_merges(table);
        // 長大之後可能又碰到別的合併，要重複到不再變大。
        while let Some((_, merge)) = live.iter().find(|(_, merge)| overlaps(merge, &area) && !covers(&area, merge)) {
            let bottom = (area.top + area.rows).max(merge.top + merge.rows);
            let right = (area.left + area.cols).max(merge.left + merge.cols);
            area.top = area.top.min(merge.top);
            area.left = area.left.min(merge.left);
            area.rows = bottom - area.top;
            area.cols = right - area.left;
        }
        if area.rows * area.cols < 2 {
            return Err("至少要選兩格才能合併".to_string());
        }
        let row_ids: Vec<&str> = table.rows[area.top..area.top + area.rows].iter().map(|row| row.id.as_str()).collect();
        let col_ids: Vec<&str> = table.cols[area.left..area.left + area.cols].iter().map(|col| col.id.as_str()).collect();
        let keys: Vec<String> = row_ids.iter().flat_map(|row| col_ids.iter().map(move |col| cell_key(row, col))).collect();
        let kept = keys.iter().find_map(|key| data.cells.get(key).map(|cell| cell.value.clone()).filter(|value| !value.is_empty()));
        let mut merges: Vec<StoredMerge> =
            live.iter().filter(|(_, merge)| !overlaps(merge, &area)).map(|(stored, _)| (*stored).clone()).collect();
        merges.push(StoredMerge {
            rows: row_ids.iter().map(ToString::to_string).collect(),
            cols: col_ids.iter().map(ToString::to_string).collect(),
        });
        let json = serde_json::to_string(&merges).map_err(|e| e.to_string())?;
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            for key in keys.iter().filter(|key| data.cells.contains_key(*key)) {
                let item = cell_item(&roots[4], txn, key);
                set_text(&item, txn, "value", "");
            }
            if let Some(value) = &kept {
                let item = cell_item(&roots[4], txn, &keys[0]);
                set_text(&item, txn, "value", value);
            }
            item_of(&roots[1], txn, table_id, "table")?.insert(txn, "merges", json);
            Ok(())
        })
    }

    /// 兩種填充：`series` 沿著拖曳方向推算；否則來源重複鋪滿目標，貼上公式和 Ctrl+D 用這個。
    fn fill(&mut self, note_id: &str, data: &SheetData, table_id: &str, area: FillArea, use_series: bool) -> Result<(), String> {
        let table = table_of(data, table_id)?;
        let table_index = data.tables.iter().position(|other| other.id == table_id).unwrap_or(0);
        let layout = SheetLayout { data, table: table_index };
        let FillArea { source_rows, source_cols, target_rows, target_cols } = &area;
        if source_rows.is_empty() || source_cols.is_empty() {
            return Err("沒有可以填充的內容".to_string());
        }
        let row_at = |id: &str| table.rows.iter().position(|row| row.id == id).ok_or_else(|| format!("unknown row: {id}"));
        let col_at = |id: &str| table.cols.iter().position(|col| col.id == id).ok_or_else(|| format!("unknown col: {id}"));
        let shown = |row: &str, col: &str| {
            data.cells.get(&cell_key(row, col)).map_or(String::new(), |cell| formula::to_display(&cell.value, &layout))
        };
        let down = target_rows.iter().any(|row| !source_rows.contains(row));
        let across = target_cols.iter().any(|col| !source_cols.contains(col));
        let mut writes: Vec<(String, String, Option<&RawCell>)> = Vec::new();
        let mut write = |to: (&str, &str), from: (&str, &str), text: Option<String>| -> Result<(), String> {
            let raw = match text {
                Some(text) => text,
                None => {
                    let rows = row_at(to.0)? as i64 - row_at(from.0)? as i64;
                    let cols = col_at(to.1)? as i64 - col_at(from.1)? as i64;
                    formula::shift_refs(&shown(from.0, from.1), rows, cols)
                }
            };
            writes.push((cell_key(to.0, to.1), formula::to_stored(&raw, &layout), data.cells.get(&cell_key(from.0, from.1))));
            Ok(())
        };
        if use_series && down != across {
            // 沿著拖曳方向走的是「線」，另一個方向一條線一條線處理。
            let (line_sources, line_targets, steps_from, steps_to) = if down {
                (source_cols, target_cols, source_rows, target_rows)
            } else {
                (source_rows, target_rows, source_cols, target_cols)
            };
            let mut order: Vec<&String> = steps_from.iter().chain(steps_to.iter()).collect();
            let at = |id: &str| if down { row_at(id) } else { col_at(id) };
            order.sort_by_key(|id| at(id).unwrap_or(0));
            order.dedup();
            let start = order.iter().position(|id| **id == steps_from[0]).unwrap_or(0) as i64;
            for (line, line_target) in line_targets.iter().enumerate() {
                let line_source = &line_sources[line % line_sources.len()];
                let place = |step: &str| if down { (step.to_string(), line_source.clone()) } else { (line_source.clone(), step.to_string()) };
                let samples: Vec<String> = steps_from.iter().map(|step| { let (row, col) = place(step); shown(&row, &col) }).collect();
                for step in steps_to {
                    let offset = order.iter().position(|id| *id == step).unwrap_or(0) as i64 - start;
                    let to = if down { (step.as_str(), line_target.as_str()) } else { (line_target.as_str(), step.as_str()) };
                    let (sample, text) = match series(&samples, offset) {
                        Filled::Copy(sample) => (sample, None),
                        Filled::Text(text) => (offset.rem_euclid(samples.len() as i64) as usize, Some(text)),
                    };
                    let (row, col) = place(&steps_from[sample]);
                    write(to, (&row, &col), text)?;
                }
            }
        } else {
            for (y, row) in target_rows.iter().enumerate() {
                for (x, col) in target_cols.iter().enumerate() {
                    write((row, col), (&source_rows[y % source_rows.len()], &source_cols[x % source_cols.len()]), None)?;
                }
            }
        }
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            for (key, value, cell) in writes {
                let item = cell_item(&roots[4], txn, &key);
                set_text(&item, txn, "value", &value);
                copy_style(&item, txn, cell);
            }
            Ok(())
        })
    }

    /// 只排內容列，標題列與總計列不動。列本身換位置，別處指向這些列的引入會跟著內容走。
    fn sort_rows(
        &mut self,
        note_id: &str,
        data: &SheetData,
        table_id: &str,
        col_id: &str,
        descending: bool,
    ) -> Result<(), String> {
        let table = table_of(data, table_id)?;
        let table_index = data.tables.iter().position(|other| other.id == table_id).unwrap_or(0);
        let start = table.header_rows.min(table.rows.len());
        let end = table.rows.len().saturating_sub(table.footer_rows).max(start);
        // 跨列的合併沒辦法拆開來排。
        if live_merges(table).iter().any(|(_, merge)| merge.rows > 1 && merge.top < end && merge.top + merge.rows > start) {
            return Err("內容列有跨列合併的格子，先取消合併才能排序".to_string());
        }
        let mut calc = Calc::new(data);
        let mut rows: Vec<(&RawAxis, Value)> = table.rows[start..end]
            .iter()
            .map(|row| (row, calc.value_of(table_index, &row.id, col_id)))
            .collect();
        rows.sort_by(|a, b| {
            // 空白不管升降冪都在最後。
            match (a.1 == Value::Empty, b.1 == Value::Empty) {
                (true, false) => std::cmp::Ordering::Greater,
                (false, true) => std::cmp::Ordering::Less,
                _ if descending => sort_order(&b.1, &a.1),
                _ => sort_order(&a.1, &b.1),
            }
        });
        let keys: Vec<String> = table.rows[start..end].iter().map(|row| row.key.clone()).collect();
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            for ((row, _), key) in rows.iter().zip(keys) {
                item_of(&roots[2], txn, &row.id, "row")?.insert(txn, "orderKey", key);
            }
            Ok(())
        })
    }

    /// 把圖表放到試算表頁面上，位置在表格右邊。
    pub(super) fn add_sheet_object(
        &mut self,
        note_id: &str,
        tab_id: &str,
        chart_id: &str,
        table_id: &str,
    ) -> Result<(), String> {
        let data = self.sheet_data(note_id)?;
        let table = table_of(&data, table_id)?;
        let width: f64 = table.cols.iter().map(|col| col.size).sum();
        let (x, y) = (table.x + width + TABLE_GAP, table.y);
        self.office_edit(note_id, NoteType::Sheet, ROOTS, |txn, roots| {
            let item = roots[5].insert(txn, new_id().as_str(), MapPrelim::default());
            item.insert(txn, "tabId", tab_id.to_string());
            item.insert(txn, "noteId", chart_id.to_string());
            item.insert(txn, "x", x);
            item.insert(txn, "y", y);
            item.insert(txn, "w", OBJECT_SIZE.0);
            item.insert(txn, "h", OBJECT_SIZE.1);
            Ok(())
        })
    }

    /// 引入與圖表的資料。範圍的列欄可能已被刪除：記著當初選到的所有 id，
    /// 以還存在的頭尾為界，中間新插入的列也算在內。全部不見時回報原因，不是錯誤。
    pub fn cell_range(&mut self, source: &CellRange) -> Result<RangeView, String> {
        let fail = |message: &str| RangeView {
            title: String::new(),
            table_name: String::new(),
            header_rows: 0,
            header_cols: 0,
            col_sizes: Vec::new(),
            row_ids: Vec::new(),
            col_ids: Vec::new(),
            rows: Vec::new(),
            error: Some(message.to_string()),
        };
        if self.note_type(&source.note_id).as_deref() != Some(NoteType::Sheet.as_str()) {
            return Ok(fail("來源試算表已被刪除"));
        }
        let state = self.sheet(&source.note_id)?;
        let Some(table) = state.tables.iter().find(|table| table.id == source.table_id) else {
            return Ok(fail("來源表格已被刪除"));
        };
        let span = |axes: &[SheetAxis], wanted: &[String]| {
            let found: Vec<usize> = axes
                .iter()
                .enumerate()
                .filter(|(_, axis)| wanted.contains(&axis.id))
                .map(|(index, _)| index)
                .collect();
            Some((*found.first()?, *found.last()?))
        };
        let (Some((top, bottom)), Some((left, right))) = (span(&table.rows, &source.rows), span(&table.cols, &source.cols))
        else {
            return Ok(fail("來源的列或欄已被刪除"));
        };
        let empty = view_of(&Value::Empty, String::new(), None);
        let rows = table.rows[top..=bottom]
            .iter()
            .map(|row| {
                table.cols[left..=right]
                    .iter()
                    .map(|col| table.cells.get(&cell_key(&row.id, &col.id)).cloned().unwrap_or_else(|| empty.clone()))
                    .collect()
            })
            .collect();
        let note = self.note(&source.note_id)?;
        Ok(RangeView {
            title: note.map(|note| self.note_name(&note.id)).unwrap_or_default(),
            table_name: table.name.clone(),
            header_rows: table.header_rows.saturating_sub(top).min(bottom - top + 1),
            header_cols: table.header_cols.saturating_sub(left).min(right - left + 1),
            col_sizes: table.cols[left..=right].iter().map(|col| col.size).collect(),
            row_ids: table.rows[top..=bottom].iter().map(|row| row.id.clone()).collect(),
            col_ids: table.cols[left..=right].iter().map(|col| col.id.clone()).collect(),
            rows,
            error: None,
        })
    }

    pub(super) fn note_name(&self, note_id: &str) -> String {
        self.context_string(note_id, "name").unwrap_or_default()
    }
}

fn remove_table(txn: &mut TransactionMut, roots: &[MapRef; 6], data: &SheetData, table: &RawTable) {
    roots[1].remove(txn, &table.id);
    for row in &table.rows {
        roots[2].remove(txn, &row.id);
        for col in &table.cols {
            let key = cell_key(&row.id, &col.id);
            if data.cells.contains_key(&key) {
                roots[4].remove(txn, key.as_str());
            }
        }
    }
    for col in &table.cols {
        roots[3].remove(txn, &col.id);
    }
}

fn stored_cells(data: &SheetData, cells: Vec<CellInput>) -> Result<Vec<(String, String)>, String> {
    cells
        .into_iter()
        .map(|cell| {
            let (table, _) = *data.row_at.get(&cell.row).ok_or_else(|| format!("unknown row: {}", cell.row))?;
            if !data.col_at.contains_key(&cell.col) {
                return Err(format!("unknown col: {}", cell.col));
            }
            let layout = SheetLayout { data, table };
            Ok((cell_key(&cell.row, &cell.col), formula::to_stored(&cell.raw, &layout)))
        })
        .collect()
}
