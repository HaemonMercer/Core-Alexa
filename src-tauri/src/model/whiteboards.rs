//! 白板目錄：Root、巢狀白板、改名與刪除。

use super::types::{
    CreatedWhiteboard, Note, RenamedWhiteboard, Whiteboard, WhiteboardDeletion, WorkspaceState,
};
use super::yjs::{any_number, new_id, now, record};
use super::Alexa;
use crate::storage;
use std::collections::{HashMap, HashSet};
use yrs::{Any, Map, Out, Transact};

/// 固定 id，兩台裝置各自開啟時才不會多出第二個 Root。
pub(super) const ROOT_ID: &str = "root";
const ROOT_NAME: &str = "Root";
const WHITEBOARD_NOTE_TYPE: &str = "whiteboard";
const TILE_COLUMNS: usize = 4;
const TILE_START_X: f64 = 140.0;
const TILE_START_Y: f64 = 155.0;
const TILE_STEP_X: f64 = 240.0;
const TILE_STEP_Y: f64 = 190.0;
const LAST_WHITEBOARD_KEY: &str = "lastWhiteboard";

/// 白板方塊沒有自己的筆記資料，名稱只存在工作區目錄。
pub(super) fn whiteboard_tile(board: &Whiteboard) -> Note {
    Note {
        id: board.id.clone(),
        note_type: WHITEBOARD_NOTE_TYPE.to_string(),
        context: record(vec![]),
        content: board.name.clone(),
        updated_at: board.created_at,
        created_at: board.created_at,
    }
}

pub(super) fn whiteboard_path(boards: &[Whiteboard], active: &str) -> Vec<Whiteboard> {
    let mut path = Vec::new();
    let mut next = Some(active);
    // 上限防止資料損壞形成循環時停不下來。
    while let Some(board) = next
        .filter(|_| path.len() < boards.len())
        .and_then(|id| boards.iter().find(|board| board.id == id))
    {
        path.push(board.clone());
        next = board.parent_id.as_deref();
    }
    path.reverse();
    path
}

/// 這個白板和它底下所有子白板的 id。
pub(super) fn whiteboard_subtree(boards: &[Whiteboard], id: &str) -> Vec<String> {
    let mut subtree = vec![id.to_string()];
    let mut index = 0;
    while index < subtree.len() {
        for board in boards {
            // 資料損壞形成循環時，檢查重複才停得下來。
            if board.parent_id.as_deref() == Some(subtree[index].as_str()) && !subtree.contains(&board.id) {
                subtree.push(board.id.clone());
            }
        }
        index += 1;
    }
    subtree
}

/// 選取的白板裡，不在其他選取白板底下的那些。刪除它們就會連帶刪掉其餘的。
pub(super) fn top_whiteboards(boards: &[Whiteboard], ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter(|id| {
            !ids.iter()
                .any(|other| other != *id && whiteboard_subtree(boards, other).contains(id))
        })
        .cloned()
        .collect()
}

impl Alexa {
    /// 也負責升級舊資料：Root 出現之前建立的白板在這裡補上方塊，內容不變。
    pub(super) fn ensure_root(&mut self) -> Result<(), String> {
        if !self.is_whiteboard(ROOT_ID) {
            // createdAt 為 0，Root 永遠排在最前面，也是沒有上次紀錄時開啟的白板。
            self.write_whiteboard(ROOT_ID, ROOT_NAME, 0.0, None)?;
        }
        let boards = self.list_whiteboards();
        let mut placed_ids: HashMap<String, Vec<String>> = HashMap::new();
        let mut child_counts: HashMap<String, usize> = HashMap::new();
        for board in &boards {
            let Some(parent) = &board.parent_id else {
                continue;
            };
            if !placed_ids.contains_key(parent) {
                placed_ids.insert(parent.clone(), self.placed_ids(parent)?);
            }
            let count = child_counts.entry(parent.clone()).or_insert(0);
            let index = *count;
            *count += 1;
            if placed_ids[parent].contains(&board.id) {
                continue;
            }
            let x = TILE_START_X + (index % TILE_COLUMNS) as f64 * TILE_STEP_X;
            let y = TILE_START_Y + (index / TILE_COLUMNS) as f64 * TILE_STEP_Y;
            self.insert_placement(parent, &board.id, &board.id, x, y)?;
        }
        Ok(())
    }
    pub(super) fn is_whiteboard(&self, id: &str) -> bool {
        self.list_whiteboards().iter().any(|board| board.id == id)
    }

