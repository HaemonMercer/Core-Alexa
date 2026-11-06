//! Writer：參考 Notion 的區塊式文件。每個區塊是 `blocks` 裡的一個 Y.Map，順序靠 `orderKey`，
//! 層級靠 `indent`。文字是行內 Markdown，放在 Y.Text，Rust 只儲存不解析。
//! 文件至少有一個區塊，游標才有地方放。

use super::card_markdown::{blocks_from_markdown, markdown_from_blocks, ImageFile};
use super::media::image_file;
use super::office::{field_flag, field_number, field_string, field_text, plain_inline, set_text, sort_by_key};
use super::types::{
    BlockSide, CellRange, NoteType, PageNumber, WriterBand, WriterBlock, WriterEdit, WriterFocus, WriterOp, WriterPage,
};
use super::yjs::new_id;
use super::Alexa;
use crate::order::key_between;
use std::collections::{BTreeSet, HashMap};
use yrs::{GetString, Map, MapPrelim, MapRef, Out, ReadTxn, Transact, TransactionMut};

const BLOCKS: [&str; 1] = ["blocks"];
const MAX_INDENT: u32 = 6;
const PARAGRAPH: &str = "paragraph";
const PAGE: [&str; 1] = ["page"];
const MAX_COLUMNS: usize = 6;
const MIN_IMAGE_WIDTH: f64 = 10.0;
const MAX_IMAGE_WIDTH: f64 = 100.0;
const MAX_TABLE_ROWS: usize = 500;
const MAX_TABLE_COLS: usize = 50;
const DEFAULT_SIZE: &str = "A4";
const DEFAULT_MARGIN: &str = "normal";
const DEFAULT_NUMBER_PLACE: &str = "none";
const DEFAULT_NUMBER_ALIGN: &str = "center";
const DEFAULT_NUMBER_FORMAT: &str = "plain";

fn valid_size(size: &str) -> bool {
    matches!(size, "A3" | "A4" | "A5" | "B4" | "B5" | "Letter" | "Legal")
}

fn valid_margin(margin: &str) -> bool {
    matches!(margin, "narrow" | "normal" | "wide")
}

fn valid_number_place(place: &str) -> bool {
    matches!(place, "none" | "header" | "footer")
}

fn valid_number_align(align: &str) -> bool {
    matches!(align, "left" | "center" | "right")
}

fn valid_number_format(format: &str) -> bool {
    matches!(format, "plain" | "chinese" | "fraction" | "chineseTotal")
}

fn read_band<T: ReadTxn>(page: &MapRef, txn: &T, prefix: &str) -> WriterBand {
    let slot = |name: &str| field_string(page, txn, &format!("{prefix}{name}")).unwrap_or_default();
    WriterBand { left: slot("Left"), center: slot("Center"), right: slot("Right") }
}

/// 只寫有變的值。打字時一直存，每次全部重寫會讓文件記錄越長越大。
fn put_string(page: &MapRef, txn: &mut TransactionMut, key: &str, value: &str) {
    if field_string(page, txn, key).unwrap_or_default() != value {
        page.insert(txn, key, value.to_string());
    }
}

fn put_flag(page: &MapRef, txn: &mut TransactionMut, key: &str, value: bool) {
    if field_flag(page, txn, key) != value {
        page.insert(txn, key, value);
    }
}

fn put_band(page: &MapRef, txn: &mut TransactionMut, prefix: &str, band: &WriterBand) {
    for (name, text) in [("Left", &band.left), ("Center", &band.center), ("Right", &band.right)] {
        put_string(page, txn, &format!("{prefix}{name}"), text);
    }
}

/// 放進文件的卡片，內容仍在原本的筆記。
const CARD: &str = "card";

fn valid_kind(kind: &str) -> bool {
    matches!(
        kind,
        "paragraph" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "toggle" | "quote" | "callout"
            | "code" | "divider" | "cells" | "chart" | "image" | "table" | "pagebreak" | "toc" | CARD
    )
}

fn has_text(kind: &str) -> bool {
    !matches!(kind, "divider" | "cells" | "chart" | "image" | "table" | "pagebreak" | "toc" | CARD)
}

