use super::*;
use crate::model::card_markdown::{blocks_from_markdown, markdown_from_blocks, CardBlock};

fn alexa() -> Alexa {
    Alexa::with_connection(memory()).unwrap()
}

fn card_with(alexa: &mut Alexa, content: &str) -> String {
    alexa.create_card(content).unwrap().id
}

fn summary(block: &CardBlock) -> (&str, &str, u32) {
    (block.kind.as_str(), block.text.as_str(), block.indent)
}

fn set_text(alexa: &mut Alexa, note: &str, id: &str, text: &str) {
    alexa.edit_writer(note, WriterOp::SetText { id: id.to_string(), text: text.to_string() }).unwrap();
}

/// 走過一次匯入再匯出，內容要一樣。
fn round_trip(alexa: &mut Alexa, content: &str) -> String {
    let note = card_with(alexa, content);
    let first = alexa.writer(&note).unwrap()[0].clone();
    set_text(alexa, &note, &first.id, &first.text);
    alexa.note(&note).unwrap().unwrap().content
}

#[test]
fn 舊卡片的語法變成區塊() {
    let blocks = blocks_from_markdown(
        "# 標題\n\n段落第一行\n第二行\n\n- 項目\n  - 子項目\n- [x] 完成\n- [ ] 待辦\n\n1. 一\n2. 二\n\n> 引言\n\n---\n\n```rust\nlet a = 1;\n```",
    );
    let kinds: Vec<_> = blocks.iter().map(summary).collect();
    assert_eq!(
        kinds,
        vec![
            ("h1", "標題", 0),
            ("paragraph", "段落第一行\n第二行", 0),
            ("bullet", "項目", 0),
            ("bullet", "子項目", 1),
            ("todo", "完成", 0),
            ("todo", "待辦", 0),
            ("number", "一", 0),
            ("number", "二", 0),
            ("quote", "引言", 0),
            ("divider", "", 0),
            ("code", "let a = 1;", 0),
        ]
    );
    assert!(blocks[4].checked);
    assert!(!blocks[5].checked);
    assert_eq!(blocks[10].language.as_deref(), Some("rust"));
}

#[test]
fn 第四層以下的標題併入第三層() {
    let blocks = blocks_from_markdown("#### 小標");
    assert_eq!(summary(&blocks[0]), ("h3", "小標", 0));
}

#[test]
fn 表格的第一列是表頭_分隔線不是內容() {
    let blocks = blocks_from_markdown("| a | b\\|c |\n| --- | :-: |\n| 1 |  |");
    let rows = blocks[0].table.as_ref().unwrap();
    assert_eq!(blocks[0].kind, "table");
    assert_eq!(rows, &vec![vec!["a".to_string(), "b|c".to_string()], vec!["1".to_string(), String::new()]]);
}

#[test]
fn 多的空行是空段落() {
    let blocks = blocks_from_markdown("a\n\n\n\nb");
    let kinds: Vec<_> = blocks.iter().map(summary).collect();
    assert_eq!(kinds, vec![("paragraph", "a", 0), ("paragraph", "", 0), ("paragraph", "", 0), ("paragraph", "b", 0)]);
}

#[test]
fn 開啟舊卡片不改內容也不改修改時間() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "# 標題\n\n* 星號清單");
    let before = alexa.note(&note).unwrap().unwrap();
    let blocks = alexa.writer(&note).unwrap();
    assert_eq!(blocks.len(), 2);
    let after = alexa.note(&note).unwrap().unwrap();
    assert_eq!(after.content, before.content);
    assert_eq!(after.updated_at, before.updated_at);
}

#[test]
fn 空白卡片有一個可以放游標的段落() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (_, note) = card(&mut alexa, &board);
    let blocks = alexa.writer(&note).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].kind, "paragraph");
}

