//! ER 模型的所有規則：白板、Note Library 與 Placed Note。
//!
//! 工作區目錄、每個白板、每筆筆記各是一份 Y.Doc，全部透過 `PersistedDoc` 存進 SQLite。
//! `Alexa` 的方法依領域分散在各子模組，這裡只放開啟與載入文件。

mod arrows;
mod card_markdown;
mod chart;
mod code;
mod drawio;
mod fill;
mod formula;
mod links;
mod media;
mod mindmap;
mod notes;
mod office;
mod placements;
mod sheet;
mod slides;
mod types;
mod whiteboards;
mod writer;
mod yjs;

#[cfg(test)]
mod tests;

pub use types::*;

use crate::persisted::PersistedDoc;
use crate::storage;
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use yrs::undo::UndoManager;

const WORKSPACE_ID: &str = "workspace";

pub struct Alexa {
    conn: Connection,
    workspace: PersistedDoc,
    boards: HashMap<String, PersistedDoc>,
    notes: HashMap<String, PersistedDoc>,
    /// Writer、Excels、Slides 開啟後的復原紀錄，只在記憶體裡。
    undo: HashMap<String, UndoManager<()>>,
}

impl Alexa {
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::with_connection(storage::open(path).map_err(|e| e.to_string())?)
    }

    fn with_connection(conn: Connection) -> Result<Self, String> {
        let workspace = PersistedDoc::open(&conn, WORKSPACE_ID, "workspace")?;
        let mut alexa = Self {
            conn,
            workspace,
            boards: HashMap::new(),
            notes: HashMap::new(),
            undo: HashMap::new(),
        };
        alexa.ensure_root()?;
        Ok(alexa)
    }

    fn ensure_board(&mut self, id: &str) -> Result<(), String> {
        if !self.boards.contains_key(id) {
            let board = PersistedDoc::open(&self.conn, id, "whiteboard")?;
            self.boards.insert(id.to_string(), board);
        }
        Ok(())
    }

    fn ensure_note(&mut self, id: &str) -> Result<(), String> {
        if !self.notes.contains_key(id) {
            let note = PersistedDoc::open(&self.conn, id, "note")?;
            self.notes.insert(id.to_string(), note);
        }
        Ok(())
    }

    /// 載入白板，連同寫入時要用的連線一起回傳。
    fn open_board(&mut self, id: &str) -> Result<(&mut PersistedDoc, &mut Connection), String> {
        self.ensure_board(id)?;
        let board = self.boards.get_mut(id).ok_or("whiteboard is not open")?;
        Ok((board, &mut self.conn))
    }

    pub fn view(&self, whiteboard_id: &str) -> Result<Option<ViewState>, String> {
        let saved = storage::get_local(&self.conn, &format!("view:{whiteboard_id}"))
            .map_err(|e| e.to_string())?;
        // 視圖位置壞掉時退回預設值，不影響開啟白板。
        Ok(saved.and_then(|json| serde_json::from_str(&json).ok()))
    }

    pub fn save_view(&self, whiteboard_id: &str, view: ViewState) -> Result<(), String> {
        let json = serde_json::to_string(&view).map_err(|e| e.to_string())?;
        storage::set_local(&self.conn, &format!("view:{whiteboard_id}"), &json)
            .map_err(|e| e.to_string())
    }
}
