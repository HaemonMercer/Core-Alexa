use super::*;

#[test]
fn a_card_appears_at_most_once_on_a_board() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let other = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();

    let again = alexa.place_note(&board, &note_id, 500.0, 500.0).unwrap();
    assert!(!again.created);
    assert_eq!(again.placed_id, created.placed_id);
    assert_eq!(again.board.placed_notes.len(), 1);
    assert_eq!(again.board.placed_notes[0].x, 0.0, "原本的位置不能變");

    let elsewhere = alexa.place_note(&other, &note_id, 0.0, 0.0).unwrap();
    assert!(elsewhere.created, "其他白板仍然可以放");

    alexa.remove_note(&board, &created.placed_id).unwrap();
    assert!(alexa.place_note(&board, &note_id, 0.0, 0.0).unwrap().created, "移除後可以再放回來");
}

#[test]
fn root_accepts_no_notes() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();

    assert!(alexa.create_note(ROOT_ID, NoteType::Card, 0.0, 0.0).is_err());
    assert!(alexa.place_note(ROOT_ID, &note_id, 0.0, 0.0).is_err());
    assert_eq!(alexa.board(ROOT_ID).unwrap().placed_notes.len(), 1);
}

#[test]
fn restores_placed_notes_and_content_after_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    alexa.update_note_content(&note_id, "會議重點").unwrap();
    alexa.move_notes(&board, &[step(&created.placed_id, 30.0, 40.0)]).unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let placed = &state.placed_notes[0];
    assert_eq!((placed.x, placed.y, placed.w, placed.h), (30.0, 40.0, 200.0, 150.0));
    let note = state.notes[&note_id].as_ref().unwrap();
    assert_eq!(note.note_type, "card");
    assert_eq!(note.content, "會議重點");
}

#[test]
fn restores_a_resized_note_after_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap();
    alexa
        .resize_note(&board, &created.placed_id, 10.0, 20.0, 320.0, 240.0)
        .unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let placed = &state.placed_notes[0];
    assert_eq!((placed.x, placed.y, placed.w, placed.h), (10.0, 20.0, 320.0, 240.0));
}

#[test]
fn collapsing_remembers_the_height_and_survives_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let id = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    alexa.create_note(&board, NoteType::Card, 300.0, 0.0).unwrap();
    alexa.resize_note(&board, &id, 10.0, 20.0, 240.0, 333.0).unwrap();

    alexa.set_collapsed(&board, &id, true, 72.0).unwrap();
    // 重複摺疊不能把摺疊後的高度記成原本的高度。
    alexa.set_collapsed(&board, &id, true, 72.0).unwrap();

    let mut alexa = reopen(alexa);
    let find = |state: BoardState| state.placed_notes.into_iter().find(|p| p.id == id).unwrap();
    let folded = find(alexa.board(&board).unwrap());
    assert!(folded.collapsed);
    assert_eq!((folded.w, folded.h), (240.0, 72.0));

    let opened = find(alexa.set_collapsed(&board, &id, false, 72.0).unwrap());
    assert!(!opened.collapsed);
    assert_eq!(opened.h, 333.0);
}

#[test]
fn auto_fit_defaults_on_and_is_kept_per_placement() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let other = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    alexa.create_note(&board, NoteType::Card, 300.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    let there = alexa.place_note(&other, &note_id, 0.0, 0.0).unwrap();
    assert!(there.board.placed_notes.iter().all(|p| p.auto_fit));

    let state = alexa.set_auto_fit(&board, &created.placed_id, false).unwrap();
    assert_eq!(state.placed_notes[0].id, created.placed_id, "切換不能改變上下層順序");

    let mut alexa = reopen(alexa);
    assert!(!alexa.board(&board).unwrap().placed_notes[0].auto_fit);
    assert!(alexa.board(&other).unwrap().placed_notes[0].auto_fit);
}

#[test]
fn fitting_changes_only_the_height_and_survives_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let lower = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap().placed_id;
    alexa.create_note(&board, NoteType::Card, 300.0, 75.0).unwrap();

    let fit = |id: &str, h: f64| NoteFit { id: id.to_string(), h };
    alexa
        .fit_notes(&board, &[fit(&lower, 320.0), fit("removed-meanwhile", 90.0)])
        .unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let first = &state.placed_notes[0];
    assert_eq!(first.id, lower, "高度改變不能把卡片移到最上層");
    assert_eq!((first.x, first.y, first.w, first.h), (0.0, 0.0, 200.0, 320.0));
}