#[test]
fn 區塊改完內容是_markdown() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "第一段");
    let id = alexa.writer(&note).unwrap()[0].id.clone();
    let add = |kind: &str, text: &str, indent: u32, after: &str, alexa: &mut Alexa| {
        let op = WriterOp::AddBlock {
            after: Some(after.to_string()),
            kind: kind.to_string(),
            text: Some(text.to_string()),
            indent: Some(indent),
            target: None,
            source: None,
            language: None,
            table: None,
            leave_columns: false,
        };
        alexa.edit_writer(&note, op).unwrap().focus.unwrap().id
    };
    let one = add("bullet", "項目", 0, &id, &mut alexa);
    let two = add("number", "子項目", 1, &one, &mut alexa);
    add("todo", "待辦", 0, &two, &mut alexa);
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "第一段\n\n- 項目\n  1. 子項目\n- [ ] 待辦");
}

#[test]
fn 卡片連結從區塊寫回內容後仍然推導得到() {
    let mut alexa = alexa();
    let target = card_with(&mut alexa, "目標");
    let note = card_with(&mut alexa, "來源");
    let id = alexa.writer(&note).unwrap()[0].id.clone();
    set_text(&mut alexa, &note, &id, &format!("看 [目標](note:{target})"));
    let links = alexa.note_links(&target).unwrap();
    assert_eq!(linked_ids(&links.incoming), vec![note.as_str()]);
}

#[test]
fn 復原之後內容跟著回去() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "原本");
    let id = alexa.writer(&note).unwrap()[0].id.clone();
    set_text(&mut alexa, &note, &id, "改過");
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "改過");
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "原本");
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "原本");
}

#[test]
fn 第一次匯入不能被復原掉() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "原本");
    alexa.writer(&note).unwrap();
    assert!(!alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.writer(&note).unwrap().len(), 1);
}

#[test]
fn 重新開啟後區塊還在() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "原本");
    let id = alexa.writer(&note).unwrap()[0].id.clone();
    set_text(&mut alexa, &note, &id, "改過");
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "改過");
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "改過");
}

#[test]
fn 直接改內容時區塊跟著重建() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "原本");
    alexa.writer(&note).unwrap();
    alexa.update_note_content(&note, "## 新內容").unwrap();
    let blocks = alexa.writer(&note).unwrap();
    assert_eq!(blocks.len(), 1);
    assert_eq!(blocks[0].kind, "h2");
    assert_eq!(blocks[0].text, "新內容");
}

#[test]
fn 常見的內容走一圈不變() {
    let mut alexa = alexa();
    for content in [
        "# 標題\n\n段落\n第二行",
        "- 項目\n  - 子項目\n    - 孫項目\n- 下一項",
        "1. 一\n   - 子\n2. 二",
        "- [ ] 待辦\n- [x] 完成",
        "> 引言\n> 第二行",
        "```rust\nlet a = 1;\n```",
        "| a | b |\n| --- | --- |\n| 1 | 2 |",
        "**粗體** 和 [連結](https://example.com)",
        "a\n\n\nb",
        "\\# 不是標題",
        "1\\. 不是清單",
    ] {
        assert_eq!(round_trip(&mut alexa, content), content);
    }
}

#[test]
fn 看起來像語法的文字要跳脫() {
    let blocks = [WriterBlock {
        id: "a".to_string(),
        kind: "paragraph".to_string(),
        text: "# 不是標題\n- 不是清單\n3. 不是編號".to_string(),
        indent: 0,
        checked: false,
        collapsed: false,
        language: None,
        note_id: None,
        source: None,
        table: None,
        group: None,
        column: 0,
        align: None,
        width: None,
    }];
    assert_eq!(markdown_from_blocks(&blocks, &HashMap::new()), "\\# 不是標題\n\\- 不是清單\n3\\. 不是編號");
}

#[test]
fn 圖片檔名不算搜尋內容() {
    let mut alexa = alexa();
    let note = card_with(&mut alexa, "看圖");
    let id = alexa.writer(&note).unwrap()[0].id.clone();
    set_text(&mut alexa, &note, &id, "看圖 ![](media:abcdef.png?w=1&h=1)");
    assert!(alexa.search_cards("abcdef", "").unwrap().is_empty());
    assert_eq!(alexa.search_cards("看圖", "").unwrap().len(), 1);
}

#[test]
fn 其他類型不能用區塊編輯() {
    let mut alexa = alexa();
    let note = alexa.create_document(NoteType::Sheet).unwrap().id;
    assert!(alexa.writer(&note).is_err());
}
