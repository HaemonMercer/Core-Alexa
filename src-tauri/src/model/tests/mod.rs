//! 測試共用的輔助函式；各領域的測試在同一目錄的子模組。

mod arrows;
mod cards;
mod code;
mod drawio;
mod links;
mod media;
mod mindmap;
mod notes;
mod office;
mod persistence;
mod placements;
mod whiteboards;

use super::arrows::connected_arrows;
use super::links::{mentions, without_note_targets};
use super::placements::{read_placed_notes, DEFAULT_NOTE_WIDTH, MIN_NOTE_SIZE};
use super::types::*;
use super::whiteboards::{whiteboard_subtree, ROOT_ID};
use super::yjs::replace_text;
use super::Alexa;
use crate::arrange::Arrangement;
use crate::storage;
use rusqlite::Connection;
use std::collections::HashMap;
use yrs::updates::decoder::Decode;
use yrs::{Any, Doc, GetString, Map, MapPrelim, ReadTxn, Text, Transact, Update};

pub(super) fn memory() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    storage::configure(&mut conn).unwrap();
    conn
}

/// 模擬關閉再重開：丟掉所有記憶體狀態，只保留資料庫。
pub(super) fn reopen(alexa: Alexa) -> Alexa {
    Alexa::with_connection(alexa.conn).unwrap()
}

pub(super) fn new_board(alexa: &mut Alexa) -> String {
    // 白板依建立時間排序，同一毫秒建立時順序不固定。
    std::thread::sleep(std::time::Duration::from_millis(2));
    alexa.create_whiteboard(ROOT_ID, 0.0, 0.0).unwrap().placed_id
}

pub(super) fn step(id: &str, x: f64, y: f64) -> NoteMove {
    NoteMove { id: id.to_string(), x, y }
}

pub(super) fn hex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).unwrap())
        .collect()
}

pub(super) fn text_after(start: &str, next: &str) -> String {
    let doc = Doc::new();
    let text = doc.get_or_insert_text("t");
    let mut txn = doc.transact_mut();
    text.insert(&mut txn, 0, start);
    replace_text(&text, &mut txn, next);
    text.get_string(&txn)
}

pub(super) fn card(alexa: &mut Alexa, board: &str) -> (String, String) {
    let created = alexa.create_note(board, NoteType::Card, 0.0, 0.0).unwrap();
    let placed = created
        .board
        .placed_notes
        .iter()
        .find(|note| note.id == created.placed_id)
        .unwrap();
    (placed.id.clone(), placed.note_id.clone())
}

pub(super) fn linked_ids(links: &[NoteLink]) -> Vec<&str> {
    links.iter().map(|link| link.note.id.as_str()).collect()
}