#[test]
fn fitting_keeps_the_minimum_height_and_skips_unchanged_heights() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let id = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;

    let fit = NoteFit { id: id.clone(), h: 1.0 };
    alexa.fit_notes(&board, std::slice::from_ref(&fit)).unwrap();
    assert_eq!(alexa.board(&board).unwrap().placed_notes[0].h, MIN_NOTE_SIZE.h);

    let updates = |alexa: &Alexa| -> i64 {
        alexa
            .conn
            .query_row("SELECT COUNT(*) FROM doc_update", [], |row| row.get(0))
            .unwrap()
    };
    let before = updates(&alexa);
    alexa.fit_notes(&board, &[fit]).unwrap();
    assert_eq!(updates(&alexa), before);
}

#[test]
fn keeps_a_resized_note_at_or_above_the_minimum_size() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let state = alexa
        .resize_note(&board, &created.placed_id, 0.0, 0.0, 1.0, -5.0)
        .unwrap();

    let placed = &state.placed_notes[0];
    assert_eq!((placed.w, placed.h), (MIN_NOTE_SIZE.w, MIN_NOTE_SIZE.h));
    assert_eq!(placed.min_size, MIN_NOTE_SIZE);
}

#[test]
fn diagrams_start_larger_than_cards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let diagram = alexa.create_note(&board, NoteType::Mermaid, 500.0, 300.0).unwrap();

    let placed = |id: &str| diagram.board.placed_notes.iter().find(|note| note.id == id).unwrap();
    assert_eq!(placed(&card.placed_id).w, DEFAULT_NOTE_WIDTH);
    let created = placed(&diagram.placed_id);
    assert_eq!((created.w, created.h), (360.0, 270.0));
    // 放下的位置是中心點。
    assert_eq!((created.x, created.y), (320.0, 165.0));
}

#[test]
fn resizes_any_note_type() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Sheet, 0.0, 0.0).unwrap();
    let state = alexa
        .resize_note(&board, &created.placed_id, 0.0, 0.0, 400.0, 300.0)
        .unwrap();
    assert_eq!(state.placed_notes[0].w, 400.0);
}

#[test]
fn resizing_one_placement_leaves_the_other_board_alone() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let created = alexa.create_note(&board_a, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    alexa.place_note(&board_b, &note_id, 0.0, 0.0).unwrap();
    alexa
        .resize_note(&board_a, &created.placed_id, 0.0, 0.0, 400.0, 300.0)
        .unwrap();

    let other = alexa.board(&board_b).unwrap();
    assert_eq!(other.placed_notes[0].w, DEFAULT_NOTE_WIDTH);
}

#[test]
fn rejects_resizing_an_unknown_placement() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    assert!(alexa.resize_note(&board, "missing", 0.0, 0.0, 100.0, 100.0).is_err());
}

#[test]
fn centers_a_new_note_on_the_given_point() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap();
    let placed = &created.board.placed_notes[0];
    assert_eq!((placed.x, placed.y), (0.0, 0.0));
}

#[test]
fn shares_one_note_between_two_whiteboards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let created = alexa.create_note(&board_a, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    alexa.place_note(&board_b, &note_id, 5.0, 5.0).unwrap();
    alexa.update_note_content(&note_id, "同一份內容").unwrap();

    let mut alexa = reopen(alexa);
    for board in [&board_a, &board_b] {
        let state = alexa.board(board).unwrap();
        assert_eq!(state.notes[&note_id].as_ref().unwrap().content, "同一份內容");
    }
}

#[test]
fn removing_a_placement_keeps_the_note_elsewhere() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let created = alexa.create_note(&board_a, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    alexa.place_note(&board_b, &note_id, 0.0, 0.0).unwrap();
    let state = alexa.remove_note(&board_a, &created.placed_id).unwrap();

    assert!(state.placed_notes.is_empty());
    let other = alexa.board(&board_b).unwrap();
    assert!(other.notes[&note_id].is_some());
}

#[test]
fn reports_a_placement_with_no_stored_note_as_missing() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.add_placement(&board, "lost-note", 0.0, 0.0).unwrap();
    assert_eq!(alexa.board(&board).unwrap().notes["lost-note"], None);
}

