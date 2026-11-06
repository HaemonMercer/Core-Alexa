//! 白板上的放置：位置、大小與上下層順序。

use super::arrows::{connected_arrows, read_arrows};
use super::types::{
    BoardState, CreatedNote, NoteFit, NoteMove, NoteType, PlacedCard, PlacedNote, PlacedNoteStyle, SheetTable, Size,
};
use super::whiteboards::{whiteboard_tile, ROOT_ID};
use super::yjs::{new_id, out_number, out_string, record};
use super::Alexa;
use crate::arrange::{arrange, Arrangement, Frame};
use crate::order::key_after;
use std::collections::HashMap;
use yrs::{Any, Map, MapPrelim, MapRef, Out, ReadTxn, Transact};

pub(super) const ROOT_ONLY_WHITEBOARDS: &str = "root whiteboard holds only whiteboards";
pub(super) const DEFAULT_NOTE_WIDTH: f64 = 200.0;
const DEFAULT_NOTE_HEIGHT: f64 = 150.0;
/// 圖表要看得清楚，一開始放大一點。
const DIAGRAM_NOTE_SIZE: Size = Size { w: 360.0, h: 270.0 };
/// 程式碼比文字卡片寬，高度之後由內容決定。
const CODE_NOTE_SIZE: Size = Size { w: 420.0, h: 150.0 };
const WRITER_NOTE_SIZE: Size = Size { w: 340.0, h: 260.0 };
const SHEET_NOTE_SIZE: Size = Size { w: 460.0, h: 300.0 };
const SLIDES_NOTE_SIZE: Size = Size { w: 480.0, h: 270.0 };
/// 影片匯入後要解碼才知道比例，先用最常見的 16:9。
const DEFAULT_MEDIA_SIZE: Size = Size { w: 480.0, h: 270.0 };
pub(super) const MIN_NOTE_SIZE: Size = Size { w: 80.0, h: 48.0 };
/// 卡片要比表格多出內距與標題列，大表格放到白板上也不會佔滿整個畫面。
const TABLE_CARD_MARGIN: Size = Size { w: 56.0, h: 84.0 };
const MIN_TABLE_CARD: Size = Size { w: 260.0, h: 160.0 };
const MAX_TABLE_CARD: Size = Size { w: 900.0, h: 700.0 };

fn table_card_size(table: &SheetTable) -> Size {
    let width: f64 = table.cols.iter().map(|col| col.size).sum();
    let height: f64 = table.rows.iter().map(|row| row.size).sum();
    Size {
        w: (width + TABLE_CARD_MARGIN.w).clamp(MIN_TABLE_CARD.w, MAX_TABLE_CARD.w),
        h: (height + TABLE_CARD_MARGIN.h).clamp(MIN_TABLE_CARD.h, MAX_TABLE_CARD.h),
    }
}

/// 這個放置顯示的表格。沒有記錄的舊資料顯示第一個。
fn shown_table<'a>(placed: &'a PlacedNote, first: Option<&'a str>) -> Option<&'a str> {
    placed.table_id.as_deref().or(first)
}

pub(super) fn read_placed_notes<T: ReadTxn>(txn: &T, placed: &MapRef, whiteboard_id: &str) -> Vec<PlacedNote> {
    let mut notes: Vec<PlacedNote> = placed
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else {
                return None;
            };
            let style = match item.get(txn, "style") {
                Some(Out::Any(Any::Map(fields))) => PlacedNoteStyle {
                    color: match fields.get("color") {
                        Some(Any::String(color)) => Some(color.to_string()),
                        _ => None,
                    },
                },
                _ => PlacedNoteStyle::default(),
            };
            Some(PlacedNote {
                id: id.to_string(),
                whiteboard_id: whiteboard_id.to_string(),
                note_id: out_string(item.get(txn, "noteID"))?,
                x: out_number(item.get(txn, "x")),
                y: out_number(item.get(txn, "y")),
                w: out_number(item.get(txn, "w")),
                h: out_number(item.get(txn, "h")),
                z_key: out_string(item.get(txn, "zKey"))?,
                style,
                auto_fit: !matches!(item.get(txn, "autoFit"), Some(Out::Any(Any::Bool(false)))),
                collapsed: matches!(item.get(txn, "collapsed"), Some(Out::Any(Any::Bool(true)))),
                table_id: out_string(item.get(txn, "tableID")),
                min_size: MIN_NOTE_SIZE,
            })
        })
        .collect();
    // 兩人同時產生相同 zKey 時，用 id 讓每台裝置的順序一致。
    notes.sort_by(|a, b| a.z_key.cmp(&b.z_key).then_with(|| a.id.cmp(&b.id)));
    notes
}

