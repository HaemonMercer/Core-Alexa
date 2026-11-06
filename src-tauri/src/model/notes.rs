//! Note Library：筆記的建立、讀取、搜尋與永久刪除。

use super::links::without_note_targets;
use super::media::media_files;
use super::types::{CardMatch, Note, NoteDeletion, NoteType};
use super::yjs::{new_id, now, out_number, out_string, record, replace_text};
use super::Alexa;
use crate::persisted::PersistedDoc;
use crate::storage;
use std::collections::{HashMap, HashSet};
use yrs::types::ToJson;
use yrs::{Any, GetString, Map, Out, Transact};

const CARD_SEARCH_LIMIT: usize = 20;

fn is_office(kind: &str) -> bool {
    matches!(kind, "writer" | "sheet" | "slides" | "chart")
}

impl Alexa {
    pub(super) fn read_note(&self, id: &str) -> Option<Note> {
        let doc = &self.notes.get(id)?.doc;
        let meta = doc.get_or_insert_map("meta");
        let context = doc.get_or_insert_map("context");
        let content = doc.get_or_insert_text("content");
        // 要在開交易之前：取得根類型需要寫入鎖，交易開著時會卡死。
        let tags = self.tags_of(doc);
        let txn = doc.transact();
        Some(Note {
            id: id.to_string(),
            note_type: out_string(meta.get(&txn, "type"))?,
            context: context.to_json(&txn),
            content: content.get_string(&txn),
            updated_at: out_number(meta.get(&txn, "updatedAt")),
            created_at: out_number(meta.get(&txn, "createdAt")),
            tags,
        })
    }

    /// 白板方塊沒有筆記資料，一律回傳 None。
    pub fn note(&mut self, id: &str) -> Result<Option<Note>, String> {
        if self.is_whiteboard(id) {
            return Ok(None);
        }
        self.ensure_note(id)?;
        Ok(self.read_note(id))
    }

