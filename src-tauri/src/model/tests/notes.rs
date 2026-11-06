use super::*;

#[test]
fn card_library_keeps_removed_cards_and_shows_recent_edits_first() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let older = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let newer = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    alexa.create_note(&board, NoteType::Sheet, 0.0, 0.0).unwrap();
    let older_id = older.board.placed_notes[0].note_id.clone();
    let newer_id = newer
        .board
        .placed_notes
        .iter()
        .find(|placed| placed.id == newer.placed_id)
        .unwrap()
        .note_id
        .clone();
    alexa.update_note_content(&newer_id, "第二張").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    alexa.update_note_content(&older_id, "第一張").unwrap();
    alexa.remove_note(&board, &older.placed_id).unwrap();

    let mut alexa = reopen(alexa);
    let contents: Vec<String> = alexa
        .card_library()
        .unwrap()
        .into_iter()
        .map(|note| note.content)
        .collect();
    assert_eq!(contents, ["第一張", "第二張"]);
}

#[test]
fn reads_one_note_but_not_a_whiteboard_tile() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let note_id = created.board.placed_notes[0].note_id.clone();
    alexa.update_note_content(&note_id, "面板內容").unwrap();

    let mut alexa = reopen(alexa);
    assert_eq!(alexa.note(&note_id).unwrap().unwrap().content, "面板內容");
    assert_eq!(alexa.note(&board).unwrap(), None);
}

#[test]
fn searches_cards_by_content_and_skips_itself_and_blank_cards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, a) = card(&mut alexa, &board);
    let (_, b) = card(&mut alexa, &board);
    card(&mut alexa, &board);
    alexa.update_note_content(&a, "Weekly 會議").unwrap();
    alexa.update_note_content(&b, "weekly 回顧").unwrap();

    let ids = |found: Vec<CardMatch>| found.into_iter().map(|item| item.note.id).collect::<Vec<_>>();
    assert_eq!(ids(alexa.search_cards(" WEEKLY ", &b).unwrap()), std::slice::from_ref(&a));
    assert_eq!(ids(alexa.search_cards("回顧", "").unwrap()), std::slice::from_ref(&b));
    assert_eq!(alexa.search_cards("不存在", "").unwrap().len(), 0);
}

#[test]
fn blank_cards_on_a_whiteboard_can_be_linked_and_show_where_they_are() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.rename_whiteboard(&board, "專案").unwrap();
    let (_, blank) = card(&mut alexa, &board);
    let (removed_placement, removed) = card(&mut alexa, &board);
    alexa.remove_note(&board, &removed_placement).unwrap();

    let found = alexa.search_cards("", "").unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].note.id, blank);
    assert_eq!(found[0].whiteboards, ["專案"]);
    assert!(found.iter().all(|item| item.note.id != removed));
    // 打了字就只比對文字，空白卡片不會混進結果。
    assert!(alexa.search_cards("專案", "").unwrap().is_empty());
}

#[test]
fn search_matches_link_text_but_not_the_hidden_note_id() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, source) = card(&mut alexa, &board);
    alexa
        .update_note_content(&source, "看 [週會](note:abc123) 之後")
        .unwrap();
    assert_eq!(alexa.search_cards("週會", "").unwrap().len(), 1);
    assert_eq!(alexa.search_cards("之後", "").unwrap().len(), 1);
    assert!(alexa.search_cards("abc123", "").unwrap().is_empty());
    assert!(alexa.search_cards("note", "").unwrap().is_empty());
    // 沒有結尾的括號不是連結，畫面上看得到這段文字，所以找得到。
    assert_eq!(without_note_targets("[未結束](note:xyz"), "[未結束](note:xyz");
}

#[test]
fn a_card_on_two_whiteboards_lists_both_once() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let (_, note) = card(&mut alexa, &board_a);
    alexa.place_note(&board_a, &note, 0.0, 0.0).unwrap();
    alexa.place_note(&board_b, &note, 0.0, 0.0).unwrap();
    let found = alexa.search_cards("", "").unwrap();
    assert_eq!(found[0].whiteboards, ["白板 1", "白板 2"]);
}

#[test]
fn creates_a_card_for_a_new_link_without_placing_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, source) = card(&mut alexa, &board);
    let created = alexa.create_card("  新點子  ").unwrap();
    assert_eq!((created.note_type.as_str(), created.content.as_str()), ("card", "新點子"));
    alexa
        .update_note_content(&source, &format!("[新點子](note:{})", created.id))
        .unwrap();

    let mut alexa = reopen(alexa);
    assert_eq!(alexa.board(&board).unwrap().placed_notes.len(), 1);
    let found = alexa.search_cards("新點子", &source).unwrap();
    assert_eq!(found[0].note.id, created.id);
    assert!(found[0].whiteboards.is_empty());
    assert_eq!(linked_ids(&alexa.note_links(&created.id).unwrap().incoming), [source.as_str()]);
    assert!(alexa.create_card("   ").is_err());
}

