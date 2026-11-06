//! 白板上接在放置之間的箭頭。

use super::types::{Arrow, ArrowDirection, BoardState, PlacedNote};
use super::yjs::{new_id, out_string};
use super::Alexa;
use yrs::{Map, MapPrelim, MapRef, Out, ReadTxn, Transact};

pub(super) fn read_arrows<T: ReadTxn>(txn: &T, arrows: &MapRef) -> Vec<Arrow> {
    let mut found: Vec<Arrow> = arrows
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else {
                return None;
            };
            Some(Arrow {
                id: id.to_string(),
                from_placed_id: out_string(item.get(txn, "fromPlacedID"))?,
                to_placed_id: out_string(item.get(txn, "toPlacedID"))?,
                direction: ArrowDirection::parse(out_string(item.get(txn, "direction"))),
                label: out_string(item.get(txn, "label")).unwrap_or_default(),
            })
        })
        .collect();
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
}

/// 另一台裝置可能同時移除了放置，兩端都還在的箭頭才算數。
pub(super) fn connected_arrows(arrows: Vec<Arrow>, placed: &[PlacedNote]) -> Vec<Arrow> {
    let exists = |id: &str| placed.iter().any(|note| note.id == id);
    arrows
        .into_iter()
        .filter(|arrow| exists(&arrow.from_placed_id) && exists(&arrow.to_placed_id))
        .collect()
}

impl Alexa {
    /// 兩張筆記之間只有一條線，要改方向用 `update_arrow`；已經有線時不寫入。
    pub fn create_arrow(
        &mut self,
        whiteboard_id: &str,
        from_placed_id: &str,
        to_placed_id: &str,
    ) -> Result<BoardState, String> {
        if from_placed_id == to_placed_id {
            return Err("an arrow needs two different notes".to_string());
        }
        let (board, conn) = self.open_board(whiteboard_id)?;
        let placed = board.doc.get_or_insert_map("placedNotes");
        let arrows = board.doc.get_or_insert_map("arrows");
        let update = {
            let mut txn = board.doc.transact_mut();
            for id in [from_placed_id, to_placed_id] {
                if placed.get(&txn, id).is_none() {
                    return Err(format!("unknown placed note: {id}"));
                }
            }
            let joins = |arrow: &Arrow| {
                let ends = (arrow.from_placed_id.as_str(), arrow.to_placed_id.as_str());
                ends == (from_placed_id, to_placed_id) || ends == (to_placed_id, from_placed_id)
            };
            if read_arrows(&txn, &arrows).iter().any(joins) {
                None
            } else {
                let item = arrows.insert(&mut txn, new_id(), MapPrelim::default());
                item.insert(&mut txn, "fromPlacedID", from_placed_id.to_string());
                item.insert(&mut txn, "toPlacedID", to_placed_id.to_string());
                item.insert(&mut txn, "direction", ArrowDirection::Forward.as_str().to_string());
                item.insert(&mut txn, "label", String::new());
                Some(txn.encode_update_v1())
            }
        };
        if let Some(update) = update {
            board.save(conn, update)?;
        }
        self.board(whiteboard_id)
    }

    /// 沒有傳入的欄位不變，兩人同時改方向和標籤時都會保留。
    pub fn update_arrow(
        &mut self,
        whiteboard_id: &str,
        id: &str,
        direction: Option<ArrowDirection>,
        label: Option<&str>,
    ) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let arrows = board.doc.get_or_insert_map("arrows");
        let update = {
            let mut txn = board.doc.transact_mut();
            let Some(Out::YMap(item)) = arrows.get(&txn, id) else {
                return Err(format!("unknown arrow: {id}"));
            };
            if let Some(direction) = direction {
                item.insert(&mut txn, "direction", direction.as_str().to_string());
            }
            if let Some(label) = label {
                item.insert(&mut txn, "label", label.trim().to_string());
            }
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }

    pub fn remove_arrow(&mut self, whiteboard_id: &str, id: &str) -> Result<BoardState, String> {
        let (board, conn) = self.open_board(whiteboard_id)?;
        let arrows = board.doc.get_or_insert_map("arrows");
        let update = {
            let mut txn = board.doc.transact_mut();
            arrows.remove(&mut txn, id);
            txn.encode_update_v1()
        };
        board.save(conn, update)?;
        self.board(whiteboard_id)
    }
}
