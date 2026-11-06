use super::*;

fn code_block(alexa: &mut Alexa, board: &str) -> String {
    let created = alexa.create_note(board, NoteType::Code, 0.0, 0.0).unwrap();
    created.board.placed_notes.iter().find(|note| note.id == created.placed_id).unwrap().note_id.clone()
}

fn language(note: &Note) -> Option<String> {
    match &note.context {
        yrs::Any::Map(fields) => match fields.get("language") {
            Some(yrs::Any::String(value)) => Some(value.to_string()),
            _ => None,
        },
        _ => None,
    }
}

#[test]
fn language_and_source_survive_restart() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let note = code_block(&mut alexa, &board);
    assert_eq!(language(&alexa.note(&note).unwrap().unwrap()), None);

    alexa.update_note_content(&note, "fn main() {}\n").unwrap();
    alexa.set_code_language(&note, "python").unwrap();
    alexa.set_code_language(&note, "rust").unwrap();

    let mut alexa = reopen(alexa);
    let stored = alexa.note(&note).unwrap().unwrap();
    assert_eq!(stored.note_type, "code");
    assert_eq!(stored.content, "fn main() {}\n");
    assert_eq!(language(&stored).as_deref(), Some("rust"));
}

#[test]
fn other_note_types_have_no_language() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let card = created.board.placed_notes[0].note_id.clone();
    assert!(alexa.set_code_language(&card, "rust").is_err());
    assert!(alexa.set_code_language("missing", "rust").is_err());
}

#[test]
fn code_blocks_start_wide_and_stay_out_of_card_links() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Code, 0.0, 0.0).unwrap();
    assert!(created.board.placed_notes[0].w > 400.0);
    assert_eq!(alexa.note_library().unwrap().len(), 1);
    assert!(alexa.card_library().unwrap().is_empty());
}
