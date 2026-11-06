//! 本地優先的 SQLite 儲存層。
//!
//! 這一層不解析 CRDT 內容，只保存二進位更新。
//! `doc` 與 `doc_update` 是真實資料；`note_index`、`note_references`、
//! `search_fts` 是可重建的索引；`sync_state` 預留給日後的遠端同步。

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const MIGRATIONS: &[&str] = &[r#"
    CREATE TABLE doc (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        snapshot BLOB,
        snapshot_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE doc_update (
        doc_id TEXT NOT NULL REFERENCES doc(id),
        seq INTEGER NOT NULL,
        data BLOB NOT NULL,
        PRIMARY KEY (doc_id, seq)
    );
    CREATE TABLE note_index (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT,
        updated_at INTEGER
    );
    CREATE TABLE note_references (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('manual', 'inline')),
        label TEXT
    );
    CREATE INDEX idx_note_references_to ON note_references(to_id);
    CREATE VIRTUAL TABLE search_fts USING fts5(note_id UNINDEXED, text);
    CREATE TABLE local_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE sync_state (
        doc_id TEXT PRIMARY KEY REFERENCES doc(id),
        remote_state_vector BLOB,
        last_synced_at INTEGER
    );
"#];

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    configure(&mut conn)?;
    Ok(conn)
}

pub(crate) fn configure(conn: &mut Connection) -> rusqlite::Result<()> {
    // auto_vacuum 必須在建立資料表之前設定。
    conn.execute_batch("PRAGMA auto_vacuum = INCREMENTAL;")?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;")?;
    migrate(conn)
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for (index, sql) in MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
    }
    Ok(())
}

/// 寫出一致的複本。連線開著也安全，還沒寫回主檔的內容也會包含在內。
pub fn write_copy(conn: &Connection, path: &Path) -> rusqlite::Result<()> {
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy()])?;
    Ok(())
}

/// 真實資料的筆數，用來確認複本完整。
pub fn count_rows(conn: &Connection) -> rusqlite::Result<(i64, i64)> {
    conn.query_row(
        "SELECT (SELECT count(*) FROM doc), (SELECT count(*) FROM doc_update)",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
}

pub struct LoadedDoc {
    pub snapshot: Option<Vec<u8>>,
    pub updates: Vec<Vec<u8>>,
    pub last_seq: i64,
}

pub fn load_doc_data(conn: &Connection, id: &str) -> rusqlite::Result<LoadedDoc> {
    let row: Option<(Option<Vec<u8>>, i64)> = conn
        .query_row(
            "SELECT snapshot, snapshot_seq FROM doc WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((snapshot, snapshot_seq)) = row else {
        return Ok(LoadedDoc {
            snapshot: None,
            updates: Vec::new(),
            last_seq: 0,
        });
    };

    let mut stmt =
        conn.prepare("SELECT seq, data FROM doc_update WHERE doc_id = ?1 ORDER BY seq")?;
    let rows = stmt.query_map([id], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
    })?;

    let mut updates = Vec::new();
    let mut last_seq = snapshot_seq;
    for row in rows {
        let (seq, data) = row?;
        last_seq = seq;
        updates.push(data);
    }
    Ok(LoadedDoc {
        snapshot,
        updates,
        last_seq,
    })
}

pub fn append_update_data(
    conn: &mut Connection,
    id: &str,
    doc_type: &str,
    data: &[u8],
) -> rusqlite::Result<i64> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO doc (id, type) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING",
        params![id, doc_type],
    )?;
    let seq: i64 = tx.query_row(
        "SELECT MAX(snapshot_seq, COALESCE((SELECT MAX(seq) FROM doc_update WHERE doc_id = ?1), 0)) + 1
         FROM doc WHERE id = ?1",
        [id],
        |row| row.get(0),
    )?;
    tx.execute(
        "INSERT INTO doc_update (doc_id, seq, data) VALUES (?1, ?2, ?3)",
        params![id, seq, data],
    )?;
    tx.commit()?;
    Ok(seq)
}

