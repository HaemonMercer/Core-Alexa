use super::super::media::fitted_image_size;
use super::*;
use crate::media::{ImportedMedia, MediaKind};

fn image(file: &str, width: u32, height: u32) -> ImportedMedia {
    ImportedMedia { file: file.to_string(), name: "照片.png".to_string(), kind: MediaKind::Image, width, height }
}

fn video(alexa: &mut Alexa, board: &str, file: &str) -> (String, String) {
    let imported = ImportedMedia { file: file.to_string(), name: "短片.mp4".to_string(), kind: MediaKind::Video, width: 0, height: 0 };
    let created = alexa.create_media_notes(board, &[imported], 500.0, 300.0, Vec::new()).unwrap();
    let placed = created.board.placed_notes.iter().find(|note| note.id == created.placed_ids[0]).unwrap();
    (placed.id.clone(), placed.note_id.clone())
}

fn info(poster: &str, width: f64, height: f64) -> VideoInfo {
    VideoInfo { width, height, duration: 12.5, poster: poster.to_string() }
}

fn image_note(alexa: &mut Alexa, board: &str, file: &str) -> String {
    let created = alexa.create_media_notes(board, &[image(file, 800, 600)], 0.0, 0.0, Vec::new()).unwrap();
    let placed = created.board.placed_notes.iter().find(|note| note.id == created.placed_ids[0]).unwrap();
    placed.note_id.clone()
}

#[test]
fn image_notes_keep_file_and_size_after_restart() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let note = image_note(&mut alexa, &board, "a.png");

    let mut alexa = reopen(alexa);
    let stored = alexa.note(&note).unwrap().unwrap();
    assert_eq!(stored.note_type, "image");
    let yrs::Any::Map(context) = stored.context else { panic!("context is not a map") };
    assert_eq!(context.get("media"), Some(&yrs::Any::from("a.png")));
    assert_eq!(context.get("name"), Some(&yrs::Any::from("照片.png")));
}

#[test]
fn placement_follows_the_image_ratio_on_every_board() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let other = new_board(&mut alexa);
    let note = image_note(&mut alexa, &board, "a.png");

    let placed = alexa.place_note(&other, &note, 0.0, 0.0).unwrap();
    let shown = placed.board.placed_notes.iter().find(|item| item.note_id == note).unwrap();
    assert_eq!((shown.w, shown.h), (480.0, 360.0));
}

#[test]
fn initial_size_shrinks_large_images_and_never_goes_below_the_minimum() {
    let big = fitted_image_size(4000.0, 2000.0);
    assert_eq!((big.w, big.h), (480.0, 240.0));
    let small = fitted_image_size(200.0, 100.0);
    assert_eq!((small.w, small.h), (200.0, 100.0));
    let icon = fitted_image_size(16.0, 16.0);
    assert_eq!((icon.w, icon.h), (80.0, 80.0));
    let banner = fitted_image_size(1000.0, 10.0);
    assert!(banner.h >= MIN_NOTE_SIZE.h);
}

#[test]
fn several_images_are_cascaded() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let images = [image("a.png", 100, 100), image("b.png", 100, 100)];
    let created = alexa.create_media_notes(&board, &images, 500.0, 500.0, vec!["c.txt: 不是圖片".to_string()]).unwrap();

    assert_eq!(created.failed.len(), 1);
    let at = |id: &str| created.board.placed_notes.iter().find(|note| note.id == id).unwrap();
    assert!(at(&created.placed_ids[1]).x > at(&created.placed_ids[0]).x);
}

#[test]
fn root_refuses_images() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    assert!(alexa.create_media_notes(ROOT_ID, &[image("a.png", 10, 10)], 0.0, 0.0, Vec::new()).is_err());
}

#[test]
fn deleting_reports_a_file_only_when_no_note_uses_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let first = image_note(&mut alexa, &board, "shared.png");
    let second = image_note(&mut alexa, &board, "shared.png");
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap();

    assert!(alexa.delete_notes(std::slice::from_ref(&first)).unwrap().is_empty());
    assert_eq!(alexa.delete_notes(std::slice::from_ref(&second)).unwrap(), ["shared.png"]);
    let card_id = card.board.placed_notes.iter().find(|note| note.id == card.placed_id).unwrap().note_id.clone();
    assert!(alexa.delete_notes(&[card_id]).unwrap().is_empty());
}

#[test]
fn deleting_every_user_of_a_file_together_reports_it_once() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let first = image_note(&mut alexa, &board, "shared.png");
    let second = image_note(&mut alexa, &board, "shared.png");
    assert_eq!(alexa.delete_notes(&[first, second]).unwrap(), ["shared.png"]);
}

#[test]
fn removing_from_a_whiteboard_keeps_the_file() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let created = alexa.create_media_notes(&board, &[image("a.png", 10, 10)], 0.0, 0.0, Vec::new()).unwrap();
    alexa.remove_note(&board, &created.placed_ids[0]).unwrap();
    assert_eq!(alexa.note_library().unwrap().len(), 1);
}

#[test]
fn video_starts_at_16_by_9_and_adopts_its_real_ratio_keeping_the_center() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (placed, note) = video(&mut alexa, &board, "a.mp4");
    let before = alexa.board(&board).unwrap().placed_notes.into_iter().find(|item| item.id == placed).unwrap();
    assert_eq!((before.w, before.h), (480.0, 270.0));

    let board_state = alexa.save_video_info(&board, &note, &info("p.jpg", 1080.0, 1920.0)).unwrap();
    let after = board_state.placed_notes.iter().find(|item| item.id == placed).unwrap();
    assert_eq!((after.w, after.h), (270.0, 480.0));
    assert_eq!(after.x + after.w / 2.0, before.x + before.w / 2.0);
    assert_eq!(after.y + after.h / 2.0, before.y + before.h / 2.0);
}

#[test]
fn video_info_survives_restart_and_later_placements_use_it() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let other = new_board(&mut alexa);
    let (_, note) = video(&mut alexa, &board, "a.mp4");
    alexa.save_video_info(&board, &note, &info("p.jpg", 1920.0, 1080.0)).unwrap();

    let mut alexa = reopen(alexa);
    let placed = alexa.place_note(&other, &note, 0.0, 0.0).unwrap();
    let shown = placed.board.placed_notes.iter().find(|item| item.note_id == note).unwrap();
    assert_eq!((shown.w, shown.h), (480.0, 270.0));
}

#[test]
fn video_info_is_only_for_videos_with_a_picture() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let photo = image_note(&mut alexa, &board, "a.png");
    assert!(alexa.save_video_info(&board, &photo, &info("p.jpg", 10.0, 10.0)).is_err());
    let (_, note) = video(&mut alexa, &board, "a.mp4");
    assert!(alexa.save_video_info(&board, &note, &info("p.jpg", 0.0, 0.0)).is_err());
}

#[test]
fn deleting_a_video_reports_the_file_and_its_poster() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, note) = video(&mut alexa, &board, "a.mp4");
    alexa.save_video_info(&board, &note, &info("p.jpg", 1920.0, 1080.0)).unwrap();
    assert_eq!(alexa.delete_notes(&[note]).unwrap(), ["a.mp4", "p.jpg"]);
}