fn top_key<T: ReadTxn>(txn: &T, placed: &MapRef) -> Result<String, String> {
    let top = read_placed_notes(txn, placed, "")
        .into_iter()
        .map(|note| note.z_key)
        .max();
    key_after(top.as_deref())
}

/// 依原本的上下層順序，替這些放置產生新的最上層 zKey，彼此的前後順序不變。
/// 全部確認沒問題才回傳，呼叫端寫入時不會只改到一部分。
fn raised_items<T: ReadTxn>(
    txn: &T,
    placed: &MapRef,
    ids: &[&str],
) -> Result<Vec<(String, MapRef, String)>, String> {
    let notes = read_placed_notes(txn, placed, "");
    let mut top = notes.iter().map(|note| note.z_key.clone()).max();
    let mut raised = Vec::with_capacity(ids.len());
    for note in &notes {
        if !ids.contains(&note.id.as_str()) {
            continue;
        }
        let Some(Out::YMap(item)) = placed.get(txn, &note.id) else {
            return Err(format!("unknown placed note: {}", note.id));
        };
        let z_key = key_after(top.as_deref())?;
        top = Some(z_key.clone());
        raised.push((note.id.clone(), item, z_key));
    }
    if raised.len() != ids.len() {
        return Err("unknown placed note".to_string());
    }
    Ok(raised)
}

impl Alexa {
    pub(super) fn placed_ids(&mut self, whiteboard_id: &str) -> Result<Vec<String>, String> {
        self.ensure_board(whiteboard_id)?;
        let doc = &self.boards[whiteboard_id].doc;
        let placed = doc.get_or_insert_map("placedNotes");
        let txn = doc.transact();
        Ok(placed.iter(&txn).map(|(id, _)| id.to_string()).collect())
    }
    pub fn board(&mut self, whiteboard_id: &str) -> Result<BoardState, String> {
        self.ensure_board(whiteboard_id)?;
        let (placed_notes, arrows) = {
            let doc = &self.boards[whiteboard_id].doc;
            let placed = doc.get_or_insert_map("placedNotes");
            let arrows = doc.get_or_insert_map("arrows");
            let txn = doc.transact();
            let placed_notes = read_placed_notes(&txn, &placed, whiteboard_id);
            let arrows = connected_arrows(read_arrows(&txn, &arrows), &placed_notes);
            (placed_notes, arrows)
        };
        let whiteboards = self.list_whiteboards();
        let mut notes = HashMap::new();
        for placed in &placed_notes {
            if let Some(board) = whiteboards.iter().find(|board| board.id == placed.note_id) {
                notes.insert(placed.note_id.clone(), Some(whiteboard_tile(board)));
                continue;
            }
            self.ensure_note(&placed.note_id)?;
            notes.insert(placed.note_id.clone(), self.read_note(&placed.note_id));
        }
        Ok(BoardState {
            placed_notes,
            notes,
            arrows,
        })
    }
    pub(super) fn add_placement(
        &mut self,
        whiteboard_id: &str,
        note_id: &str,
        center_x: f64,
        center_y: f64,
    ) -> Result<String, String> {
        let id = new_id();
        self.insert_placement(whiteboard_id, &id, note_id, center_x, center_y)?;
        Ok(id)
    }

    pub(super) fn insert_placement(
        &mut self,
        whiteboard_id: &str,
        id: &str,
        note_id: &str,
        center_x: f64,
        center_y: f64,
    ) -> Result<(), String> {
        let size = self.initial_size(note_id);
        self.write_placement(whiteboard_id, id, note_id, center_x, center_y, size, None)
    }