pub fn compact_doc_data(
    conn: &mut Connection,
    id: &str,
    snapshot: &[u8],
    up_to_seq: i64,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    // 只接受比現有快照新的壓縮結果；之後才寫入的更新會被保留。
    let changed = tx.execute(
        "UPDATE doc SET snapshot = ?2, snapshot_seq = ?3 WHERE id = ?1 AND snapshot_seq <= ?3",
        params![id, snapshot, up_to_seq],
    )?;
    if changed > 0 {
        tx.execute(
            "DELETE FROM doc_update WHERE doc_id = ?1 AND seq <= ?2",
            params![id, up_to_seq],
        )?;
    }
    tx.commit()
}

/// 永久刪除一份文件的所有資料。
pub fn delete_doc(conn: &mut Connection, id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM sync_state WHERE doc_id = ?1", [id])?;
    tx.execute("DELETE FROM doc_update WHERE doc_id = ?1", [id])?;
    tx.execute("DELETE FROM doc WHERE id = ?1", [id])?;
    tx.commit()
}

pub fn delete_local(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM local_state WHERE key = ?1", [key]).map(|_| ())
}

pub fn get_local(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM local_state WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_local(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO local_state (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        configure(&mut conn).unwrap();
        conn
    }

    #[test]
    fn migration_is_idempotent_and_sets_version() {
        let mut conn = memory();
        migrate(&mut conn).unwrap();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version as usize, MIGRATIONS.len());
    }

    #[test]
    fn loading_an_unknown_doc_returns_empty() {
        let doc = load_doc_data(&memory(), "missing").unwrap();
        assert!(doc.snapshot.is_none());
        assert!(doc.updates.is_empty());
        assert_eq!(doc.last_seq, 0);
    }

    #[test]
    fn updates_are_returned_in_order() {
        let mut conn = memory();
        assert_eq!(append_update_data(&mut conn, "a", "note", b"one").unwrap(), 1);
        assert_eq!(append_update_data(&mut conn, "a", "note", b"two").unwrap(), 2);
        let doc = load_doc_data(&conn, "a").unwrap();
        assert_eq!(doc.updates, vec![b"one".to_vec(), b"two".to_vec()]);
        assert_eq!(doc.last_seq, 2);
    }

    #[test]
    fn compaction_keeps_updates_written_afterwards() {
        let mut conn = memory();
        append_update_data(&mut conn, "a", "note", b"one").unwrap();
        append_update_data(&mut conn, "a", "note", b"two").unwrap();
        append_update_data(&mut conn, "a", "note", b"three").unwrap();
        compact_doc_data(&mut conn, "a", b"snapshot", 2).unwrap();

        let doc = load_doc_data(&conn, "a").unwrap();
        assert_eq!(doc.snapshot.as_deref(), Some(&b"snapshot"[..]));
        assert_eq!(doc.updates, vec![b"three".to_vec()]);
        assert_eq!(doc.last_seq, 3);
    }

    #[test]
    fn sequence_continues_after_everything_is_compacted() {
        let mut conn = memory();
        append_update_data(&mut conn, "a", "note", b"one").unwrap();
        compact_doc_data(&mut conn, "a", b"snapshot", 1).unwrap();
        assert_eq!(append_update_data(&mut conn, "a", "note", b"two").unwrap(), 2);
    }

    #[test]
    fn deleting_a_doc_removes_its_updates_and_snapshot() {
        let mut conn = memory();
        append_update_data(&mut conn, "a", "note", b"one").unwrap();
        compact_doc_data(&mut conn, "a", b"snapshot", 1).unwrap();
        append_update_data(&mut conn, "a", "note", b"two").unwrap();
        append_update_data(&mut conn, "b", "note", b"other").unwrap();

        delete_doc(&mut conn, "a").unwrap();

        let gone = load_doc_data(&conn, "a").unwrap();
        assert!(gone.snapshot.is_none() && gone.updates.is_empty());
        assert_eq!(load_doc_data(&conn, "b").unwrap().updates.len(), 1);
    }

    #[test]
    fn stale_compaction_is_ignored() {
        let mut conn = memory();
        append_update_data(&mut conn, "a", "note", b"one").unwrap();
        append_update_data(&mut conn, "a", "note", b"two").unwrap();
        compact_doc_data(&mut conn, "a", b"newer", 2).unwrap();
        compact_doc_data(&mut conn, "a", b"older", 1).unwrap();
        let doc = load_doc_data(&conn, "a").unwrap();
        assert_eq!(doc.snapshot.as_deref(), Some(&b"newer"[..]));
    }

}