/// 每一列補到一樣寬。太大的表格拒絕，不要默默截掉內容。
fn normal_table(mut rows: Vec<Vec<String>>) -> Result<Vec<Vec<String>>, String> {
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    if width == 0 {
        return Err("table has no cells".to_string());
    }
    if rows.len() > MAX_TABLE_ROWS || width > MAX_TABLE_COLS {
        return Err(format!("table is too large: {} × {width}", rows.len()));
    }
    for row in &mut rows {
        row.resize(width, String::new());
    }
    Ok(rows)
}

/// 按 Enter 後新區塊的類型：清單會接續，標題之類的回到段落。
fn next_kind(kind: &str) -> &str {
    match kind {
        "bullet" | "number" | "todo" => kind,
        _ => PARAGRAPH,
    }
}

fn is_list(kind: &str) -> bool {
    matches!(kind, "bullet" | "number" | "todo" | "toggle")
}

struct Raw {
    block: WriterBlock,
    key: String,
}

fn read_blocks<T: ReadTxn>(txn: &T, blocks: &MapRef) -> Vec<Raw> {
    let mut raw: Vec<Raw> = blocks
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            Some(Raw {
                key: field_string(&item, txn, "orderKey").unwrap_or_default(),
                block: WriterBlock {
                    id: id.to_string(),
                    kind: field_string(&item, txn, "kind").unwrap_or_else(|| PARAGRAPH.to_string()),
                    text: field_text(&item, txn, "text"),
                    indent: field_number(&item, txn, "indent") as u32,
                    checked: field_flag(&item, txn, "checked"),
                    collapsed: field_flag(&item, txn, "collapsed"),
                    language: field_string(&item, txn, "language"),
                    note_id: field_string(&item, txn, "noteId"),
                    source: field_string(&item, txn, "source").and_then(|json| serde_json::from_str(&json).ok()),
                    table: field_string(&item, txn, "table").and_then(|json| serde_json::from_str(&json).ok()),
                    group: field_string(&item, txn, "group"),
                    column: field_number(&item, txn, "column") as u32,
                    align: field_string(&item, txn, "align").filter(|align| !align.is_empty()),
                    width: Some(field_number(&item, txn, "width")).filter(|width| *width > 0.0),
                },
            })
        })
        .collect();
    sort_by_key(&mut raw, |item| (item.key.as_str(), item.block.id.as_str()));
    tidy_columns(&mut raw);
    raw
}

/// 一欄被刪光或搬空之後編號會有缺口，只剩一欄時就是普通區塊。
/// 讀取時才整理，同步合併後的結果也會是對的。
fn tidy_columns(raw: &mut [Raw]) {
    let mut start = 0;
    while start < raw.len() {
        let group = raw[start].block.group.clone();
        let end = raw[start..].iter().position(|item| item.block.group != group).map_or(raw.len(), |at| start + at);
        let columns: Vec<u32> = raw[start..end].iter().map(|item| item.block.column).collect::<BTreeSet<_>>().into_iter().collect();
        for item in &mut raw[start..end] {
            if columns.len() < 2 {
                item.block.group = None;
                item.block.column = 0;
            } else {
                item.block.column = columns.iter().position(|column| *column == item.block.column).unwrap_or(0) as u32;
            }
        }
        start = end;
    }
}

fn item_of<T: ReadTxn>(blocks: &MapRef, txn: &T, id: &str) -> Result<MapRef, String> {
    match blocks.get(txn, id) {
        Some(Out::YMap(item)) => Ok(item),
        _ => Err(format!("unknown block: {id}")),
    }
}

fn position(raw: &[Raw], id: &str) -> Result<usize, String> {
    raw.iter().position(|item| item.block.id == id).ok_or_else(|| format!("unknown block: {id}"))
}

struct NewBlock<'a> {
    kind: &'a str,
    text: &'a str,
    indent: u32,
    note_id: Option<&'a str>,
    source: Option<&'a CellRange>,
    language: Option<&'a str>,
    table: Option<&'a Vec<Vec<String>>>,
    group: Option<&'a str>,
    column: u32,
    align: Option<&'a str>,
    width: Option<f64>,
}

