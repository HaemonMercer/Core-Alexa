//! Writer、Excels、Slides 共用的文件機制：名稱、編輯交易、復原與內容摘要。
//!
//! 三種類型的內容都是筆記文件裡的 Y.Map 紀錄。`content` 不是資料來源，只是給 Library
//! 和搜尋看的純文字摘要，每次編輯後重新產生；復原時也重算，所以不放進復原範圍。

use super::links::mentions;
use super::types::{CellRange, Note, NoteType, OfficeDocuments, SheetContents};
use super::yjs::{now, out_number, out_string, replace_text};
use super::Alexa;
use std::collections::HashMap;
use yrs::undo::{Options, UndoManager};
use yrs::{Any, GetString, Map, MapRef, Out, ReadTxn, Text, TextPrelim, TextRef, Transact, TransactionMut};

const UNDO_MERGE_MS: u64 = 400;
pub(super) const SUMMARY_LIMIT: usize = 400;

fn undo_scope(kind: NoteType) -> &'static [&'static str] {
    match kind {
        NoteType::Writer => &["blocks", "page"],
        NoteType::Sheet => &["tabs", "tables", "rows", "cols", "cells", "objects"],
        NoteType::Slides => &["slides", "elements"],
        _ => &[],
    }
}

pub(super) fn field_text<T: ReadTxn>(item: &MapRef, txn: &T, key: &str) -> String {
    match item.get(txn, key) {
        Some(Out::YText(text)) => text.get_string(txn),
        other => out_string(other).unwrap_or_default(),
    }
}

pub(super) fn field_string<T: ReadTxn>(item: &MapRef, txn: &T, key: &str) -> Option<String> {
    out_string(item.get(txn, key))
}

pub(super) fn field_number<T: ReadTxn>(item: &MapRef, txn: &T, key: &str) -> f64 {
    out_number(item.get(txn, key))
}

pub(super) fn field_flag<T: ReadTxn>(item: &MapRef, txn: &T, key: &str) -> bool {
    matches!(item.get(txn, key), Some(Out::Any(Any::Bool(true))))
}

/// 文字放在 Y.Text，兩個人同時改同一段時能合併，不會整段互相覆蓋。
pub(super) fn set_text(item: &MapRef, txn: &mut TransactionMut, key: &str, next: &str) {
    let existing: Option<TextRef> = match item.get(txn, key) {
        Some(Out::YText(text)) => Some(text),
        _ => None,
    };
    match existing {
        Some(text) => replace_text(&text, txn, next),
        None => {
            let text = item.insert(txn, key, TextPrelim::new(""));
            text.insert(txn, 0, next);
        }
    }
}

/// 依 `orderKey` 排好；鍵相同時用 id，各裝置的順序才會一致。
pub(super) fn sort_by_key<T>(items: &mut [T], key: impl Fn(&T) -> (&str, &str)) {
    items.sort_by(|a, b| key(a).cmp(&key(b)));
}

pub(super) fn valid_color(value: &str) -> bool {
    value.is_empty()
        || (value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|c| c.is_ascii_hexdigit()))
}

/// 拿掉行內 Markdown 的標記，給摘要用。
pub(super) fn plain_inline(text: &str) -> String {
    text.replace("**", "").replace("~~", "").replace('`', "")
}

impl Alexa {
    pub(super) fn check_type(&self, note_id: &str, kind: NoteType) -> Result<(), String> {
        if self.note_type(note_id).as_deref() != Some(kind.as_str()) {
            return Err(format!("not a {}: {note_id}", kind.as_str()));
        }
        Ok(())
    }

    fn ensure_undo(&mut self, note_id: &str, kind: NoteType) -> Result<(), String> {
        if self.undo.contains_key(note_id) {
            return Ok(());
        }
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let mut manager = UndoManager::with_options(Options {
            capture_timeout_millis: UNDO_MERGE_MS,
            ..Options::default()
        });
        for name in undo_scope(kind) {
            manager.expand_scope(&note.doc, &note.doc.get_or_insert_map(*name));
        }
        self.undo.insert(note_id.to_string(), manager);
        Ok(())
    }