    /// 符合類型的筆記，最近修改的在前。已從白板移除的筆記仍在這裡。
    fn library(&mut self, accepts: impl Fn(&str) -> bool) -> Result<Vec<Note>, String> {
        let ids: Vec<String> = {
            let directory = self.workspace.doc.get_or_insert_map("notes");
            let txn = self.workspace.doc.transact();
            directory
                .iter(&txn)
                .filter_map(|(id, value)| match value {
                    Out::Any(Any::Map(fields)) => match fields.get("type") {
                        Some(Any::String(kind)) if accepts(kind) => Some(id.to_string()),
                        _ => None,
                    },
                    _ => None,
                })
                .collect()
        };
        let mut notes = Vec::with_capacity(ids.len());
        for id in &ids {
            self.ensure_note(id)?;
            notes.extend(self.read_note(id));
        }
        notes.sort_by(|a, b| {
            b.updated_at
                .total_cmp(&a.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(notes)
    }

    /// 所有類型的筆記。
    pub fn note_library(&mut self) -> Result<Vec<Note>, String> {
        self.library(|_| true)
    }

    /// 內容裡可能引入別的筆記的類型。
    pub(super) fn office_library(&mut self) -> Result<Vec<Note>, String> {
        self.library(|kind| matches!(kind, "writer" | "sheet" | "slides" | "chart"))
    }

    /// Office Library 的內容。
    pub(super) fn office_notes(&mut self) -> Result<Vec<Note>, String> {
        self.library(is_office)
    }

    /// Card Library 的內容：Office 類型只出現在 Office Library。
    pub fn card_notes(&mut self) -> Result<Vec<Note>, String> {
        self.library(|kind| !is_office(kind))
    }

    /// 只有卡片。連結與 `[[` 選單只處理 Markdown 內容。
    pub fn card_library(&mut self) -> Result<Vec<Note>, String> {
        self.library(|kind| kind == NoteType::Card.as_str())
    }

    /// 連結卡片時的候選清單，最近修改的在前。
    /// 空白卡片在白板上看得到，所以要列出來；不在任何白板上的空白卡片無從辨認，才略過。
    pub fn search_cards(&mut self, query: &str, exclude_id: &str) -> Result<Vec<CardMatch>, String> {
        let query = query.trim().to_lowercase();
        let whiteboards_of = self.whiteboards_of_notes()?;
        Ok(self
            .card_library()?
            .into_iter()
            .filter(|card| {
                card.id != exclude_id
                    && without_note_targets(&card.content).to_lowercase().contains(&query)
            })
            .filter(|card| !card.content.trim().is_empty() || whiteboards_of.contains_key(&card.id))
            .take(CARD_SEARCH_LIMIT)
            .map(|note| CardMatch {
                whiteboards: whiteboards_of.get(&note.id).cloned().unwrap_or_default(),
                note,
            })
            .collect())
    }

    /// 每筆筆記放在哪些白板上，回傳白板名稱。
    pub(super) fn whiteboards_of_notes(&mut self) -> Result<HashMap<String, Vec<String>>, String> {
        let mut whiteboards_of: HashMap<String, Vec<String>> = HashMap::new();
        for board in self.list_whiteboards() {
            for placed in self.board(&board.id)?.placed_notes {
                let names = whiteboards_of.entry(placed.note_id).or_default();
                if !names.contains(&board.name) {
                    names.push(board.name.clone());
                }
            }
        }
        Ok(whiteboards_of)
    }

    /// 白板方塊不在筆記目錄裡，不算筆記。
    pub(super) fn in_library(&self, id: &str) -> bool {
        let directory = self.workspace.doc.get_or_insert_map("notes");
        let txn = self.workspace.doc.transact();
        directory.get(&txn, id).is_some()
    }

    pub(super) fn note_type(&self, id: &str) -> Option<String> {
        let directory = self.workspace.doc.get_or_insert_map("notes");
        let txn = self.workspace.doc.transact();
        match directory.get(&txn, id) {
            Some(Out::Any(Any::Map(fields))) => match fields.get("type") {
                Some(Any::String(kind)) => Some(kind.to_string()),
                _ => None,
            },
            _ => None,
        }
    }

    /// 一起刪除的筆記之間的連結不算失效，白板也只列一次。
    pub fn note_deletion(&mut self, ids: &[String]) -> Result<NoteDeletion, String> {
        if let Some(id) = ids.iter().find(|id| !self.in_library(id)) {
            return Err(format!("unknown note: {id}"));
        }
        let mut whiteboards_of = self.whiteboards_of_notes()?;
        let mut whiteboards = Vec::new();
        for name in ids.iter().flat_map(|id| whiteboards_of.remove(id).unwrap_or_default()) {
            if !whiteboards.contains(&name) {
                whiteboards.push(name);
            }
        }
        let linking: HashSet<String> = self
            .mention_references()?
            .into_iter()
            .filter(|link| ids.contains(&link.to_id) && !ids.contains(&link.from_id))
            .map(|link| link.from_id)
            .collect();
        Ok(NoteDeletion { whiteboards, linked_cards: linking.len() })
    }

    /// 全部確認是筆記才開始刪除，不會因為其中一筆有問題只刪到一半。
    /// 回傳已經沒有筆記用到的媒體檔案，由呼叫端刪除。
    pub fn delete_notes(&mut self, ids: &[String]) -> Result<Vec<String>, String> {
        if let Some(id) = ids.iter().find(|id| !self.in_library(id)) {
            return Err(format!("unknown note: {id}"));
        }
        let mut files = Vec::new();
        for id in ids {
            files.extend(self.note(id)?.iter().flat_map(media_files));
            self.delete_note(id)?;
        }
        if files.is_empty() {
            return Ok(files);
        }
        let in_use: HashSet<String> = self.note_library()?.iter().flat_map(media_files).collect();
        files.retain(|file| !in_use.contains(file));
        files.sort();
        files.dedup();
        Ok(files)
    }

    /// 永久刪除筆記，連同它在所有白板上的放置與箭頭。別的卡片裡指向它的連結文字會留著，
    /// 但連結失效。依序寫入：中途失敗時筆記還在 Library，可以重新刪除。
    pub(super) fn delete_note(&mut self, id: &str) -> Result<(), String> {
        if !self.in_library(id) {
            return Err(format!("unknown note: {id}"));
        }
        for board in self.list_whiteboards() {
            let placed_ids: Vec<String> = self
                .board(&board.id)?
                .placed_notes
                .into_iter()
                .filter(|placed| placed.note_id == id)
                .map(|placed| placed.id)
                .collect();
            self.remove_placements(&board.id, &placed_ids)?;
        }
        let directory = self.workspace.doc.get_or_insert_map("notes");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            directory.remove(&mut txn, id);
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)?;
        self.notes.remove(id);
        self.undo.remove(id);
        storage::delete_doc(&mut self.conn, id).map_err(|e| e.to_string())
    }
    /// 連結到還不存在的卡片時建立它。卡片只進 Note Library，不放到任何白板上。
    pub fn create_card(&mut self, content: &str) -> Result<Note, String> {
        let content = content.trim();
        if content.is_empty() {
            return Err("card content is empty".to_string());
        }
        let id = self.new_note(NoteType::Card)?;
        self.update_note_content(&id, content)?;
        self.note(&id)?.ok_or_else(|| "created card is missing".to_string())
    }
    pub(super) fn new_note(&mut self, note_type: NoteType) -> Result<String, String> {
        let note_id = new_id();
        let created_at = now();

        let note = PersistedDoc::open(&self.conn, &note_id, "note")?;
        self.notes.insert(note_id.clone(), note);
        let note = self.notes.get_mut(&note_id).ok_or("note is not open")?;
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            meta.insert(&mut txn, "type", note_type.as_str().to_string());
            meta.insert(&mut txn, "createdAt", created_at);
            meta.insert(&mut txn, "updatedAt", created_at);
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;

        let directory = self.workspace.doc.get_or_insert_map("notes");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            directory.insert(
                &mut txn,
                note_id.as_str(),
                record(vec![
                    ("type", Any::from(note_type.as_str())),
                    ("createdAt", Any::from(created_at)),
                ]),
            );
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)?;
        Ok(note_id)
    }
    pub fn update_note_content(&mut self, note_id: &str, next: &str) -> Result<(), String> {
        if self.is_whiteboard(note_id) {
            return Err("whiteboards have no note content".to_string());
        }
        self.ensure_note(note_id)?;
        let is_card = self.note_type(note_id).as_deref() == Some(NoteType::Card.as_str());
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let content = note.doc.get_or_insert_text("content");
        let meta = note.doc.get_or_insert_map("meta");
        let blocks = note.doc.get_or_insert_map("blocks");
        let update = {
            let mut txn = note.doc.transact_mut();
            replace_text(&content, &mut txn, next);
            // 卡片的區塊會在下次開啟時從這份內容重建，舊區塊不能蓋回去。
            if is_card {
                blocks.clear(&mut txn);
            }
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;
        if is_card {
            self.forget_history(note_id);
        }
        Ok(())
    }
}