#[test]
fn draws_the_most_recently_moved_note_on_top() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let first = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let second = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let order = |state: BoardState| -> Vec<String> {
        state.placed_notes.into_iter().map(|note| note.id).collect()
    };
    assert_eq!(order(alexa.board(&board).unwrap()), [first.clone(), second.clone()]);
    let moved = alexa.move_notes(&board, &[step(&first, 1.0, 1.0)]).unwrap();
    assert_eq!(order(moved), [second, first]);
}

#[test]
fn raises_selected_notes_and_keeps_their_order_after_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let a = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let b = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let c = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;

    alexa.raise_notes(&board, &[b.clone(), a.clone()]).unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let ids: Vec<&str> = state.placed_notes.iter().map(|note| note.id.as_str()).collect();
    assert_eq!(ids, [c.as_str(), a.as_str(), b.as_str()]);
}

#[test]
fn writes_nothing_when_raising_notes_already_on_top() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let top = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;

    let before = storage::load_doc_data(&alexa.conn, &board).unwrap().updates.len();
    alexa.raise_notes(&board, std::slice::from_ref(&top)).unwrap();
    let after = storage::load_doc_data(&alexa.conn, &board).unwrap().updates.len();
    assert_eq!(before, after);
}

#[test]
fn rejects_raising_an_unknown_placement() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    assert!(alexa.raise_notes(&board, &["missing".to_string()]).is_err());
}

#[test]
fn moves_a_group_together_and_keeps_its_stacking_order() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let a = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let b = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;
    let c = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().placed_id;

    // 故意把 b 排在前面，順序要依原本的上下層，而不是傳入的順序。
    alexa
        .move_notes(&board, &[step(&b, 10.0, 0.0), step(&a, 20.0, 0.0)])
        .unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let ids: Vec<&str> = state.placed_notes.iter().map(|note| note.id.as_str()).collect();
    assert_eq!(ids, [c.as_str(), a.as_str(), b.as_str()]);
    assert_eq!(state.placed_notes[1].x, 20.0);
    assert_eq!(state.placed_notes[2].x, 10.0);
}

#[test]
fn moves_nothing_when_one_placement_is_unknown() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 100.0, 75.0).unwrap();
    let moves = [step(&created.placed_id, 500.0, 500.0), step("missing", 0.0, 0.0)];
    assert!(alexa.move_notes(&board, &moves).is_err());
    assert_eq!(alexa.board(&board).unwrap().placed_notes[0].x, 0.0);
}

#[test]
fn arranges_only_the_selected_notes_and_keeps_them_after_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let a = alexa.create_note(&board, NoteType::Card, 100.0, 0.0).unwrap().placed_id;
    let b = alexa.create_note(&board, NoteType::Sheet, 400.0, 300.0).unwrap().placed_id;
    let other = alexa.create_note(&board, NoteType::Card, 900.0, 900.0).unwrap().placed_id;

    alexa
        .arrange_notes(&board, &[a.clone(), b.clone()], Arrangement::AlignLeft)
        .unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    let x_of = |id: &str| state.placed_notes.iter().find(|note| note.id == id).unwrap().x;
    assert_eq!(x_of(&a), 0.0);
    assert_eq!(x_of(&b), 0.0);
    assert_eq!(x_of(&other), 800.0);
    let ids: Vec<&str> = state.placed_notes.iter().map(|note| note.id.as_str()).collect();
    assert_eq!(ids, [a.as_str(), b.as_str(), other.as_str()]);
}

#[test]
fn rejects_arranging_an_unknown_placement() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let ids = ["missing".to_string()];
    assert!(alexa.arrange_notes(&board, &ids, Arrangement::Grid).is_err());
}

#[test]
fn breaks_equal_z_keys_by_id() {
    let doc = Doc::new();
    let placed = doc.get_or_insert_map("placedNotes");
    let mut txn = doc.transact_mut();
    for id in ["b", "a"] {
        let item = placed.insert(&mut txn, id, MapPrelim::default());
        item.insert(&mut txn, "noteID", "n".to_string());
        item.insert(&mut txn, "zKey", "a0".to_string());
    }
    let ids: Vec<String> = read_placed_notes(&txn, &placed, "w")
        .into_iter()
        .map(|note| note.id)
        .collect();
    assert_eq!(ids, ["a", "b"]);
}