    /// 只有連續打字才併成一步。其他操作前後都要切開，Ctrl+Z 才不會一次撤銷好幾個動作。
    pub(super) fn split_undo_step(&mut self, note_id: &str) {
        if let Some(manager) = self.undo.get_mut(note_id) {
            manager.reset();
        }
    }

    /// 建立時的初始內容不算使用者的編輯，不能被復原掉。
    pub(super) fn forget_history(&mut self, note_id: &str) {
        self.undo.remove(note_id);
    }

    /// 在一筆交易裡改動 `roots` 指定的 Y.Map。規則檢查要放在改動之前。
    pub(super) fn office_edit<const N: usize, R>(
        &mut self,
        note_id: &str,
        kind: NoteType,
        roots: [&str; N],
        change: impl FnOnce(&mut TransactionMut, &[MapRef; N]) -> Result<R, String>,
    ) -> Result<R, String> {
        match kind {
            NoteType::Writer => self.check_blocks(note_id)?,
            _ => self.check_type(note_id, kind)?,
        }
        self.ensure_note(note_id)?;
        self.ensure_undo(note_id, kind)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let maps = roots.map(|name| note.doc.get_or_insert_map(name));
        let meta = note.doc.get_or_insert_map("meta");
        let (update, result) = {
            let mut txn = note.doc.transact_mut();
            let result = change(&mut txn, &maps)?;
            meta.insert(&mut txn, "updatedAt", now());
            (txn.encode_update_v1(), result)
        };
        note.save(&mut self.conn, update)?;
        Ok(result)
    }

    /// 寫進 `content` 的摘要。
    pub(super) fn set_summary(&mut self, note_id: &str, summary: &str) -> Result<(), String> {
        let summary: String = summary.chars().take(SUMMARY_LIMIT).collect();
        self.set_content(note_id, &summary)
    }

