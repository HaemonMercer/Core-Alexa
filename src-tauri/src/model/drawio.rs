//! Draw.io 圖表。XML 整份當成一個值存在 `context`：放進 Y.Text 的話，
//! 兩人同時編輯會把字元交錯合併，產生壞掉的 XML，所以這裡是後寫入者覆蓋。
//! 預覽圖是另一個媒體檔案。

use super::media::media_files;
use super::types::NoteType;
use super::yjs::now;
use super::Alexa;
use crate::media::ImportedMedia;
use std::collections::HashSet;
use yrs::{Map, Out, Transact};

impl Alexa {
    fn require_drawio(&mut self, note_id: &str) -> Result<(), String> {
        if self.note_type(note_id).as_deref() != Some(NoteType::Drawio.as_str()) {
            return Err(format!("not a Draw.io diagram: {note_id}"));
        }
        self.ensure_note(note_id)
    }

    pub fn save_drawio_xml(&mut self, note_id: &str, xml: &str) -> Result<(), String> {
        self.require_drawio(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            context.insert(&mut txn, "xml", xml.to_string());
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }

    /// 換上新的預覽圖。回傳已經沒有筆記用到的舊檔案，由呼叫端刪除。
    pub fn save_drawio_preview(&mut self, note_id: &str, preview: &ImportedMedia) -> Result<Option<String>, String> {
        self.require_drawio(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let (previous, update) = {
            let mut txn = note.doc.transact_mut();
            let previous = match context.get(&txn, "preview") {
                Some(Out::Any(yrs::Any::String(file))) => Some(file.to_string()),
                _ => None,
            };
            context.insert(&mut txn, "preview", preview.file.clone());
            context.insert(&mut txn, "width", f64::from(preview.width));
            context.insert(&mut txn, "height", f64::from(preview.height));
            meta.insert(&mut txn, "updatedAt", now());
            (previous, txn.encode_update_v1())
        };
        note.save(&mut self.conn, update)?;

        let Some(previous) = previous.filter(|file| *file != preview.file) else {
            return Ok(None);
        };
        let in_use: HashSet<String> = self.note_library()?.iter().flat_map(media_files).collect();
        Ok((!in_use.contains(&previous)).then_some(previous))
    }
}
