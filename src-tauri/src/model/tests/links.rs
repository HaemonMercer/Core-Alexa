use super::*;

#[test]
fn finds_note_links_but_skips_code_and_other_links() {
    let content = "見 [甲](note:a) 與 **[乙 *斜體*](note:b)**\n\
        [網站](https://example.com) \\[跳脫\\](note:c)\n\
        `[行內](note:d)` [丙](note:e)\n\
        ```\n[區塊](note:f)\n```\n\
        ~~~md\n[區塊](note:g)\n~~~\n\
        ```[行內](note:h)```\n\
        [空]() [空白](note:i j) [未結束](note:k";
    let found = mentions(content);
    let ids: Vec<&str> = found.iter().map(|(id, _)| id.as_str()).collect();
    assert_eq!(ids, ["a", "b", "e"]);
    assert_eq!(found[1].1, "乙 *斜體*");
}

#[test]
fn links_in_content_appear_on_both_cards_and_follow_edits() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, a) = card(&mut alexa, &board);
    let (_, b) = card(&mut alexa, &board);
    let text = format!("看 [第二張](note:{b})，再看一次 [這裡](note:{b})");
    alexa.update_note_content(&a, &text).unwrap();

    let mut alexa = reopen(alexa);
    let from_a = alexa.note_links(&a).unwrap();
    assert_eq!(linked_ids(&from_a.outgoing), [b.as_str()]);
    assert_eq!(from_a.outgoing[0].source, ReferenceSource::Mention);
    assert_eq!(from_a.outgoing[0].label, "第二張");
    assert!(from_a.incoming.is_empty());
    let to_b = alexa.note_links(&b).unwrap();
    assert_eq!(linked_ids(&to_b.incoming), [a.as_str()]);
    assert!(to_b.outgoing.is_empty());

    alexa.update_note_content(&a, "連結刪掉了").unwrap();
    assert_eq!(alexa.note_links(&b).unwrap(), NoteLinks::default());
}

#[test]
fn ignores_links_to_itself_missing_notes_and_whiteboards() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board = new_board(&mut alexa);
    let (_, a) = card(&mut alexa, &board);
    let text = format!("[自己](note:{a}) [遺失](note:lost) [白板](note:{board})");
    alexa.update_note_content(&a, &text).unwrap();
    assert_eq!(alexa.note_links(&a).unwrap(), NoteLinks::default());
}

#[test]
fn a_card_removed_from_every_board_keeps_its_links() {
    let mut alexa = Alexa::with_connection(memory()).unwrap();
    let board_a = new_board(&mut alexa);
    let board_b = new_board(&mut alexa);
    let (placed, a) = card(&mut alexa, &board_a);
    let (_, b) = card(&mut alexa, &board_b);
    alexa
        .update_note_content(&a, &format!("[b](note:{b})"))
        .unwrap();
    alexa.remove_note(&board_a, &placed).unwrap();
    assert_eq!(linked_ids(&alexa.note_links(&b).unwrap().incoming), [a.as_str()]);
}
