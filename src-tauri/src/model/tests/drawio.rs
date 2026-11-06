use super::*;
use crate::media::{ImportedMedia, MediaKind};

const XML: &str = r#"<mxfile><diagram name="頁面一"><mxGraphModel/></diagram></mxfile>"#;

fn diagram(alexa: &mut Alexa, board: &str) -> String {
    let created = alexa.create_note(board, NoteType::Drawio, 0.0, 0.0).unwrap();
    created.board.placed_notes.iter().find(|note| note.id == created.placed_id).unwrap().note_id.clone()
}

fn preview(file: &str) -> ImportedMedia {
    ImportedMedia { file: file.to_string(), name: String::new(), kind: MediaKind::Image, width: 800, height: 400 }
}

fn context_text(note: &Note, key: &str) -> Option<String> {
    match &note.context {
        yrs::Any::Map(fields) => match fields.get(key) {
            Some(yrs::Any::String(value)) => Some(value.to_string()),
            _ => None,
        },
        _ => None,
    }
}

#[test]
fn xml_and_preview_survive_restart() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let note = diagram(&mut alexa, &board);
    alexa.save_drawio_xml(&note, XML).unwrap();
    alexa.save_drawio_preview(&note, &preview("a.png")).unwrap();

    let mut alexa = reopen(alexa);
    let stored = alexa.note(&note).unwrap().unwrap();
    assert_eq!(context_text(&stored, "xml").as_deref(), Some(XML));
    assert_eq!(context_text(&stored, "preview").as_deref(), Some("a.png"));
}

#[test]
fn a_new_preview_reports_the_old_file_for_removal() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let note = diagram(&mut alexa, &board);

    assert_eq!(alexa.save_drawio_preview(&note, &preview("a.png")).unwrap(), None);
    assert_eq!(alexa.save_drawio_preview(&note, &preview("b.png")).unwrap().as_deref(), Some("a.png"));
    // 內容相同時檔名不變，不能把正在用的檔案回報成舊檔案。
    assert_eq!(alexa.save_drawio_preview(&note, &preview("b.png")).unwrap(), None);
}

#[test]
fn an_old_preview_shared_with_another_diagram_is_kept() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let first = diagram(&mut alexa, &board);
    let second = diagram(&mut alexa, &board);
    alexa.save_drawio_preview(&first, &preview("same.png")).unwrap();
    alexa.save_drawio_preview(&second, &preview("same.png")).unwrap();

    assert_eq!(alexa.save_drawio_preview(&first, &preview("new.png")).unwrap(), None);
    assert_eq!(alexa.save_drawio_preview(&second, &preview("new.png")).unwrap().as_deref(), Some("same.png"));
}

#[test]
fn deleting_a_diagram_reports_its_preview() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let note = diagram(&mut alexa, &board);
    alexa.save_drawio_preview(&note, &preview("a.png")).unwrap();
    assert_eq!(alexa.delete_notes(&[note]).unwrap(), ["a.png"]);
}

#[test]
fn saving_requires_a_diagram() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();
    let card_id = card.board.placed_notes[0].note_id.clone();
    assert!(alexa.save_drawio_xml(&card_id, XML).is_err());
    assert!(alexa.save_drawio_preview("missing", &preview("a.png")).is_err());
}