    #[allow(clippy::too_many_arguments)]
    fn write_placement(
        &mut self,
        whiteboard_id: &str,
        id: &str,
        note_id: &str,
        center_x: f64,
        center_y: f64,
        size: Size,
        table_id: Option<&str>,
    ) -> Result<(), String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let z_key = top_key(&txn, &placed)?;
            let item = placed.insert(&mut txn, id, MapPrelim::default());
            item.insert(&mut txn, "noteID", note_id.to_string());
            item.insert(&mut txn, "x", center_x - size.w / 2.0);
            item.insert(&mut txn, "y", center_y - size.h / 2.0);
            item.insert(&mut txn, "w", size.w);
            item.insert(&mut txn, "h", size.h);
            item.insert(&mut txn, "zKey", z_key);
            item.insert(&mut txn, "style", record(vec![]));
            if let Some(table_id) = table_id {
                item.insert(&mut txn, "tableID", table_id.to_string());
            }
            txn.encode_update_v1()
        };
        board.save(conn, update)
    }

    /// 放到白板上時的大小。圖片跟著實際比例，同一張圖放到別的白板也一樣。
    fn initial_size(&mut self, note_id: &str) -> Size {
        match self.note_type(note_id).as_deref() {
            Some("mermaid" | "mindmap" | "drawio") => DIAGRAM_NOTE_SIZE,
            Some("code") => CODE_NOTE_SIZE,
            Some("writer") => WRITER_NOTE_SIZE,
            Some("sheet" | "chart") => SHEET_NOTE_SIZE,
            Some("slides") => SLIDES_NOTE_SIZE,
            Some("image" | "video") => self.media_placement_size(note_id).unwrap_or(DEFAULT_MEDIA_SIZE),
            _ => Size { w: DEFAULT_NOTE_WIDTH, h: DEFAULT_NOTE_HEIGHT },
        }
    }

    /// 建立筆記並放到白板上，`center_x`、`center_y` 是世界座標。
    pub fn create_note(
        &mut self,
        whiteboard_id: &str,
        note_type: NoteType,
        center_x: f64,
        center_y: f64,
    ) -> Result<CreatedNote, String> {
        if whiteboard_id == ROOT_ID {
            return Err(ROOT_ONLY_WHITEBOARDS.to_string());
        }
        let note_id = self.new_note(note_type)?;
        self.init_note(&note_id, note_type)?;
        let placed_id = self.add_placement(whiteboard_id, &note_id, center_x, center_y)?;
        Ok(CreatedNote {
            placed_id,
            board: self.board(whiteboard_id)?,
        })
    }
    /// 把既有筆記放到白板上；內容只有一份，所有放置處都會同步。
    /// 一個白板上同一張卡片只能有一處，已經放過就不再新增。試算表是每個表格一處，見 `place_table`。
    pub fn place_note(
        &mut self,
        whiteboard_id: &str,
        note_id: &str,
        center_x: f64,
        center_y: f64,
    ) -> Result<PlacedCard, String> {
        if whiteboard_id == ROOT_ID || self.is_whiteboard(note_id) {
            return Err(ROOT_ONLY_WHITEBOARDS.to_string());
        }
        // 複製之後才被刪除的筆記不能貼回來，否則白板上會多一個遺失的佔位框。
        if self.note(note_id)?.is_none() {
            return Err(format!("note no longer exists: {note_id}"));
        }
        if self.note_type(note_id).as_deref() == Some(NoteType::Sheet.as_str()) {
            let first = self.sheet(note_id)?.tables.first().map(|table| table.id.clone());
            if let Some(first) = first {
                return self.place_table(whiteboard_id, note_id, &first, center_x, center_y);
            }
        }
        let board = self.board(whiteboard_id)?;
        if let Some(existing) = board.placed_notes.iter().find(|placed| placed.note_id == note_id) {
            return Ok(PlacedCard { placed_id: existing.id.clone(), created: false, board });
        }
        let placed_id = self.add_placement(whiteboard_id, note_id, center_x, center_y)?;
        Ok(PlacedCard {
            placed_id,
            created: true,
            board: self.board(whiteboard_id)?,
        })
    }

    /// 把試算表裡指定的表格放到白板上。同一個表格在一個白板上只有一處，不同表格可以並存。
    pub fn place_table(
        &mut self,
        whiteboard_id: &str,
        note_id: &str,
        table_id: &str,
        center_x: f64,
        center_y: f64,
    ) -> Result<PlacedCard, String> {
        if whiteboard_id == ROOT_ID {
            return Err(ROOT_ONLY_WHITEBOARDS.to_string());
        }
        let sheet = self.sheet(note_id)?;
        let table = sheet.tables.iter().find(|table| table.id == table_id).ok_or("unknown table")?;
        let first = sheet.tables.first().map(|table| table.id.as_str());
        let board = self.board(whiteboard_id)?;
        let existing = board
            .placed_notes
            .iter()
            .find(|placed| placed.note_id == note_id && shown_table(placed, first) == Some(table_id));
        if let Some(existing) = existing {
            return Ok(PlacedCard { placed_id: existing.id.clone(), created: false, board });
        }
        let placed_id = new_id();
        let size = table_card_size(table);
        self.write_placement(whiteboard_id, &placed_id, note_id, center_x, center_y, size, Some(table_id))?;
        Ok(PlacedCard { placed_id, created: true, board: self.board(whiteboard_id)? })
    }

    /// 換一個表格顯示，卡片大小跟著新表格。左上角不動，已經連上的箭頭也還在。
    pub fn set_placed_table(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
        table_id: &str,
    ) -> Result<BoardState, String> {
        let board = self.board(whiteboard_id)?;
        let current = board.placed_notes.iter().find(|placed| placed.id == placed_id).ok_or("unknown placement")?;
        let sheet = self.sheet(&current.note_id)?;
        let table = sheet.tables.iter().find(|table| table.id == table_id).ok_or("unknown table")?;
        let first = sheet.tables.first().map(|table| table.id.as_str());
        let taken = board.placed_notes.iter().any(|placed| {
            placed.id != placed_id && placed.note_id == current.note_id && shown_table(placed, first) == Some(table_id)
        });
        if taken {
            return Err("table is already on this whiteboard".to_string());
        }
        let size = table_card_size(table);
        let collapsed = current.collapsed;
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let Some(Out::YMap(item)) = placed.get(&txn, placed_id) else {
                return Err("unknown placement".to_string());
            };
            item.insert(&mut txn, "tableID", table_id.to_string());
            item.insert(&mut txn, "w", size.w);
            // 摺疊時 `h` 是固定高度，新表格的高度要等展開才用。
            item.insert(&mut txn, if collapsed { "expandedH" } else { "h" }, size.h);
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    /// 一起移動並移到最上層，整組只形成一筆修改，彼此的前後順序不變。
    pub fn move_notes(
        &mut self,
        whiteboard_id: &str,
        moves: &[NoteMove],
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let ids: Vec<&str> = moves.iter().map(|step| step.id.as_str()).collect();
            for (id, item, z_key) in raised_items(&txn, &placed, &ids)? {
                let Some(step) = moves.iter().find(|step| step.id == id) else {
                    continue;
                };
                item.insert(&mut txn, "x", step.x);
                item.insert(&mut txn, "y", step.y);
                item.insert(&mut txn, "zKey", z_key);
            }
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    /// 移到最上層，彼此的前後順序不變。已經在最上層時不寫入，
    /// 重複點選同一張筆記不會產生多餘的修改。
    pub fn raise_notes(
        &mut self,
        whiteboard_id: &str,
        placed_ids: &[String],
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let notes = read_placed_notes(&txn, &placed, "");
            let on_top = notes
                .iter()
                .rev()
                .take(placed_ids.len())
                .all(|note| placed_ids.contains(&note.id));
            if on_top {
                None
            } else {
                let ids: Vec<&str> = placed_ids.iter().map(String::as_str).collect();
                for (_, item, z_key) in raised_items(&txn, &placed, &ids)? {
                    item.insert(&mut txn, "zKey", z_key);
                }
                Some(txn.encode_update_v1())
            }
        };
        if let Some(update) = update {
            board.save(conn, update)?;
        }
        self.board(whiteboard_id)
    }

    /// 快速排版：只改位置，大小與上下層順序都不變，整組只形成一筆修改。
    pub fn arrange_notes(
        &mut self,
        whiteboard_id: &str,
        placed_ids: &[String],
        arrangement: Arrangement,
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let notes: Vec<PlacedNote> = read_placed_notes(&txn, &placed, "")
                .into_iter()
                .filter(|note| placed_ids.contains(&note.id))
                .collect();
            if notes.len() != placed_ids.len() {
                return Err("unknown placed note in arrangement".to_string());
            }

            let frames: Vec<Frame> = notes
                .iter()
                .map(|note| Frame { x: note.x, y: note.y, w: note.w, h: note.h })
                .collect();
            for (note, (x, y)) in notes.iter().zip(arrange(&frames, arrangement)) {
                if let Some(Out::YMap(item)) = placed.get(&txn, &note.id) {
                    item.insert(&mut txn, "x", x);
                    item.insert(&mut txn, "y", y);
                }
            }
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    /// 調整大小並移到最上層。這裡只碰放置資料，所以適用於所有筆記類型，
    /// 同一筆筆記放在其他白板上的大小也不受影響。
    pub fn resize_note(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
    ) -> Result<BoardState, String> {
        self.update_geometry(
            whiteboard_id,
            placed_id,
            &[
                ("x", x),
                ("y", y),
                ("w", w.max(MIN_NOTE_SIZE.w)),
                ("h", h.max(MIN_NOTE_SIZE.h)),
            ],
        )
    }

    /// 只影響這一處放置，同一張卡片在其他白板上的設定不變；不動上下層順序。
    pub fn set_auto_fit(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
        auto_fit: bool,
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let Some(Out::YMap(item)) = placed.get(&txn, placed_id) else {
                return Err(format!("unknown placed note: {placed_id}"));
            };
            item.insert(&mut txn, "autoFit", auto_fit);
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    /// 摺疊時把高度換成 `collapsed_h` 並記住原本的高度，展開時還原。
    /// 高度放在同一個欄位，快速排版和箭頭才會用摺疊後的尺寸；不動上下層順序。
    pub fn set_collapsed(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
        collapsed: bool,
        collapsed_h: f64,
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let Some(Out::YMap(item)) = placed.get(&txn, placed_id) else {
                return Err(format!("unknown placed note: {placed_id}"));
            };
            let is_collapsed = matches!(item.get(&txn, "collapsed"), Some(Out::Any(Any::Bool(true))));
            if collapsed == is_collapsed {
                None
            } else {
                if collapsed {
                    let h = out_number(item.get(&txn, "h"));
                    item.insert(&mut txn, "expandedH", h);
                    item.insert(&mut txn, "h", collapsed_h.max(MIN_NOTE_SIZE.h));
                } else {
                    let h = out_number(item.get(&txn, "expandedH"));
                    item.insert(&mut txn, "h", h.max(MIN_NOTE_SIZE.h));
                    item.remove(&mut txn, "expandedH");
                }
                item.insert(&mut txn, "collapsed", collapsed);
                Some(txn.encode_update_v1())
            }
        };
        if let Some(update) = update {
            board.save(conn, update)?;
        }
        self.board(whiteboard_id)
    }

    /// 寫入依內容量出的卡片高度，整組只形成一筆修改。這不是使用者的操作，
    /// 所以不動上下層順序；高度沒變或放置已被移除時略過，沒有變化就不寫入。
    pub fn fit_notes(&mut self, whiteboard_id: &str, fits: &[NoteFit]) -> Result<(), String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let mut changed = false;
            for fit in fits {
                let Some(Out::YMap(item)) = placed.get(&txn, &fit.id) else {
                    continue;
                };
                let h = fit.h.max(MIN_NOTE_SIZE.h);
                if out_number(item.get(&txn, "h")) != h {
                    item.insert(&mut txn, "h", h);
                    changed = true;
                }
            }
            changed.then(|| txn.encode_update_v1())
        };
        match update {
            Some(update) => board.save(conn, update),
            None => Ok(()),
        }
    }

    fn update_geometry(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
        fields: &[(&str, f64)],
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let update = {
            let mut txn = board.doc.transact_mut();
            let z_key = top_key(&txn, &placed)?;
            let Some(Out::YMap(item)) = placed.get(&txn, placed_id) else {
                return Err(format!("unknown placed note: {placed_id}"));
            };
            for (key, value) in fields {
                item.insert(&mut txn, *key, *value);
            }
            item.insert(&mut txn, "zKey", z_key);
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    /// 只移除這一處放置和接在它上面的箭頭；筆記本身仍保留在 Note Library。
    pub fn remove_note(
        &mut self,
        whiteboard_id: &str,
        placed_id: &str,
    ) -> Result<BoardState, String> {
        // 移除方塊會讓白板再也開不到，要刪除白板請用 `delete_whiteboards`。
        // 方塊的放置 id 就是白板 id。
        if self.is_whiteboard(placed_id) {
            return Err("whiteboard tiles cannot be removed".to_string());
        }
        self.remove_placements(whiteboard_id, &[placed_id.to_string()])?;
        self.board(whiteboard_id)
    }

    /// 移除放置和接在它們上面的箭頭，整組只形成一筆修改；沒有東西要移除時不寫入。
    pub(super) fn remove_placements(&mut self, whiteboard_id: &str, ids: &[String]) -> Result<(), String> {
        if ids.is_empty() {
            return Ok(());
        }
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let arrows = board.doc.get_or_insert_map("arrows");
        let update = {
            let mut txn = board.doc.transact_mut();
            for id in ids {
                placed.remove(&mut txn, id);
            }
            for arrow in read_arrows(&txn, &arrows) {
                if ids.contains(&arrow.from_placed_id) || ids.contains(&arrow.to_placed_id) {
                    arrows.remove(&mut txn, &arrow.id);
                }
            }
            txn.encode_update_v1()
        };
        board.save(conn, update)
    }
}
