use super::*;

fn card(alexa: &mut Alexa, content: &str) -> String {
    alexa.create_card(content).unwrap().id
}

fn tag_names(alexa: &mut Alexa, note_id: &str) -> Vec<String> {
    alexa.note(note_id).unwrap().unwrap().tags.into_iter().map(|tag| tag.name).collect()
}

#[test]
fn note_tags_are_sorted_by_name_and_survive_reopen() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    alexa.add_note_tag(&id, "專案").unwrap();
    alexa.add_note_tag(&id, " #Alpha ").unwrap();

    let mut alexa = reopen(alexa);
    assert_eq!(tag_names(&mut alexa, &id), ["Alpha", "專案"]);
}

#[test]
fn same_name_shares_one_tag_ignoring_case() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let first = card(&mut alexa, "一");
    let second = card(&mut alexa, "二");
    let tag = alexa.add_note_tag(&first, "Rust").unwrap();
    let same = alexa.add_note_tag(&second, "rust").unwrap();
    alexa.add_note_tag(&second, "RUST").unwrap();

    assert_eq!(tag, same);
    let tags = alexa.tags().unwrap();
    assert_eq!(tags.len(), 1);
    assert_eq!(tags[0].count, 2);
}

#[test]
fn new_tags_take_turns_on_colors() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let first = alexa.add_note_tag(&id, "一").unwrap();
    let second = alexa.add_note_tag(&id, "二").unwrap();
    assert_ne!(first.color, second.color);
}

#[test]
fn rename_and_color_reach_every_note() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let tag = alexa.add_note_tag(&id, "舊名").unwrap();
    alexa.rename_tag(&tag.id, "新名").unwrap();
    alexa.set_tag_color(&tag.id, "red").unwrap();

    let note = alexa.note(&id).unwrap().unwrap();
    assert_eq!(note.tags[0].name, "新名");
    assert_eq!(note.tags[0].color, "red");
}

#[test]
fn rename_rejects_another_tags_name_but_allows_a_case_change() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let first = alexa.add_note_tag(&id, "alpha").unwrap();
    alexa.add_note_tag(&id, "beta").unwrap();

    assert!(alexa.rename_tag(&first.id, "BETA").is_err());
    alexa.rename_tag(&first.id, "Alpha").unwrap();
    assert_eq!(tag_names(&mut alexa, &id), ["Alpha", "beta"]);
}

#[test]
fn rejects_blank_or_long_names_and_unknown_colors() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    assert!(alexa.add_note_tag(&id, " # ").is_err());
    assert!(alexa.add_note_tag(&id, &"字".repeat(41)).is_err());
    let tag = alexa.add_note_tag(&id, &"字".repeat(40)).unwrap();
    assert!(alexa.set_tag_color(&tag.id, "#ff0000").is_err());
}

#[test]
fn removing_from_a_note_keeps_the_tag_in_the_directory() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let tag = alexa.add_note_tag(&id, "保留").unwrap();
    alexa.remove_note_tag(&id, &tag.id).unwrap();

    assert!(tag_names(&mut alexa, &id).is_empty());
    let tags = alexa.tags().unwrap();
    assert_eq!((tags[0].name.as_str(), tags[0].count), ("保留", 0));
}

#[test]
fn deleting_a_tag_keeps_the_note_and_hides_the_tag() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let tag = alexa.add_note_tag(&id, "刪掉").unwrap();
    alexa.add_note_tag(&id, "留著").unwrap();
    alexa.delete_tag(&tag.id).unwrap();

    let mut alexa = reopen(alexa);
    assert_eq!(tag_names(&mut alexa, &id), ["留著"]);
    assert_eq!(alexa.tags().unwrap().len(), 1);
    assert!(alexa.delete_tag(&tag.id).is_err());
}

#[test]
fn tagging_does_not_change_updated_at() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let id = card(&mut alexa, "內容");
    let before = alexa.note(&id).unwrap().unwrap().updated_at;
    std::thread::sleep(std::time::Duration::from_millis(2));
    alexa.add_note_tag(&id, "標籤").unwrap();
    assert_eq!(alexa.note(&id).unwrap().unwrap().updated_at, before);
}

#[test]
fn whiteboards_and_missing_notes_cannot_be_tagged() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    assert!(alexa.add_note_tag(&board, "標籤").is_err());
    assert!(alexa.add_note_tag("missing", "標籤").is_err());
    assert!(alexa.tags().unwrap().is_empty());
}

#[test]
fn board_notes_carry_their_tags_for_the_canvas() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let id = created.board.placed_notes[0].note_id.clone();
    alexa.add_note_tag(&id, "畫布").unwrap();

    let state = alexa.board(&board).unwrap();
    assert_eq!(state.notes[&id].as_ref().unwrap().tags[0].name, "畫布");
}