    /// 內容沒變時不寫入。
    pub(super) fn set_content(&mut self, note_id: &str, next: &str) -> Result<(), String> {
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let content = note.doc.get_or_insert_text("content");
        let update = {
            let mut txn = note.doc.transact_mut();
            if content.get_string(&txn) == next {
                return Ok(());
            }
            replace_text(&content, &mut txn, next);
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }

    fn step_history(&mut self, note_id: &str, redo: bool) -> Result<bool, String> {
        let Some(kind) = self.office_kind(note_id) else {
            return Err(format!("note has no history: {note_id}"));
        };
        self.ensure_note(note_id)?;
        self.ensure_undo(note_id, kind)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let manager = self.undo.get_mut(note_id).ok_or("no history")?;
        let before = note.doc.transact().state_vector();
        let changed = if redo { manager.redo_blocking() } else { manager.undo_blocking() };
        if !changed {
            return Ok(false);
        }
        let update = note.doc.transact().encode_diff_v1(&before);
        note.save(&mut self.conn, update)?;
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;
        match kind {
            NoteType::Writer => self.refresh_writer_summary(note_id)?,
            NoteType::Sheet => self.refresh_sheet_summary(note_id)?,
            _ => self.refresh_slides_summary(note_id)?,
        }
        Ok(true)
    }

    /// 復原只算這次開啟之後的編輯；關閉應用程式後歷史就沒有了。
    pub fn undo_note(&mut self, note_id: &str) -> Result<bool, String> {
        self.step_history(note_id, false)
    }

    pub fn redo_note(&mut self, note_id: &str) -> Result<bool, String> {
        self.step_history(note_id, true)
    }

    fn office_kind(&self, note_id: &str) -> Option<NoteType> {
        match self.note_type(note_id).as_deref() {
            Some("writer" | "card") => Some(NoteType::Writer),
            Some("sheet") => Some(NoteType::Sheet),
            Some("slides") => Some(NoteType::Slides),
            _ => None,
        }
    }

    /// 文件、試算表、簡報與圖表的名稱都放在 `context.name`。
    pub fn rename_note(&mut self, note_id: &str, name: &str) -> Result<(), String> {
        let kind = self.note_type(note_id).ok_or_else(|| format!("unknown note: {note_id}"))?;
        if !matches!(kind.as_str(), "writer" | "sheet" | "slides" | "chart") {
            return Err(format!("note cannot be renamed: {note_id}"));
        }
        self.ensure_note(note_id)?;
        self.set_context(note_id, &[("name", name.trim().to_string())])
    }

    pub(super) fn set_context(&mut self, note_id: &str, fields: &[(&str, String)]) -> Result<(), String> {
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            for (key, value) in fields {
                context.insert(&mut txn, *key, value.clone());
            }
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }

    pub(super) fn context_string(&self, note_id: &str, key: &str) -> Option<String> {
        let note = self.notes.get(note_id)?;
        let context = note.doc.get_or_insert_map("context");
        let txn = note.doc.transact();
        out_string(context.get(&txn, key))
    }

    /// 新筆記的初始內容。其他類型建立時是空的。
    pub(super) fn init_note(&mut self, note_id: &str, kind: NoteType) -> Result<(), String> {
        match kind {
            NoteType::Mindmap => self.init_mindmap(note_id),
            NoteType::Writer => self.init_writer(note_id),
            NoteType::Sheet => self.init_sheet(note_id),
            NoteType::Slides => self.init_slides(note_id),
            _ => Ok(()),
        }
    }

    /// 只進 Library，不放到白板上。
    pub fn create_document(&mut self, kind: NoteType) -> Result<Note, String> {
        if !matches!(kind, NoteType::Writer | NoteType::Sheet | NoteType::Slides) {
            return Err(format!("not a document type: {}", kind.as_str()));
        }
        let id = self.new_note(kind)?;
        self.init_note(&id, kind)?;
        self.note(&id)?.ok_or_else(|| "created document is missing".to_string())
    }

    /// Office Library 的內容。圖表收在來源 Excels 裡，歸屬每次從圖表的來源推導，不另外儲存；
    /// 來源已被刪除的圖表留在最上層，使用者才看得到、刪得掉。
    pub fn office_documents(&mut self) -> Result<OfficeDocuments, String> {
        let all = self.office_notes()?;
        let mut sheets = HashMap::new();
        for note in all.iter().filter(|note| note.note_type == NoteType::Sheet.as_str()) {
            let contents = SheetContents { tables: self.sheet_tables(&note.id)?, charts: Vec::new() };
            sheets.insert(note.id.clone(), contents);
        }
        let mut notes = Vec::new();
        for note in all {
            let owner = (note.note_type == NoteType::Chart.as_str())
                .then(|| self.chart_source(&note.id))
                .flatten()
                .and_then(|source| sheets.get_mut(&source.note_id));
            match owner {
                Some(contents) => contents.charts.push(note),
                None => notes.push(note),
            }
        }
        // 圖表依建立順序，新增圖表不會讓其他圖表換位置。
        for contents in sheets.values_mut() {
            contents.charts.sort_by(|a, b| a.created_at.total_cmp(&b.created_at).then_with(|| a.id.cmp(&b.id)));
        }
        Ok(OfficeDocuments { notes, sheets })
    }

    /// 這份文件引入了哪些筆記，供 Note References 推導。
    pub(super) fn office_targets(&mut self, note_id: &str) -> Result<Vec<(String, String)>, String> {
        let mut found: Vec<(String, String)> = Vec::new();
        let add = |found: &mut Vec<(String, String)>, target: Option<String>, source: Option<&CellRange>| {
            let target = target.or_else(|| source.map(|range| range.note_id.clone()));
            if let Some(target) = target {
                found.push((target, "引入".to_string()));
            }
        };
        match self.note_type(note_id).as_deref() {
            Some("writer") => {
                for block in self.writer(note_id)? {
                    add(&mut found, block.note_id.clone(), block.source.as_ref());
                    found.extend(mentions(&block.text));
                }
            }
            Some("slides") => {
                for slide in self.slides(note_id)?.slides {
                    for element in slide.elements {
                        add(&mut found, element.note_id.clone(), element.source.as_ref());
                    }
                }
            }
            Some("chart") => {
                self.ensure_note(note_id)?;
                let source = self.chart_source(note_id);
                add(&mut found, None, source.as_ref());
            }
            _ => {}
        }
        Ok(found)
    }
}