impl<'a> NewBlock<'a> {
    fn plain(kind: &'a str, text: &'a str, indent: u32) -> Self {
        Self {
            kind,
            text,
            indent,
            note_id: None,
            source: None,
            language: None,
            table: None,
            group: None,
            column: 0,
            align: None,
            width: None,
        }
    }

    /// 放在和 `block` 同一欄。
    fn beside(self, block: &'a WriterBlock) -> Self {
        Self { group: block.group.as_deref(), column: block.column, align: block.align.as_deref(), ..self }
    }
}

fn write_block(txn: &mut TransactionMut, blocks: &MapRef, id: &str, key: String, block: NewBlock) -> Result<(), String> {
    let item = blocks.insert(txn, id, MapPrelim::default());
    item.insert(txn, "orderKey", key);
    item.insert(txn, "kind", block.kind.to_string());
    item.insert(txn, "indent", block.indent as f64);
    if has_text(block.kind) {
        set_text(&item, txn, "text", block.text);
    }
    if let Some(note_id) = block.note_id {
        item.insert(txn, "noteId", note_id.to_string());
    }
    if let Some(source) = block.source {
        item.insert(txn, "source", serde_json::to_string(source).map_err(|e| e.to_string())?);
    }
    if let Some(language) = block.language {
        item.insert(txn, "language", language.to_string());
    }
    if let Some(table) = block.table {
        item.insert(txn, "table", serde_json::to_string(table).map_err(|e| e.to_string())?);
    }
    if let Some(group) = block.group {
        item.insert(txn, "group", group.to_string());
        item.insert(txn, "column", block.column as f64);
    }
    if let Some(align) = block.align {
        item.insert(txn, "align", align.to_string());
    }
    if let Some(width) = block.width {
        item.insert(txn, "width", width);
    }
    Ok(())
}

/// 緊接在 `index` 之後的鍵；`index` 為 None 時放在最前面。
fn key_after_index(raw: &[Raw], index: Option<usize>) -> Result<String, String> {
    let before = index.map(|index| raw[index].key.as_str());
    let after = match index {
        Some(index) => raw.get(index + 1),
        None => raw.first(),
    };
    key_between(before, after.map(|item| item.key.as_str()))
}

/// 放在 `rest[at]` 前面的 `count` 個鍵。
fn keys_at(rest: &[&Raw], at: usize, count: usize) -> Result<Vec<String>, String> {
    let lower = rest.get(at).map(|item| item.key.clone());
    let mut previous = at.checked_sub(1).map(|at| rest[at].key.clone());
    let mut keys = Vec::with_capacity(count);
    for _ in 0..count {
        let key = key_between(previous.as_deref(), lower.as_deref())?;
        previous = Some(key.clone());
        keys.push(key);
    }
    Ok(keys)
}

