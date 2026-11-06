use super::*;

#[test]
fn a_new_workspace_has_only_the_root_whiteboard() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let state = alexa.workspace().unwrap();
    assert_eq!(state.whiteboards.len(), 1);
    assert_eq!(state.whiteboards[0].name, "Root");
    assert_eq!(state.active_whiteboard_id, state.root_whiteboard_id);
    assert!(alexa.board(ROOT_ID).unwrap().placed_notes.is_empty());
}

#[test]
fn creating_a_whiteboard_places_a_named_tile_on_root_and_stays_there() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let first = alexa.create_whiteboard(ROOT_ID, 100.0, 75.0).unwrap();
    let second = alexa.create_whiteboard(ROOT_ID, 400.0, 75.0).unwrap();

    assert_eq!(second.workspace.active_whiteboard_id, ROOT_ID);
    assert_eq!(second.board.placed_notes.len(), 2);
    let tile = second.board.placed_notes.iter().find(|p| p.id == first.placed_id).unwrap();
    assert_eq!((tile.x, tile.y), (0.0, 0.0));
    let note = second.board.notes[&first.placed_id].as_ref().unwrap();
    assert_eq!((note.note_type.as_str(), note.content.as_str()), ("whiteboard", "白板 1"));
}

#[test]
fn moving_a_tile_survives_reopening_without_duplicating_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.move_notes(ROOT_ID, &[step(&board, 300.0, 200.0)]).unwrap();

    let mut alexa = reopen(alexa);
    let state = alexa.board(ROOT_ID).unwrap();
    assert_eq!(state.placed_notes.len(), 1);
    assert_eq!((state.placed_notes[0].x, state.placed_notes[0].y), (300.0, 200.0));
}

#[test]
fn upgrades_older_whiteboards_with_tiles_and_keeps_their_notes() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    // Root 出現之前的資料：白板只在目錄裡，沒有方塊。
    alexa.write_whiteboard("old-a", "舊白板 A", 1.0, None).unwrap();
    alexa.write_whiteboard("old-b", "舊白板 B", 2.0, None).unwrap();
    alexa.create_note("old-a", NoteType::Card, 0.0, 0.0).unwrap();

    let mut alexa = reopen(alexa);
    let state = alexa.board(ROOT_ID).unwrap();
    let mut tiles: Vec<&str> = state.placed_notes.iter().map(|p| p.id.as_str()).collect();
    tiles.sort();
    assert_eq!(tiles, ["old-a", "old-b"]);
    assert_ne!(state.placed_notes[0].x, state.placed_notes[1].x);
    assert_eq!(alexa.board("old-a").unwrap().placed_notes.len(), 1);
}

#[test]
fn a_whiteboard_holds_cards_and_nested_whiteboards_together() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let parent = new_board(&mut alexa);
    alexa.create_note(&parent, NoteType::Card, 0.0, 0.0).unwrap();
    let child = alexa.create_whiteboard(&parent, 300.0, 75.0).unwrap();
    alexa.rename_whiteboard(&child.placed_id, "子白板").unwrap();

    let mut alexa = reopen(alexa);
    let state = alexa.board(&parent).unwrap();
    assert_eq!(state.placed_notes.len(), 2);
    let tile = state.notes[&child.placed_id].as_ref().unwrap();
    assert_eq!((tile.note_type.as_str(), tile.content.as_str()), ("whiteboard", "子白板"));
    assert_eq!(alexa.placed_ids(ROOT_ID).unwrap(), std::slice::from_ref(&parent));
    assert!(alexa.remove_note(&parent, &child.placed_id).is_err());

    let names: Vec<String> = alexa
        .select_whiteboard(&child.placed_id)
        .unwrap()
        .path
        .into_iter()
        .map(|board| board.name)
        .collect();
    assert_eq!(names, ["Root", "白板 1", "子白板"]);
}

#[test]
fn rejects_creating_a_whiteboard_under_an_unknown_parent() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    assert!(alexa.create_whiteboard("missing", 0.0, 0.0).is_err());
    assert_eq!(alexa.list_whiteboards().len(), 1);
}

#[test]
fn renaming_updates_the_tile_and_survives_reopening() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created_at = alexa.list_whiteboards()[1].created_at;

    let renamed = alexa.rename_whiteboard(&board, "  專案規劃  ").unwrap();
    assert_eq!(renamed.board.notes[&board].as_ref().unwrap().content, "專案規劃");
    assert_eq!(renamed.workspace.whiteboards[1].name, "專案規劃");

    let alexa = reopen(alexa);
    assert_eq!(alexa.list_whiteboards()[1].name, "專案規劃");
    assert_eq!(alexa.list_whiteboards()[1].created_at, created_at);
}

#[test]
fn rejects_renaming_root_unknown_boards_and_empty_names() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);

    assert!(alexa.rename_whiteboard(ROOT_ID, "別的名字").is_err());
    assert!(alexa.rename_whiteboard("missing", "名字").is_err());
    assert!(alexa.rename_whiteboard(&board, "   ").is_err());
    assert_eq!(alexa.list_whiteboards()[1].name, "白板 1");
}

#[test]
fn a_tile_cannot_be_copied_edited_or_removed() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);

    assert!(alexa.place_note(&board_b, &board_a, 0.0, 0.0).is_err());
    assert!(alexa.update_note_content(&board_a, "x").is_err());
    assert!(alexa.remove_note(ROOT_ID, &board_a).is_err());
    assert_eq!(alexa.board(ROOT_ID).unwrap().placed_notes.len(), 2);
}

