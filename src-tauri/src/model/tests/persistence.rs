use super::*;

#[test]
fn compaction_keeps_the_same_state() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    let mut text = String::new();
    for index in 0..520 {
        text.push(if index % 2 == 0 { '筆' } else { 'x' });
        alexa.update_note_content(&note_id, &text).unwrap();
    }
    let loaded = storage::load_doc_data(&alexa.conn, &note_id).unwrap();
    assert!(loaded.snapshot.is_some());
    assert!(loaded.updates.len() < 500);

    let state = reopen(alexa).board(&board).unwrap();
    assert_eq!(state.notes[&note_id].as_ref().unwrap().content, text);
}

#[test]
fn retries_an_update_after_a_failed_write() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();

    alexa
        .conn
        .execute_batch("ALTER TABLE doc_update RENAME TO doc_update_hidden")
        .unwrap();
    assert!(alexa.update_note_content(&note_id, "first").is_err());
    alexa
        .conn
        .execute_batch("ALTER TABLE doc_update_hidden RENAME TO doc_update")
        .unwrap();
    alexa.update_note_content(&note_id, "first second").unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let note = state.notes[&note_id].as_ref().unwrap();
    assert_eq!(note.content, "first second");
}

#[test]
fn replaces_text_on_character_boundaries() {
    for (from, to) in [
        ("", "新內容"),
        ("abcdef", "abXYef"),
        ("abc", ""),
        ("aaa", "aaaa"),
        ("今天開會", "今天不開會"),
        ("開會", "開心"),
        ("😀a", "😀😀a"),
    ] {
        assert_eq!(text_after(from, to), to);
    }
}

#[test]
fn keeps_a_concurrent_edit_elsewhere_in_the_text() {
    let a = Doc::new();
    let text_a = a.get_or_insert_text("t");
    text_a.insert(&mut a.transact_mut(), 0, "hello world");
    let b = Doc::new();
    let text_b = b.get_or_insert_text("t");
    let seed = a.transact().encode_state_as_update_v1(&Default::default());
    b.transact_mut()
        .apply_update(Update::decode_v1(&seed).unwrap())
        .unwrap();

    replace_text(&text_a, &mut a.transact_mut(), "hello there world");
    replace_text(&text_b, &mut b.transact_mut(), "hello world!");
    let change = b.transact().encode_state_as_update_v1(&Default::default());
    a.transact_mut()
        .apply_update(Update::decode_v1(&change).unwrap())
        .unwrap();
    assert_eq!(text_a.get_string(&a.transact()), "hello there world!");
}

/// 這三份資料由 JavaScript 的 Yjs 產生，等同使用者現有 `alexa.db` 的內容。
#[test]
fn reads_documents_written_by_yjs() {
    let fixture: HashMap<String, String> =
        serde_json::from_str(include_str!("yjs_fixture.json")).unwrap();
    let mut conn = memory();
    for (id, kind, key) in [
        ("workspace", "workspace", "ws"),
        ("board-1", "whiteboard", "b"),
        ("note-1", "note", "n"),
    ] {
        storage::append_update_data(&mut conn, id, kind, &hex(&fixture[key])).unwrap();
    }

    let mut alexa = Alexa::with_connection(conn).unwrap();
    // 開啟舊資料時補上 Root，原本的白板成為 Root 上的方塊。
    let whiteboards = alexa.list_whiteboards();
    assert_eq!(whiteboards.len(), 2);
    assert_eq!(whiteboards[0].id, ROOT_ID);
    assert_eq!(whiteboards[1].name, "白板 1");
    assert_eq!(whiteboards[1].created_at, 1000.0);
    assert_eq!(alexa.board(ROOT_ID).unwrap().placed_notes[0].id, "board-1");

    let state = alexa.board("board-1").unwrap();
    let placed = &state.placed_notes[0];
    assert_eq!((placed.x, placed.y, placed.w, placed.h), (1.5, 2.0, 200.0, 150.0));
    assert_eq!(placed.z_key, "a1");
    assert_eq!(placed.style.color.as_deref(), Some("#fff3a3"));
    let note = state.notes["note-1"].as_ref().unwrap();
    assert_eq!(note.content, "會議重點 abc");
    assert_eq!(note.updated_at, 2000.0);

    // Rust 接手後要能繼續編輯，並把新的 zKey 排在舊資料之上。
    alexa.update_note_content("note-1", "會議結論 abc").unwrap();
    let second = alexa.create_note("board-1", NoteType::Card, 0.0, 0.0).unwrap();
    assert_eq!(second.board.placed_notes[1].z_key, "a2");
    let state = reopen(alexa).board("board-1").unwrap();
    assert_eq!(state.notes["note-1"].as_ref().unwrap().content, "會議結論 abc");
}
