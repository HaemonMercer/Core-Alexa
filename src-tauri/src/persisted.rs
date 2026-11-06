//! 一份 Y.Doc 與它在 SQLite 中的更新紀錄。

use crate::storage;
use rusqlite::Connection;
use yrs::updates::decoder::Decode;
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

const COMPACT_AFTER: usize = 500;

pub struct PersistedDoc {
    pub doc: Doc,
    id: String,
    kind: &'static str,
    /// 尚未成功寫入的更新；下一次寫入時會依序重試。
    pending: Vec<Vec<u8>>,
    update_count: usize,
    last_seq: i64,
}

impl PersistedDoc {
    pub fn open(conn: &Connection, id: &str, kind: &'static str) -> Result<Self, String> {
        let loaded = storage::load_doc_data(conn, id).map_err(|e| e.to_string())?;
        let doc = Doc::new();
        {
            let mut txn = doc.transact_mut();
            for bytes in loaded.snapshot.iter().chain(loaded.updates.iter()) {
                let update = Update::decode_v1(bytes).map_err(|e| e.to_string())?;
                txn.apply_update(update).map_err(|e| e.to_string())?;
            }
        }
        Ok(Self {
            doc,
            id: id.to_string(),
            kind,
            pending: Vec::new(),
            update_count: loaded.updates.len(),
            last_seq: loaded.last_seq,
        })
    }

    /// 寫入一筆更新。失敗時更新會保留在記憶體，下次寫入時重試。
    pub fn save(&mut self, conn: &mut Connection, update: Vec<u8>) -> Result<(), String> {
        self.pending.push(update);
        while let Some(next) = self.pending.first() {
            self.last_seq = storage::append_update_data(conn, &self.id, self.kind, next)
                .map_err(|e| e.to_string())?;
            self.pending.remove(0);
            self.update_count += 1;
        }
        if self.update_count >= COMPACT_AFTER {
            self.compact(conn)?;
        }
        Ok(())
    }

    fn compact(&mut self, conn: &mut Connection) -> Result<(), String> {
        let snapshot = self
            .doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        storage::compact_doc_data(conn, &self.id, &snapshot, self.last_seq)
            .map_err(|e| e.to_string())?;
        self.update_count = 0;
        Ok(())
    }
}