#[test]
fn deleting_a_whiteboard_removes_its_children_but_keeps_their_cards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let parent = new_board(&mut alexa);
    let keep = new_board(&mut alexa);
    let child = alexa.create_whiteboard(&parent, 0.0, 0.0).unwrap().placed_id;
    let grandchild = alexa.create_whiteboard(&child, 0.0, 0.0).unwrap().placed_id;
    let (_, on_parent) = card(&mut alexa, &parent);
    let (_, on_grandchild) = card(&mut alexa, &grandchild);
    alexa.place_note(&keep, &on_parent, 0.0, 0.0).unwrap();
    alexa.save_view(&grandchild, ViewState { x: 1.0, y: 2.0, scale: 1.0 }).unwrap();

    let impact = alexa.whiteboard_deletion(std::slice::from_ref(&parent)).unwrap();
    assert_eq!(impact, WhiteboardDeletion { child_whiteboards: 2, notes: 2 });

    let state = alexa.delete_whiteboard(&parent).unwrap();
    let names: Vec<&str> = state.whiteboards.iter().map(|board| board.name.as_str()).collect();
    assert_eq!(names, ["Root", "白板 2"]);

    let mut alexa = reopen(alexa);
    assert_eq!(alexa.placed_ids(ROOT_ID).unwrap(), std::slice::from_ref(&keep));
    assert_eq!(alexa.card_library().unwrap().len(), 2);
    assert_eq!(alexa.board(&keep).unwrap().placed_notes.len(), 1);
    assert_eq!(alexa.note(&on_grandchild).unwrap().unwrap().id, on_grandchild);
    for gone in [&parent, &child, &grandchild] {
        assert!(storage::load_doc_data(&alexa.conn, gone).unwrap().updates.is_empty());
    }
    assert_eq!(alexa.view(&grandchild).unwrap(), None);
}

#[test]
fn deleting_the_open_whiteboard_goes_back_to_its_parent() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let parent = new_board(&mut alexa);
    let child = alexa.create_whiteboard(&parent, 0.0, 0.0).unwrap().placed_id;
    let grandchild = alexa.create_whiteboard(&child, 0.0, 0.0).unwrap().placed_id;
    alexa.select_whiteboard(&grandchild).unwrap();

    let state = alexa.delete_whiteboard(&child).unwrap();
    assert_eq!(state.active_whiteboard_id, parent);
    assert_eq!(state.path.len(), 2);
    assert!(alexa.board(&parent).unwrap().placed_notes.is_empty());
}

#[test]
fn deleting_another_whiteboard_keeps_the_open_one() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let open = new_board(&mut alexa);
    let other = new_board(&mut alexa);
    alexa.select_whiteboard(&open).unwrap();
    assert_eq!(alexa.delete_whiteboard(&other).unwrap().active_whiteboard_id, open);
}

#[test]
fn deleting_a_tile_removes_arrows_attached_to_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let parent = new_board(&mut alexa);
    let child = alexa.create_whiteboard(&parent, 0.0, 0.0).unwrap().placed_id;
    let (placed, _) = card(&mut alexa, &parent);
    alexa.create_arrow(&parent, &placed, &child).unwrap();

    alexa.delete_whiteboard(&child).unwrap();
    let state = reopen(alexa).board(&parent).unwrap();
    assert_eq!(state.placed_notes.len(), 1);
    assert!(state.arrows.is_empty());
}

#[test]
fn rejects_deleting_root_and_unknown_whiteboards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    new_board(&mut alexa);
    assert!(alexa.delete_whiteboard(ROOT_ID).is_err());
    assert!(alexa.delete_whiteboard("missing").is_err());
    assert!(alexa.whiteboard_deletion(&[ROOT_ID.to_string()]).is_err());
    assert_eq!(alexa.list_whiteboards().len(), 2);
}

#[test]
fn deleting_a_parent_and_its_child_together_counts_and_deletes_each_once() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let parent = new_board(&mut alexa);
    let child = alexa.create_whiteboard(&parent, 0.0, 0.0).unwrap().placed_id;
    let grandchild = alexa.create_whiteboard(&child, 0.0, 0.0).unwrap().placed_id;
    let other = new_board(&mut alexa);
    let keep = new_board(&mut alexa);

    // 子白板排在父白板前面也要正確。
    let ids = [child.clone(), parent.clone(), other.clone()];
    let impact = alexa.whiteboard_deletion(&ids).unwrap();
    assert_eq!(impact.child_whiteboards, 1);

    let state = alexa.delete_whiteboards(&ids).unwrap();
    let left: Vec<&str> = state.whiteboards.iter().map(|board| board.id.as_str()).collect();
    assert_eq!(left, [ROOT_ID, keep.as_str()]);
    assert!(!state.whiteboards.iter().any(|board| board.id == grandchild));
    assert_eq!(alexa.placed_ids(ROOT_ID).unwrap(), [keep]);
}

#[test]
fn deleting_whiteboards_touches_nothing_when_root_is_included() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    assert!(alexa.delete_whiteboards(&[board.clone(), ROOT_ID.to_string()]).is_err());
    assert!(alexa.is_whiteboard(&board));
}

#[test]
fn a_parent_cycle_in_damaged_data_does_not_hang() {
    let boards: Vec<Whiteboard> = [("a", "b"), ("b", "a")]
        .map(|(id, parent)| Whiteboard {
            id: id.to_string(),
            name: String::new(),
            created_at: 0.0,
            parent_id: Some(parent.to_string()),
        })
        .to_vec();
    assert_eq!(whiteboard_subtree(&boards, "a"), ["a", "b"]);
}