#[test]
fn deleting_a_card_removes_it_everywhere_and_for_good() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let (placed_a, doomed) = card(&mut alexa, &board_a);
    alexa.place_note(&board_b, &doomed, 0.0, 0.0).unwrap();
    let (placed_other, other) = card(&mut alexa, &board_a);
    alexa.create_arrow(&board_a, &placed_a, &placed_other).unwrap();
    let text = format!("看 [它](note:{doomed})");
    alexa.update_note_content(&other, &text).unwrap();

    let impact = alexa.note_deletion(std::slice::from_ref(&doomed)).unwrap();
    assert_eq!(impact.whiteboards, ["白板 1", "白板 2"]);
    assert_eq!(impact.linked_cards, 1);

    alexa.delete_note(&doomed).unwrap();

    let mut alexa = reopen(alexa);
    let ids: Vec<String> = alexa.card_library().unwrap().into_iter().map(|note| note.id).collect();
    assert_eq!(ids, std::slice::from_ref(&other));
    for board in [&board_a, &board_b] {
        let state = alexa.board(board).unwrap();
        assert!(state.placed_notes.iter().all(|placed| placed.note_id != doomed));
        assert!(state.arrows.is_empty());
    }
    assert_eq!(alexa.note(&doomed).unwrap(), None);
    assert!(storage::load_doc_data(&alexa.conn, &doomed).unwrap().updates.is_empty());
    // 別張卡片的文字不動，只是連結不再算數。
    assert_eq!(alexa.note(&other).unwrap().unwrap().content, text);
    assert_eq!(alexa.note_links(&other).unwrap(), NoteLinks::default());
    assert_eq!(alexa.search_cards("", "").unwrap().len(), 1);
}

#[test]
fn rejects_deleting_things_that_are_not_notes() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);

    assert!(alexa.delete_note(&board).is_err());
    assert!(alexa.delete_note("missing").is_err());
    assert!(alexa.note_deletion(&["missing".to_string()]).is_err());
}

#[test]
fn note_library_lists_every_type_but_card_library_stays_cards_only() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    for note_type in [NoteType::Card, NoteType::Mermaid, NoteType::Image, NoteType::Video, NoteType::Drawio] {
        alexa.create_note(&board, note_type, 0.0, 0.0).unwrap();
    }

    let mut alexa = reopen(alexa);
    let mut types: Vec<String> = alexa.note_library().unwrap().into_iter().map(|note| note.note_type).collect();
    types.sort();
    assert_eq!(types, ["card", "drawio", "image", "mermaid", "video"]);
    assert_eq!(alexa.card_library().unwrap().len(), 1);
    assert_eq!(alexa.search_cards("", "").unwrap().len(), 1);
}

#[test]
fn deleting_a_non_card_note_removes_its_placements_and_arrows() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let diagram = alexa.create_note(&board, NoteType::Mermaid, 0.0, 0.0).unwrap();
    let diagram_id = diagram.board.placed_notes[0].note_id.clone();
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    alexa.create_arrow(&board, &diagram.placed_id, &card.placed_id).unwrap();

    let impact = alexa.note_deletion(std::slice::from_ref(&diagram_id)).unwrap();
    assert_eq!(impact.whiteboards.len(), 1);
    alexa.delete_notes(std::slice::from_ref(&diagram_id)).unwrap();

    let mut alexa = reopen(alexa);
    let state = alexa.board(&board).unwrap();
    assert_eq!(state.placed_notes.len(), 1);
    assert!(state.arrows.is_empty());
    assert_eq!(alexa.note_library().unwrap().len(), 1);
}

#[test]
fn a_deleted_card_cannot_be_pasted_back() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, note) = card(&mut alexa, &board);
    alexa.delete_note(&note).unwrap();
    assert!(alexa.place_note(&board, &note, 0.0, 0.0).is_err());
    assert!(alexa.board(&board).unwrap().placed_notes.is_empty());
}

#[test]
fn deleting_several_cards_counts_only_links_from_cards_that_stay() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let (_, first) = card(&mut alexa, &board_a);
    let (_, second) = card(&mut alexa, &board_b);
    let (_, stays) = card(&mut alexa, &board_a);
    alexa.update_note_content(&first, &format!("[二](note:{second})")).unwrap();
    alexa
        .update_note_content(&stays, &format!("[一](note:{first}) [二](note:{second})"))
        .unwrap();

    let ids = [first.clone(), second.clone()];
    let impact = alexa.note_deletion(&ids).unwrap();
    assert_eq!(impact.linked_cards, 1);
    assert_eq!(impact.whiteboards, ["白板 1", "白板 2"]);

    alexa.delete_notes(&ids).unwrap();
    let left: Vec<String> = reopen(alexa).card_library().unwrap().into_iter().map(|note| note.id).collect();
    assert_eq!(left, [stays]);
}

#[test]
fn deleting_cards_touches_nothing_when_one_id_is_wrong() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, note) = card(&mut alexa, &board);
    assert!(alexa.delete_notes(&[note.clone(), "missing".to_string()]).is_err());
    assert!(alexa.note(&note).unwrap().is_some());
}