impl Alexa {
    pub(super) fn init_writer(&mut self, note_id: &str) -> Result<(), String> {
        let key = key_between(None, None)?;
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            write_block(txn, blocks, &new_id(), key, NewBlock::plain(PARAGRAPH, "", 0))
        })?;
        self.forget_history(note_id);
        Ok(())
    }

    /// Writer 和卡片都用區塊編輯。
    pub(super) fn check_blocks(&self, note_id: &str) -> Result<(), String> {
        if self.note_type(note_id).as_deref() == Some(NoteType::Card.as_str()) {
            return Ok(());
        }
        self.check_type(note_id, NoteType::Writer)
    }

    /// 舊卡片只有 Markdown，第一次開啟時建立區塊。這不是使用者的編輯，修改時間和
    /// `content` 都不動，也不能被復原掉。
    fn import_card(&mut self, note_id: &str) -> Result<(), String> {
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let blocks = note.doc.get_or_insert_map("blocks");
        let content = note.doc.get_or_insert_text("content");
        let markdown = {
            let txn = note.doc.transact();
            if blocks.len(&txn) > 0 {
                return Ok(());
            }
            content.get_string(&txn)
        };
        let mut imported = blocks_from_markdown(&markdown);
        if imported.is_empty() {
            imported = blocks_from_markdown("");
        }
        let update = {
            let mut txn = note.doc.transact_mut();
            let mut previous: Option<String> = None;
            for card in &imported {
                let id = new_id();
                let key = key_between(previous.as_deref(), None)?;
                let block = NewBlock {
                    language: card.language.as_deref(),
                    table: card.table.as_ref(),
                    ..NewBlock::plain(&card.kind, &card.text, card.indent.min(MAX_INDENT))
                };
                write_block(&mut txn, &blocks, &id, key.clone(), block)?;
                let item = item_of(&blocks, &txn, &id)?;
                if card.checked {
                    item.insert(&mut txn, "checked", true);
                }
                if card.collapsed {
                    item.insert(&mut txn, "collapsed", true);
                }
                previous = Some(key);
            }
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;
        self.forget_history(note_id);
        Ok(())
    }

    fn writer_raw(&mut self, note_id: &str) -> Result<Vec<Raw>, String> {
        self.check_blocks(note_id)?;
        self.ensure_note(note_id)?;
        if self.note_type(note_id).as_deref() == Some(NoteType::Card.as_str()) {
            self.import_card(note_id)?;
        }
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let blocks = note.doc.get_or_insert_map("blocks");
        let txn = note.doc.transact();
        Ok(read_blocks(&txn, &blocks))
    }

    pub fn writer(&mut self, note_id: &str) -> Result<Vec<WriterBlock>, String> {
        Ok(self.writer_raw(note_id)?.into_iter().map(|raw| raw.block).collect())
    }

    /// 舊文件沒有版面資料，看不懂的值（較新的版本寫的）也一樣用預設值。
    pub fn writer_page(&mut self, note_id: &str) -> Result<WriterPage, String> {
        self.check_type(note_id, NoteType::Writer)?;
        self.ensure_note(note_id)?;
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let page = note.doc.get_or_insert_map("page");
        let txn = note.doc.transact();
        let choice = |key: &str, valid: fn(&str) -> bool, fallback: &str| {
            field_string(&page, &txn, key).filter(|value| valid(value)).unwrap_or_else(|| fallback.to_string())
        };
        Ok(WriterPage {
            size: choice("size", valid_size, DEFAULT_SIZE),
            landscape: field_flag(&page, &txn, "landscape"),
            margin: choice("margin", valid_margin, DEFAULT_MARGIN),
            header: read_band(&page, &txn, "header"),
            footer: read_band(&page, &txn, "footer"),
            number: PageNumber {
                place: choice("numberPlace", valid_number_place, DEFAULT_NUMBER_PLACE),
                align: choice("numberAlign", valid_number_align, DEFAULT_NUMBER_ALIGN),
                format: choice("numberFormat", valid_number_format, DEFAULT_NUMBER_FORMAT),
            },
            skip_first: field_flag(&page, &txn, "skipFirst"),
        })
    }

    /// `typing` 是頁首頁尾打字時的儲存，連續打字併成一步復原，其他改動各自一步。
    pub fn set_writer_page(&mut self, note_id: &str, next: WriterPage, typing: bool) -> Result<WriterPage, String> {
        if !valid_size(&next.size) {
            return Err(format!("unknown page size: {}", next.size));
        }
        if !valid_margin(&next.margin) {
            return Err(format!("unknown page margin: {}", next.margin));
        }
        if !valid_number_place(&next.number.place) {
            return Err(format!("unknown page number place: {}", next.number.place));
        }
        if !valid_number_align(&next.number.align) {
            return Err(format!("unknown page number align: {}", next.number.align));
        }
        if !valid_number_format(&next.number.format) {
            return Err(format!("unknown page number format: {}", next.number.format));
        }
        if !typing {
            self.split_undo_step(note_id);
        }
        self.office_edit(note_id, NoteType::Writer, PAGE, |txn, [page]| {
            put_string(page, txn, "size", &next.size);
            put_flag(page, txn, "landscape", next.landscape);
            put_string(page, txn, "margin", &next.margin);
            put_band(page, txn, "header", &next.header);
            put_band(page, txn, "footer", &next.footer);
            put_string(page, txn, "numberPlace", &next.number.place);
            put_string(page, txn, "numberAlign", &next.number.align);
            put_string(page, txn, "numberFormat", &next.number.format);
            put_flag(page, txn, "skipFirst", next.skip_first);
            Ok(())
        })?;
        if !typing {
            self.split_undo_step(note_id);
        }
        self.writer_page(note_id)
    }

    /// 卡片的 `content` 是完整的 Markdown，白板和連結都靠它。
    fn refresh_card_content(&mut self, note_id: &str) -> Result<(), String> {
        let blocks = self.writer(note_id)?;
        let mut images: HashMap<String, ImageFile> = HashMap::new();
        for id in blocks.iter().filter(|block| block.kind == "image").filter_map(|block| block.note_id.as_ref()) {
            if let Some(image) = self.note(id).ok().flatten().as_ref().and_then(image_file) {
                images.insert(id.clone(), image);
            }
        }
        self.set_content(note_id, &markdown_from_blocks(&blocks, &images))
    }

    pub(super) fn refresh_writer_summary(&mut self, note_id: &str) -> Result<(), String> {
        if self.note_type(note_id).as_deref() == Some(NoteType::Card.as_str()) {
            return self.refresh_card_content(note_id);
        }
        let summary = self
            .writer(note_id)?
            .iter()
            .map(|block| match &block.table {
                Some(rows) => rows.iter().map(|row| row.join("\t")).collect::<Vec<_>>().join("\n"),
                None => block.text.clone(),
            })
            .filter(|text| !text.trim().is_empty())
            .map(|text| plain_inline(&text))
            .collect::<Vec<_>>()
            .join("\n");
        self.set_summary(note_id, &summary)
    }

    pub fn edit_writer(&mut self, note_id: &str, op: WriterOp) -> Result<WriterEdit, String> {
        let raw = self.writer_raw(note_id)?;
        let typing = matches!(op, WriterOp::SetText { .. } | WriterOp::SetTable { typing: true, .. });
        if !typing {
            self.split_undo_step(note_id);
        }
        let focus = self.apply_writer(note_id, &raw, op)?;
        if !typing {
            self.split_undo_step(note_id);
        }
        self.refresh_writer_summary(note_id)?;
        Ok(WriterEdit { blocks: self.writer(note_id)?, focus })
    }

    fn apply_writer(&mut self, note_id: &str, raw: &[Raw], op: WriterOp) -> Result<Option<WriterFocus>, String> {
        let focus_on = |id: &str| Some(WriterFocus { id: id.to_string() });
        match op {
            WriterOp::AddBlock { after, kind, text, indent, target, source, language, table, leave_columns } => {
                if !valid_kind(&kind) {
                    return Err(format!("unknown block kind: {kind}"));
                }
                if kind == CARD {
                    self.check_type(note_id, NoteType::Writer)?;
                    self.check_placeable(target.as_deref())?;
                    // 和白板一樣，同一張卡片在一份文件裡只放一次。
                    if let Some(item) = raw.iter().find(|item| item.block.kind == CARD && item.block.note_id == target) {
                        return Ok(focus_on(&item.block.id));
                    }
                }
                let index = after.as_deref().map(|id| position(raw, id)).transpose()?;
                let key = key_after_index(raw, index)?;
                let id = new_id();
                let indent = indent.unwrap_or_else(|| index.map_or(0, |index| raw[index].block.indent));
                let table = table.map(normal_table).transpose()?;
                let home = index.filter(|_| !leave_columns).map(|index| &raw[index].block);
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    let block = NewBlock {
                        kind: &kind,
                        text: text.as_deref().unwrap_or(""),
                        indent: indent.min(MAX_INDENT),
                        note_id: target.as_deref(),
                        source: source.as_ref(),
                        language: language.as_deref(),
                        table: table.as_ref(),
                        group: home.and_then(|block| block.group.as_deref()),
                        column: home.map_or(0, |block| block.column),
                        align: None,
                        width: None,
                    };
                    write_block(txn, blocks, &id, key, block)
                })?;
                Ok(focus_on(&id))
            }
            WriterOp::SetTable { id, rows, .. } => {
                position(raw, &id)?;
                let json = serde_json::to_string(&normal_table(rows)?).map_err(|e| e.to_string())?;
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    let item = item_of(blocks, txn, &id)?;
                    item.insert(txn, "table", json);
                    Ok(())
                })?;
                Ok(None)
            }
            WriterOp::MoveBeside { ids, target, side } => {
                self.move_beside(note_id, raw, &ids, &target, side)?;
                Ok(None)
            }
            WriterOp::Uncolumn { id } => {
                let index = position(raw, &id)?;
                let Some(group) = raw[index].block.group.as_deref() else { return Ok(None) };
                let members: Vec<&str> =
                    raw.iter().filter(|item| item.block.group.as_deref() == Some(group)).map(|item| item.block.id.as_str()).collect();
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    for member in members {
                        let item = item_of(blocks, txn, member)?;
                        item.remove(txn, "group");
                        item.remove(txn, "column");
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            WriterOp::SetText { id, text } => {
                position(raw, &id)?;
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    let item = item_of(blocks, txn, &id)?;
                    set_text(&item, txn, "text", &text);
                    Ok(())
                })?;
                Ok(None)
            }
            WriterOp::Patch { id, kind, indent, checked, collapsed, language, align, width } => {
                position(raw, &id)?;
                if let Some(align) = align.as_deref().filter(|align| !matches!(*align, "" | "center" | "right" | "justify")) {
                    return Err(format!("unknown align: {align}"));
                }
                if let Some(kind) = kind.as_deref().filter(|kind| !valid_kind(kind)) {
                    return Err(format!("unknown block kind: {kind}"));
                }
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    let item = item_of(blocks, txn, &id)?;
                    if let Some(kind) = kind {
                        item.insert(txn, "kind", kind);
                    }
                    if let Some(indent) = indent {
                        item.insert(txn, "indent", indent.min(MAX_INDENT) as f64);
                    }
                    if let Some(checked) = checked {
                        item.insert(txn, "checked", checked);
                    }
                    if let Some(collapsed) = collapsed {
                        item.insert(txn, "collapsed", collapsed);
                    }
                    if let Some(language) = language {
                        item.insert(txn, "language", language);
                    }
                    if let Some(align) = align {
                        item.insert(txn, "align", align);
                    }
                    if let Some(width) = width {
                        item.insert(txn, "width", width.clamp(MIN_IMAGE_WIDTH, MAX_IMAGE_WIDTH));
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            WriterOp::Split { id, before, after } => self.split_block(note_id, raw, &id, &before, &after),
            WriterOp::Merge { id } => self.merge_block(note_id, raw, &id),
            WriterOp::Delete { ids } => self.delete_blocks(note_id, raw, &ids),
            WriterOp::Duplicate { id } => {
                let index = position(raw, &id)?;
                let source = &raw[index].block;
                if source.kind == CARD {
                    return Ok(focus_on(&source.id));
                }
                let key = key_after_index(raw, Some(index))?;
                let copy = new_id();
                self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                    let block = NewBlock {
                        kind: &source.kind,
                        text: &source.text,
                        indent: source.indent,
                        note_id: source.note_id.as_deref(),
                        source: source.source.as_ref(),
                        language: source.language.as_deref(),
                        table: source.table.as_ref(),
                        group: source.group.as_deref(),
                        column: source.column,
                        align: source.align.as_deref(),
                        width: source.width,
                    };
                    write_block(txn, blocks, &copy, key, block)
                })?;
                Ok(focus_on(&copy))
            }
            WriterOp::Move { ids, before, indent, group, column } => {
                let home = group.as_deref().map(|group| (group, column.unwrap_or(0)));
                self.move_blocks(note_id, raw, &ids, before.as_deref(), indent, home)?;
                Ok(None)
            }
        }
    }

    /// 拖到 `target` 旁邊。`target` 已經在分欄裡時，右邊的欄往後挪一格讓出位置；
    /// 還沒分欄時，它和底下縮排的區塊變成一欄。
    fn move_beside(
        &mut self,
        note_id: &str,
        raw: &[Raw],
        ids: &[String],
        target: &str,
        side: BlockSide,
    ) -> Result<(), String> {
        if ids.iter().any(|id| id == target) {
            return Ok(());
        }
        let anchor = &raw[position(raw, target)?].block;
        let moving: Vec<&Raw> = raw.iter().filter(|item| ids.contains(&item.block.id)).collect();
        let rest: Vec<&Raw> = raw.iter().filter(|item| !ids.contains(&item.block.id)).collect();
        let right = u32::from(side == BlockSide::Right);
        let group = anchor.group.clone().unwrap_or_else(new_id);
        let (column, at, stays): (u32, usize, Vec<(&str, u32)>) = if anchor.group.is_some() {
            let same = |item: &Raw| item.block.group == anchor.group;
            let columns: BTreeSet<u32> = rest.iter().filter(|item| same(item)).map(|item| item.block.column).collect();
            if columns.len() >= MAX_COLUMNS {
                return Err(format!("too many columns: {}", columns.len()));
            }
            let column = anchor.column + right;
            let last = rest.iter().rposition(|item| same(item)).unwrap_or(0);
            let at = rest.iter().position(|item| same(item) && item.block.column >= column).unwrap_or(last + 1);
            let moved_over = rest.iter().filter(|item| same(item) && item.block.column >= column);
            (column, at, moved_over.map(|item| (item.block.id.as_str(), item.block.column + 1)).collect())
        } else {
            let start = rest.iter().position(|item| item.block.id == target).ok_or("target is moving")?;
            let tail = rest[start + 1..].iter().take_while(|item| item.block.indent > anchor.indent).count();
            let members = rest[start..=start + tail].iter().map(|item| (item.block.id.as_str(), 1 - right)).collect();
            (right, if right == 1 { start + tail + 1 } else { start }, members)
        };
        let keys = keys_at(&rest, at, moving.len())?;
        let base = moving.first().map_or(0, |item| item.block.indent);
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            for (id, column) in stays {
                let item = item_of(blocks, txn, id)?;
                item.insert(txn, "group", group.clone());
                item.insert(txn, "column", column as f64);
            }
            for (item, key) in moving.iter().zip(keys) {
                let block = item_of(blocks, txn, &item.block.id)?;
                block.insert(txn, "orderKey", key);
                block.insert(txn, "group", group.clone());
                block.insert(txn, "column", column as f64);
                block.insert(txn, "indent", item.block.indent.saturating_sub(base) as f64);
            }
            Ok(())
        })
    }

    /// Enter。空的清單項目再按一次會離開清單，有縮排時先退一層。
    fn split_block(
        &mut self,
        note_id: &str,
        raw: &[Raw],
        id: &str,
        before: &str,
        after: &str,
    ) -> Result<Option<WriterFocus>, String> {
        let index = position(raw, id)?;
        let block = &raw[index].block;
        if is_list(&block.kind) && before.is_empty() && after.is_empty() {
            let indent = block.indent;
            self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                let item = item_of(blocks, txn, id)?;
                if indent > 0 {
                    item.insert(txn, "indent", (indent - 1) as f64);
                } else {
                    item.insert(txn, "kind", PARAGRAPH.to_string());
                }
                Ok(())
            })?;
            return Ok(Some(WriterFocus { id: id.to_string() }));
        }
        // 展開的折疊區塊，新內容放進它裡面。
        let indent = block.indent + u32::from(block.kind == "toggle" && !block.collapsed);
        let kind = next_kind(&block.kind).to_string();
        // 收合的折疊區塊，新區塊要跳過裡面的內容。
        let mut anchor = index;
        if block.kind == "toggle" && block.collapsed {
            while raw.get(anchor + 1).is_some_and(|next| next.block.indent > block.indent) {
                anchor += 1;
            }
        }
        let key = key_after_index(raw, Some(anchor))?;
        let new = new_id();
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            let item = item_of(blocks, txn, id)?;
            set_text(&item, txn, "text", before);
            write_block(txn, blocks, &new, key, NewBlock::plain(&kind, after, indent).beside(block))
        })?;
        Ok(Some(WriterFocus { id: new }))
    }

    /// 行首按 Backspace：先變回段落，再退縮排，最後才併入上一個區塊。
    fn merge_block(&mut self, note_id: &str, raw: &[Raw], id: &str) -> Result<Option<WriterFocus>, String> {
        let index = position(raw, id)?;
        let block = &raw[index].block;
        let keep = Some(WriterFocus { id: id.to_string() });
        if block.indent > 0 || block.kind != PARAGRAPH {
            let indent = block.indent;
            let to_paragraph = block.kind != PARAGRAPH;
            self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                let item = item_of(blocks, txn, id)?;
                if to_paragraph {
                    item.insert(txn, "kind", PARAGRAPH.to_string());
                } else {
                    item.insert(txn, "indent", (indent - 1) as f64);
                }
                Ok(())
            })?;
            return Ok(keep);
        }
        let Some(previous) = index.checked_sub(1).map(|at| &raw[at].block) else {
            return Ok(keep);
        };
        let target = previous.id.clone();
        // 不跨欄合併。空的區塊可以刪掉，一欄刪空後分欄就解除了。
        if previous.group != block.group || previous.column != block.column {
            if !block.text.is_empty() {
                return Ok(keep);
            }
            self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                blocks.remove(txn, id);
                Ok(())
            })?;
            let survivor = raw[..index].iter().rev().find(|item| has_text(&item.block.kind));
            return Ok(survivor.map(|item| WriterFocus { id: item.block.id.clone() }));
        }
        // 上一個是分隔線或引入內容時沒有文字可以併，刪掉它。
        if !has_text(&previous.kind) {
            self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
                blocks.remove(txn, &target);
                Ok(())
            })?;
            return Ok(keep);
        }
        let merged = format!("{}{}", previous.text, block.text);
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            let item = item_of(blocks, txn, &target)?;
            set_text(&item, txn, "text", &merged);
            blocks.remove(txn, id);
            Ok(())
        })?;
        Ok(Some(WriterFocus { id: target }))
    }

    fn delete_blocks(&mut self, note_id: &str, raw: &[Raw], ids: &[String]) -> Result<Option<WriterFocus>, String> {
        for id in ids {
            position(raw, id)?;
        }
        let first = ids.iter().filter_map(|id| position(raw, id).ok()).min().unwrap_or(0);
        let survivor = raw[..first]
            .iter()
            .rev()
            .chain(raw[first..].iter())
            .find(|item| !ids.contains(&item.block.id) && has_text(&item.block.kind))
            .map(|item| item.block.id.clone());
        let keeps_any = raw.iter().any(|item| !ids.contains(&item.block.id));
        let filler = new_id();
        let key = key_between(None, None)?;
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            for id in ids {
                blocks.remove(txn, id.as_str());
            }
            if !keeps_any {
                write_block(txn, blocks, &filler, key, NewBlock::plain(PARAGRAPH, "", 0))?;
            }
            Ok(())
        })?;
        Ok(if keeps_any { survivor } else { Some(filler) }.map(|id| WriterFocus { id }))
    }

    /// 拖曳：`ids` 整組搬到 `before` 前面（None 是最後），保持彼此的順序。
    /// `indent` 是第一個區塊的新層級，其餘的保持相對層級。
    fn move_blocks(
        &mut self,
        note_id: &str,
        raw: &[Raw],
        ids: &[String],
        before: Option<&str>,
        indent: Option<u32>,
        home: Option<(&str, u32)>,
    ) -> Result<(), String> {
        if ids.iter().any(|id| Some(id.as_str()) == before) {
            return Ok(());
        }
        let moving: Vec<&Raw> = raw.iter().filter(|item| ids.contains(&item.block.id)).collect();
        let rest: Vec<&Raw> = raw.iter().filter(|item| !ids.contains(&item.block.id)).collect();
        let at = match before {
            Some(id) => rest
                .iter()
                .position(|item| item.block.id == id)
                .ok_or_else(|| format!("unknown block: {id}"))?,
            None => rest.len(),
        };
        let keys = keys_at(&rest, at, moving.len())?;
        let base = moving.first().map_or(0, |item| item.block.indent);
        self.office_edit(note_id, NoteType::Writer, BLOCKS, |txn, [blocks]| {
            for (item, key) in moving.iter().zip(keys) {
                let target = item_of(blocks, txn, &item.block.id)?;
                target.insert(txn, "orderKey", key);
                match home {
                    Some((group, column)) => {
                        target.insert(txn, "group", group.to_string());
                        target.insert(txn, "column", column as f64);
                    }
                    None => {
                        target.remove(txn, "group");
                        target.remove(txn, "column");
                    }
                }
                if let Some(indent) = indent {
                    let next = (item.block.indent.saturating_sub(base) + indent).min(MAX_INDENT);
                    target.insert(txn, "indent", next as f64);
                }
            }
            Ok(())
        })
    }
}
