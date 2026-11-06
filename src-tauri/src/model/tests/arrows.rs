use super::*;

#[test]
fn arrows_survive_reopening_and_follow_their_settings() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (a, _) = card(&mut alexa, &board);
    let (b, _) = card(&mut alexa, &board);
    let state = alexa.create_arrow(&board, &a, &b).unwrap();
    let arrow = state.arrows[0].clone();
    assert_eq!(arrow.direction, ArrowDirection::Forward);

    alexa
        .update_arrow(&board, &arrow.id, Some(ArrowDirection::Both), None)
        .unwrap();
    alexa
        .update_arrow(&board, &arrow.id, None, Some("  導致  "))
        .unwrap();

    let state = reopen(alexa).board(&board).unwrap();
    assert_eq!(state.arrows.len(), 1);
    assert_eq!(state.arrows[0].direction, ArrowDirection::Both);
    assert_eq!(state.arrows[0].label, "導致");
    assert_eq!(state.arrows[0].from_placed_id, a);
}

#[test]
fn keeps_one_arrow_per_pair_and_rejects_bad_ends() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (a, _) = card(&mut alexa, &board);
    let (b, _) = card(&mut alexa, &board);
    alexa.create_arrow(&board, &a, &b).unwrap();

    let before = storage::load_doc_data(&alexa.conn, &board).unwrap().updates.len();
    assert_eq!(alexa.create_arrow(&board, &b, &a).unwrap().arrows.len(), 1);
    let after = storage::load_doc_data(&alexa.conn, &board).unwrap().updates.len();
    assert_eq!(before, after);

    assert!(alexa.create_arrow(&board, &a, &a).is_err());
    assert!(alexa.create_arrow(&board, &a, "missing").is_err());
    assert!(alexa.update_arrow(&board, "missing", None, None).is_err());
}

#[test]
fn removing_a_placement_or_an_arrow_removes_only_that_line() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (a, _) = card(&mut alexa, &board);
    let (b, _) = card(&mut alexa, &board);
    let (c, _) = card(&mut alexa, &board);
    alexa.create_arrow(&board, &a, &b).unwrap();
    let state = alexa.create_arrow(&board, &b, &c).unwrap();
    assert_eq!(state.arrows.len(), 2);

    let state = alexa.remove_note(&board, &a).unwrap();
    assert_eq!(state.arrows.len(), 1);
    assert_eq!(state.arrows[0].from_placed_id, b);

    let id = state.arrows[0].id.clone();
    let state = alexa.remove_arrow(&board, &id).unwrap();
    assert!(state.arrows.is_empty());
    assert!(reopen(alexa).board(&board).unwrap().arrows.is_empty());
}

#[test]
fn hides_an_arrow_whose_placement_disappeared_on_another_device() {
    let arrow = Arrow {
        id: "x".to_string(),
        from_placed_id: "a".to_string(),
        to_placed_id: "b".to_string(),
        direction: ArrowDirection::Forward,
        label: String::new(),
    };
    assert!(connected_arrows(vec![arrow], &[]).is_empty());
}

#[test]
fn arrows_count_as_links_in_the_direction_they_point() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    alexa.rename_whiteboard(&board, "專案").unwrap();
    let (pa, a) = card(&mut alexa, &board);
    let (pb, b) = card(&mut alexa, &board);
    let id = alexa.create_arrow(&board, &pa, &pb).unwrap().arrows[0].id.clone();
    alexa.update_arrow(&board, &id, None, Some("依賴")).unwrap();

    let links = alexa.note_links(&a).unwrap();
    assert_eq!(linked_ids(&links.outgoing), [b.as_str()]);
    assert!(links.incoming.is_empty());
    let link = &links.outgoing[0];
    assert_eq!(link.source, ReferenceSource::Arrow);
    assert_eq!((link.from_id.as_str(), link.to_id.as_str()), (a.as_str(), b.as_str()));
    assert_eq!(link.label, "依賴");
    assert_eq!(link.whiteboard_name.as_deref(), Some("專案"));

    alexa
        .update_arrow(&board, &id, Some(ArrowDirection::Backward), None)
        .unwrap();
    let links = alexa.note_links(&a).unwrap();
    assert!(links.outgoing.is_empty());
    assert_eq!(linked_ids(&links.incoming), [b.as_str()]);

    for direction in [ArrowDirection::Both, ArrowDirection::None] {
        alexa.update_arrow(&board, &id, Some(direction), None).unwrap();
        let links = alexa.note_links(&a).unwrap();
        assert_eq!(linked_ids(&links.outgoing), [b.as_str()]);
        assert_eq!(linked_ids(&links.incoming), [b.as_str()]);
        assert_ne!(links.outgoing[0].id, links.incoming[0].id);
    }
}

#[test]
fn an_arrow_on_a_whiteboard_tile_is_not_a_note_link() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let child = alexa.create_whiteboard(&board, 0.0, 0.0).unwrap().placed_id;
    let (placed, note) = card(&mut alexa, &board);
    alexa.create_arrow(&board, &placed, &child).unwrap();
    assert_eq!(alexa.note_links(&note).unwrap(), NoteLinks::default());
}