    pub(super) fn list_whiteboards(&self) -> Vec<Whiteboard> {
        let map = self.workspace.doc.get_or_insert_map("whiteboards");
        let txn = self.workspace.doc.transact();
        let mut boards: Vec<Whiteboard> = map
            .iter(&txn)
            .filter_map(|(id, value)| {
                let Out::Any(Any::Map(fields)) = value else {
                    return None;
                };
                Some(Whiteboard {
                    id: id.to_string(),
                    name: match fields.get("name") {
                        Some(Any::String(name)) => name.to_string(),
                        _ => String::new(),
                    },
                    created_at: fields.get("createdAt").and_then(any_number).unwrap_or(0.0),
                    // Root 之前的資料沒有這個欄位，這些白板都在 Root 上。
                    parent_id: match fields.get("parentId") {
                        _ if id == ROOT_ID => None,
                        Some(Any::String(parent)) => Some(parent.to_string()),
                        _ => Some(ROOT_ID.to_string()),
                    },
                })
            })
            .collect();
        boards.sort_by(|a, b| {
            a.created_at
                .total_cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        boards
    }

    pub(super) fn write_whiteboard(
        &mut self,
        id: &str,
        name: &str,
        created_at: f64,
        parent_id: Option<&str>,
    ) -> Result<(), String> {
        let mut fields = vec![
            ("name", Any::from(name)),
            ("createdAt", Any::from(created_at)),
        ];
        if let Some(parent) = parent_id {
            fields.push(("parentId", Any::from(parent)));
        }
        let map = self.workspace.doc.get_or_insert_map("whiteboards");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            map.insert(
                &mut txn,
                id,
                record(fields),
            );
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)
    }

    pub fn workspace(&self) -> Result<WorkspaceState, String> {
        let whiteboards = self.list_whiteboards();
        let last = storage::get_local(&self.conn, LAST_WHITEBOARD_KEY).map_err(|e| e.to_string())?;
        let active = last
            .filter(|id| whiteboards.iter().any(|board| &board.id == id))
            .or_else(|| whiteboards.first().map(|board| board.id.clone()))
            .ok_or("no whiteboard available")?;
        Ok(WorkspaceState {
            path: whiteboard_path(&whiteboards, &active),
            whiteboards,
            active_whiteboard_id: active,
            root_whiteboard_id: ROOT_ID.to_string(),
        })
    }

    /// 放置的 id 就是白板 id，一個白板只有一個方塊。
    /// 先寫白板再寫方塊；中途失敗時，下次開啟會由 `ensure_root` 補上方塊。
    pub fn create_whiteboard(
        &mut self,
        parent_id: &str,
        center_x: f64,
        center_y: f64,
    ) -> Result<CreatedWhiteboard, String> {
        if !self.is_whiteboard(parent_id) {
            return Err(format!("unknown whiteboard: {parent_id}"));
        }
        // 目錄裡含 Root，總數剛好等於新白板的序號。
        let name = format!("白板 {}", self.list_whiteboards().len());
        let id = new_id();
        self.write_whiteboard(&id, &name, now(), Some(parent_id))?;
        self.insert_placement(parent_id, &id, &id, center_x, center_y)?;
        Ok(CreatedWhiteboard {
            placed_id: id,
            board: self.board(parent_id)?,
            workspace: self.workspace()?,
        })
    }

    pub fn rename_whiteboard(
        &mut self,
        id: &str,
        name: &str,
    ) -> Result<RenamedWhiteboard, String> {
        if id == ROOT_ID {
            return Err("root whiteboard cannot be renamed".to_string());
        }
        let name = name.trim();
        if name.is_empty() {
            return Err("whiteboard name is empty".to_string());
        }
        let board = self
            .list_whiteboards()
            .into_iter()
            .find(|board| board.id == id)
            .ok_or_else(|| format!("unknown whiteboard: {id}"))?;
        let parent = board.parent_id.as_deref().unwrap_or(ROOT_ID);
        self.write_whiteboard(id, name, board.created_at, Some(parent))?;
        Ok(RenamedWhiteboard {
            board: self.board(parent)?,
            workspace: self.workspace()?,
        })
    }

    pub fn select_whiteboard(&mut self, id: &str) -> Result<WorkspaceState, String> {
        if !self.is_whiteboard(id) {
            return Err(format!("unknown whiteboard: {id}"));
        }
        storage::set_local(&self.conn, LAST_WHITEBOARD_KEY, id).map_err(|e| e.to_string())?;
        self.workspace()
    }
    /// 同時選了父白板和子白板時，子白板不重複計算。
    pub fn whiteboard_deletion(&mut self, ids: &[String]) -> Result<WhiteboardDeletion, String> {
        let boards = self.list_whiteboards();
        if let Some(id) = ids
            .iter()
            .find(|id| *id == ROOT_ID || !boards.iter().any(|board| board.id == **id))
        {
            return Err(format!("whiteboard cannot be deleted: {id}"));
        }
        let doomed: HashSet<String> = ids
            .iter()
            .flat_map(|id| whiteboard_subtree(&boards, id))
            .collect();
        let mut notes = HashSet::new();
        for board_id in &doomed {
            for placed in self.board(board_id)?.placed_notes {
                if !boards.iter().any(|board| board.id == placed.note_id) {
                    notes.insert(placed.note_id);
                }
            }
        }
        Ok(WhiteboardDeletion {
            child_whiteboards: doomed.len() - ids.len(),
            notes: notes.len(),
        })
    }

    /// 全部確認可以刪才開始。子白板跟著選取的上層一起刪，不會刪兩次。
    pub fn delete_whiteboards(&mut self, ids: &[String]) -> Result<WorkspaceState, String> {
        self.whiteboard_deletion(ids)?;
        for id in top_whiteboards(&self.list_whiteboards(), ids) {
            self.delete_whiteboard(&id)?;
        }
        self.workspace()
    }

    /// 永久刪除白板和它底下的子白板。上面的筆記不刪，仍在 Note Library。
    /// 正開著的白板被刪時回到上層。先移除方塊再改目錄：中途失敗時白板還在，
    /// 下次開啟由 `ensure_root` 補回方塊，不會留下打不開的白板。
    pub(super) fn delete_whiteboard(&mut self, id: &str) -> Result<WorkspaceState, String> {
        self.whiteboard_deletion(&[id.to_string()])?;
        let boards = self.list_whiteboards();
        let parent = boards
            .iter()
            .find(|board| board.id == id)
            .and_then(|board| board.parent_id.clone())
            .unwrap_or_else(|| ROOT_ID.to_string());
        let subtree = whiteboard_subtree(&boards, id);

        let active = self.workspace()?.active_whiteboard_id;
        if subtree.contains(&active) {
            storage::set_local(&self.conn, LAST_WHITEBOARD_KEY, &parent).map_err(|e| e.to_string())?;
        }
        self.remove_placements(&parent, &[id.to_string()])?;

        let directory = self.workspace.doc.get_or_insert_map("whiteboards");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            for board_id in &subtree {
                directory.remove(&mut txn, board_id);
            }
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)?;

        for board_id in &subtree {
            self.boards.remove(board_id);
            storage::delete_doc(&mut self.conn, board_id).map_err(|e| e.to_string())?;
            storage::delete_local(&self.conn, &format!("view:{board_id}")).map_err(|e| e.to_string())?;
        }
        self.workspace()
    }
}
