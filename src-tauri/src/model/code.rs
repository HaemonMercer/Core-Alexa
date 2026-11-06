//! Code Block。原始碼和卡片一樣放在 `content` 的 Y.Text，Rust 不解析；
//! 語言是 `context` 裡的一個值，後寫入者覆蓋。沒有這個值表示純文字。

use super::types::NoteType;
use super::yjs::now;
use super::Alexa;
use yrs::{Map, Transact};

impl Alexa {
    pub fn set_code_language(&mut self, note_id: &str, language: &str) -> Result<(), String> {
        if self.note_type(note_id).as_deref() != Some(NoteType::Code.as_str()) {
            return Err(format!("not a code block: {note_id}"));
        }
        self.ensure_note(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            context.insert(&mut txn, "language", language.to_string());
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }
}
