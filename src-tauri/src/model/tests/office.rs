use super::*;

fn alexa() -> Alexa {
    Alexa::with_connection(memory()).unwrap()
}

fn writer(alexa: &mut Alexa) -> String {
    alexa.create_document(NoteType::Writer).unwrap().id
}

fn sheet(alexa: &mut Alexa) -> String {
    alexa.create_document(NoteType::Sheet).unwrap().id
}

fn set(alexa: &mut Alexa, note: &str, row: &str, col: &str, raw: &str) -> SheetState {
    let cells = vec![CellInput { row: row.to_string(), col: col.to_string(), raw: raw.to_string() }];
    alexa.edit_sheet(note, SheetOp::SetCells { cells }).unwrap()
}

fn cell<'a>(state: &'a SheetState, row: &str, col: &str) -> &'a CellView {
    &state.tables[0].cells[&format!("{row}:{col}")]
}

/// 第一個表格的列與欄 id。
fn axes(state: &SheetState) -> (Vec<String>, Vec<String>) {
    let table = &state.tables[0];
    (
        table.rows.iter().map(|row| row.id.clone()).collect(),
        table.cols.iter().map(|col| col.id.clone()).collect(),
    )
}

fn split(alexa: &mut Alexa, note: &str, id: &str, before: &str, after: &str) -> WriterEdit {
    let op = WriterOp::Split { id: id.to_string(), before: before.to_string(), after: after.to_string() };
    alexa.edit_writer(note, op).unwrap()
}

fn patch_kind(alexa: &mut Alexa, note: &str, id: &str, kind: &str) {
    let op = WriterOp::Patch {
        id: id.to_string(),
        kind: Some(kind.to_string()),
        indent: None,
        checked: None,
        collapsed: None,
        language: None,
        align: None,
        width: None,
    };
    alexa.edit_writer(note, op).unwrap();
}

#[test]
fn 新文件有一個空段落且不能被復原掉() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    assert_eq!(alexa.writer(&note).unwrap().len(), 1);
    assert!(!alexa.undo_note(&note).unwrap());
}

#[test]
fn enter_分割區塊而清單會接續() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    patch_kind(&mut alexa, &note, &first, "bullet");
    let edit = split(&mut alexa, &note, &first, "前", "後");
    assert_eq!(edit.blocks.iter().map(|block| block.text.as_str()).collect::<Vec<_>>(), ["前", "後"]);
    assert_eq!(edit.blocks[1].kind, "bullet");
    assert_eq!(edit.focus.unwrap().id, edit.blocks[1].id);
}

#[test]
fn 空的清單項目按_enter_會變回段落() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    patch_kind(&mut alexa, &note, &first, "todo");
    let edit = split(&mut alexa, &note, &first, "", "");
    assert_eq!(edit.blocks.len(), 1);
    assert_eq!(edit.blocks[0].kind, "paragraph");
}

#[test]
fn backspace_先變段落再併入上一塊() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let edit = split(&mut alexa, &note, &first, "甲", "乙");
    let second = edit.blocks[1].id.clone();
    patch_kind(&mut alexa, &note, &second, "h1");

    let edit = alexa.edit_writer(&note, WriterOp::Merge { id: second.clone() }).unwrap();
    assert_eq!(edit.blocks[1].kind, "paragraph");
    assert_eq!(edit.blocks.len(), 2);

    let edit = alexa.edit_writer(&note, WriterOp::Merge { id: second }).unwrap();
    assert_eq!(edit.blocks.len(), 1);
    assert_eq!(edit.blocks[0].text, "甲乙");
    assert_eq!(edit.focus.unwrap().id, first);
}

#[test]
fn 刪除全部區塊後仍留一個空段落() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let ids = alexa.writer(&note).unwrap().iter().map(|block| block.id.clone()).collect();
    let edit = alexa.edit_writer(&note, WriterOp::Delete { ids }).unwrap();
    assert_eq!(edit.blocks.len(), 1);
    assert_eq!(edit.blocks[0].kind, "paragraph");
}

#[test]
fn 區塊可以搬到別的位置() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let edit = split(&mut alexa, &note, &first, "一", "二");
    let edit = split(&mut alexa, &note, &edit.blocks[1].id.clone(), "二", "三");
    let last = edit.blocks[2].id.clone();
    let op = WriterOp::Move { ids: vec![last], before: Some(first), indent: Some(1), group: None, column: None };
    let edit = alexa.edit_writer(&note, op).unwrap();
    assert_eq!(edit.blocks.iter().map(|block| block.text.as_str()).collect::<Vec<_>>(), ["三", "一", "二"]);
    assert_eq!(edit.blocks[0].indent, 1);
}

#[test]
fn 文件的內容重開後還在且摘要是純文字() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let op = WriterOp::SetText { id: first, text: "**粗體**內容".to_string() };
    alexa.edit_writer(&note, op).unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "**粗體**內容");
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "粗體內容");
}

#[test]
fn 復原與重做走回編輯前後的內容() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let op = WriterOp::SetText { id: first, text: "第一版".to_string() };
    alexa.edit_writer(&note, op).unwrap();
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "");
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "");
    assert!(alexa.redo_note(&note).unwrap());
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "第一版");
}

#[test]
fn 復原的結果重開後仍然存在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    split(&mut alexa, &note, &first, "留下", "取消");
    alexa.undo_note(&note).unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer(&note).unwrap().len(), 1);
}

fn plain_block(after: Option<String>, kind: &str, leave_columns: bool) -> WriterOp {
    WriterOp::AddBlock {
        after,
        kind: kind.to_string(),
        text: None,
        indent: None,
        target: None,
        source: None,
        language: None,
        table: None,
        leave_columns,
    }
}

fn table_block(after: Option<String>, rows: Vec<Vec<String>>) -> WriterOp {
    WriterOp::AddBlock {
        after,
        kind: "table".to_string(),
        text: None,
        indent: None,
        target: None,
        source: None,
        language: None,
        table: Some(rows),
        leave_columns: false,
    }
}

fn cells(rows: &[&[&str]]) -> Vec<Vec<String>> {
    rows.iter().map(|row| row.iter().map(|cell| cell.to_string()).collect()).collect()
}

fn beside(alexa: &mut Alexa, note: &str, id: &str, target: &str, side: BlockSide) -> WriterEdit {
    let op = WriterOp::MoveBeside { ids: vec![id.to_string()], target: target.to_string(), side };
    alexa.edit_writer(note, op).unwrap()
}

fn add_paragraph(alexa: &mut Alexa, note: &str) -> String {
    let after = alexa.writer(note).unwrap().last().map(|block| block.id.clone());
    alexa.edit_writer(note, plain_block(after, "paragraph", true)).unwrap().focus.unwrap().id
}

/// 把新文件的第二段拖到第一段右邊，回傳左右兩個區塊的 id。
fn two_columns(alexa: &mut Alexa, note: &str) -> (String, String) {
    let left = alexa.writer(note).unwrap()[0].id.clone();
    let right = add_paragraph(alexa, note);
    beside(alexa, note, &right, &left, BlockSide::Right);
    (left, right)
}

/// 每一欄的區塊 id，由左到右。
fn columns_of(blocks: &[WriterBlock]) -> Vec<Vec<String>> {
    let mut columns: Vec<Vec<String>> = Vec::new();
    for block in blocks.iter().filter(|block| block.group.is_some()) {
        let column = block.column as usize;
        columns.resize(columns.len().max(column + 1), Vec::new());
        columns[column].push(block.id.clone());
    }
    columns
}

#[test]
fn 拖到右邊或左邊都會變成兩欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    assert_eq!(columns_of(&alexa.writer(&note).unwrap()), [[left.clone()], [right.clone()]]);

    let other = writer(&mut alexa);
    let first = alexa.writer(&other).unwrap()[0].id.clone();
    let second = add_paragraph(&mut alexa, &other);
    let edit = beside(&mut alexa, &other, &second, &first, BlockSide::Left);
    assert_eq!(columns_of(&edit.blocks), [[second], [first]]);
}

#[test]
fn 分欄可以超過兩欄而且能插在中間() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let last = add_paragraph(&mut alexa, &note);
    beside(&mut alexa, &note, &last, &right, BlockSide::Right);
    let middle = add_paragraph(&mut alexa, &note);
    let edit = beside(&mut alexa, &note, &middle, &left, BlockSide::Right);
    assert_eq!(columns_of(&edit.blocks), [[left], [middle], [right], [last]]);
    let mut alexa = reopen(alexa);
    assert_eq!(columns_of(&alexa.writer(&note).unwrap()).len(), 4);
}

#[test]
fn 拖到自己的欄旁邊會變成新的一欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let below = split(&mut alexa, &note, &left, "", "").focus.unwrap().id;
    let edit = beside(&mut alexa, &note, &below, &left, BlockSide::Right);
    assert_eq!(columns_of(&edit.blocks), [[left], [below], [right]]);
}

#[test]
fn 中間那欄搬空後編號不留缺口() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let last = add_paragraph(&mut alexa, &note);
    beside(&mut alexa, &note, &last, &right, BlockSide::Right);
    let edit = alexa.edit_writer(&note, WriterOp::Delete { ids: vec![right] }).unwrap();
    assert_eq!(columns_of(&edit.blocks), [[left], [last]]);
}

#[test]
fn 分欄最多六欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (_, mut right) = two_columns(&mut alexa, &note);
    for _ in 0..4 {
        let next = add_paragraph(&mut alexa, &note);
        beside(&mut alexa, &note, &next, &right, BlockSide::Right);
        right = next;
    }
    let extra = add_paragraph(&mut alexa, &note);
    let op = WriterOp::MoveBeside { ids: vec![extra], target: right, side: BlockSide::Right };
    assert!(alexa.edit_writer(&note, op).is_err());
}

#[test]
fn 拖到分欄旁邊的底下縮排區塊一起走() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let toggle = alexa.writer(&note).unwrap()[0].id.clone();
    let child = add_paragraph(&mut alexa, &note);
    let child_indent = WriterOp::Patch { id: child.clone(), kind: None, indent: Some(1), checked: None, collapsed: None, language: None, align: None, width: None };
    alexa.edit_writer(&note, child_indent).unwrap();
    let other = add_paragraph(&mut alexa, &note);
    let edit = beside(&mut alexa, &note, &other, &toggle, BlockSide::Right);
    assert_eq!(columns_of(&edit.blocks), [vec![toggle, child], vec![other]]);
}

#[test]
fn 拖到自己旁邊沒有作用() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let edit = beside(&mut alexa, &note, &first, &first, BlockSide::Right);
    assert_eq!(edit.blocks[0].group, None);
}

#[test]
fn 表格會補齊欄數且重開後還在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    alexa.edit_writer(&note, table_block(Some(first), cells(&[&["甲", "乙"], &["丙"]]))).unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer(&note).unwrap()[1].table, Some(cells(&[&["甲", "乙"], &["丙", ""]])));
}

#[test]
fn 表格內容會進摘要() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.edit_writer(&note, table_block(None, cells(&[&["甲", "乙"]]))).unwrap();
    assert_eq!(alexa.note(&note).unwrap().unwrap().content, "甲\t乙");
}

#[test]
fn 空表格與過大的表格會被拒絕() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    assert!(alexa.edit_writer(&note, table_block(None, vec![])).is_err());
    assert!(alexa.edit_writer(&note, table_block(None, vec![vec![String::new(); 51]])).is_err());
    assert_eq!(alexa.writer(&note).unwrap().len(), 1);
}

#[test]
fn 表格連續打字併成一步而改結構是另一步() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let id = alexa.edit_writer(&note, table_block(None, cells(&[&["", ""]]))).unwrap().focus.unwrap().id;
    let set = |rows: Vec<Vec<String>>, typing| WriterOp::SetTable { id: id.clone(), rows, typing };
    alexa.edit_writer(&note, set(cells(&[&["甲", ""]]), true)).unwrap();
    alexa.edit_writer(&note, set(cells(&[&["甲乙", ""]]), true)).unwrap();
    alexa.edit_writer(&note, set(cells(&[&["甲乙", ""], &["", ""]]), false)).unwrap();
    let table = |alexa: &mut Alexa| alexa.writer(&note).unwrap().iter().find(|b| b.id == id).unwrap().table.clone();
    alexa.undo_note(&note).unwrap();
    assert_eq!(table(&mut alexa), Some(cells(&[&["甲乙", ""]])));
    alexa.undo_note(&note).unwrap();
    assert_eq!(table(&mut alexa), Some(cells(&[&["", ""]])));
}

#[test]
fn 分欄裡按_enter_留在同一欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let edit = split(&mut alexa, &note, &left, "左一", "左二");
    let new = edit.blocks.iter().find(|block| block.id == edit.focus.as_ref().unwrap().id).unwrap();
    assert_eq!((new.group.is_some(), new.column), (true, 0));
    assert_eq!(edit.blocks.last().unwrap().id, right);
}

#[test]
fn 一欄刪空後剩下的變回普通區塊() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let edit = alexa.edit_writer(&note, WriterOp::Delete { ids: vec![right] }).unwrap();
    assert_eq!(edit.blocks[0].id, left);
    assert_eq!(edit.blocks[0].group, None);
}

#[test]
fn 取消分欄後左欄在上() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let edit = alexa.edit_writer(&note, WriterOp::Uncolumn { id: right.clone() }).unwrap();
    assert_eq!(edit.blocks.iter().map(|block| block.id.clone()).collect::<Vec<_>>(), [left, right]);
    assert!(edit.blocks.iter().all(|block| block.group.is_none()));
}

#[test]
fn 分欄的_backspace_不會跨欄合併文字() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    alexa.edit_writer(&note, WriterOp::SetText { id: left, text: "左".to_string() }).unwrap();
    alexa.edit_writer(&note, WriterOp::SetText { id: right.clone(), text: "右".to_string() }).unwrap();
    let edit = alexa.edit_writer(&note, WriterOp::Merge { id: right }).unwrap();
    assert_eq!(edit.blocks.iter().map(|block| block.text.as_str()).collect::<Vec<_>>(), ["左", "右"]);
}

#[test]
fn 分欄裡空的區塊按_backspace_會解除分欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (left, right) = two_columns(&mut alexa, &note);
    let edit = alexa.edit_writer(&note, WriterOp::Merge { id: right }).unwrap();
    assert_eq!(edit.blocks.len(), 1);
    assert_eq!(edit.focus.unwrap().id, left);
    assert_eq!(edit.blocks[0].group, None);
}

#[test]
fn 分欄後面可以新增欄外的區塊() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (_, right) = two_columns(&mut alexa, &note);
    let edit = alexa.edit_writer(&note, plain_block(Some(right), "paragraph", true)).unwrap();
    assert_eq!(edit.blocks.last().unwrap().group, None);
}

#[test]
fn 區塊可以拖進分欄也可以拖出來() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (_, right) = two_columns(&mut alexa, &note);
    let outside = alexa.edit_writer(&note, plain_block(Some(right.clone()), "paragraph", true)).unwrap().focus.unwrap().id;
    let group = alexa.writer(&note).unwrap()[0].group.clone();
    let into = WriterOp::Move { ids: vec![outside.clone()], before: None, indent: Some(0), group, column: Some(1) };
    let edit = alexa.edit_writer(&note, into).unwrap();
    assert_eq!(edit.blocks.last().unwrap().column, 1);
    assert!(edit.blocks.last().unwrap().group.is_some());
    let out = WriterOp::Move { ids: vec![outside], before: None, indent: Some(0), group: None, column: None };
    assert_eq!(alexa.edit_writer(&note, out).unwrap().blocks.last().unwrap().group, None);
}

#[test]
fn 複製分欄裡的區塊會留在同一欄() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let (_, right) = two_columns(&mut alexa, &note);
    let edit = alexa.edit_writer(&note, WriterOp::Duplicate { id: right }).unwrap();
    assert_eq!(edit.blocks.last().unwrap().column, 1);
    assert!(edit.blocks.last().unwrap().group.is_some());
}

fn patch_look(id: &str, align: Option<&str>, width: Option<f64>) -> WriterOp {
    WriterOp::Patch {
        id: id.to_string(),
        kind: None,
        indent: None,
        checked: None,
        collapsed: None,
        language: None,
        align: align.map(ToString::to_string),
        width,
    }
}

#[test]
fn 換頁與目錄沒有文字可以併而且重開後還在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let edit = alexa.edit_writer(&note, plain_block(Some(first), "pagebreak", false)).unwrap();
    let mark = edit.focus.unwrap().id;
    alexa.edit_writer(&note, plain_block(Some(mark.clone()), "toc", false)).unwrap();
    let after = add_paragraph(&mut alexa, &note);
    let mut alexa = reopen(alexa);
    let kinds: Vec<String> = alexa.writer(&note).unwrap().iter().map(|block| block.kind.clone()).collect();
    assert_eq!(kinds, ["paragraph", "pagebreak", "toc", "paragraph"]);
    // 行首按 Backspace 會把前面的換頁記號刪掉，和分隔線一樣。
    let toc = alexa.writer(&note).unwrap()[2].id.clone();
    alexa.edit_writer(&note, WriterOp::Delete { ids: vec![toc] }).unwrap();
    let edit = alexa.edit_writer(&note, WriterOp::Merge { id: after }).unwrap();
    assert!(edit.blocks.iter().all(|block| block.id != mark));
}

#[test]
fn 對齊會存下來且按_enter_延續() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    alexa.edit_writer(&note, patch_look(&first, Some("center"), None)).unwrap();
    let edit = split(&mut alexa, &note, &first, "上", "下");
    assert!(edit.blocks.iter().all(|block| block.align.as_deref() == Some("center")));
    let edit = alexa.edit_writer(&note, patch_look(&first, Some(""), None)).unwrap();
    assert_eq!(edit.blocks[0].align, None);
}

#[test]
fn 不認識的對齊會被拒絕() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    assert!(alexa.edit_writer(&note, patch_look(&first, Some("middle"), None)).is_err());
}

#[test]
fn 圖片寬度有上下限且複製時帶著() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    assert_eq!(alexa.edit_writer(&note, patch_look(&first, None, Some(3.0))).unwrap().blocks[0].width, Some(10.0));
    assert_eq!(alexa.edit_writer(&note, patch_look(&first, None, Some(500.0))).unwrap().blocks[0].width, Some(100.0));
    alexa.edit_writer(&note, patch_look(&first, None, Some(40.0))).unwrap();
    let edit = alexa.edit_writer(&note, WriterOp::Duplicate { id: first }).unwrap();
    assert_eq!(edit.blocks[1].width, Some(40.0));
}

fn page(size: &str, landscape: bool, margin: &str) -> WriterPage {
    WriterPage {
        size: size.to_string(),
        landscape,
        margin: margin.to_string(),
        header: WriterBand::default(),
        footer: WriterBand::default(),
        number: PageNumber { place: "none".to_string(), align: "center".to_string(), format: "plain".to_string() },
        skip_first: false,
    }
}

#[test]
fn 文件預設是_a4_直向() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    assert_eq!(alexa.writer_page(&note).unwrap(), page("A4", false, "normal"));
}

#[test]
fn 版面重開後還在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.set_writer_page(&note, page("B4", true, "narrow"), false).unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer_page(&note).unwrap(), page("B4", true, "narrow"));
}

#[test]
fn 不認識的紙張與邊距會被拒絕() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    assert!(alexa.set_writer_page(&note, page("A9", false, "normal"), false).is_err());
    assert!(alexa.set_writer_page(&note, page("A5", false, "huge"), false).is_err());
    assert_eq!(alexa.writer_page(&note).unwrap(), page("A4", false, "normal"));
}

#[test]
fn 換紙張可以復原且和內容分成兩步() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    alexa.edit_writer(&note, WriterOp::SetText { id: first, text: "內容".to_string() }).unwrap();
    alexa.set_writer_page(&note, page("A5", false, "normal"), false).unwrap();
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.writer_page(&note).unwrap().size, "A4");
    assert_eq!(alexa.writer(&note).unwrap()[0].text, "內容");
    assert!(alexa.redo_note(&note).unwrap());
    assert_eq!(alexa.writer_page(&note).unwrap().size, "A5");
}

fn with_bands() -> WriterPage {
    WriterPage {
        header: WriterBand { left: "專案".to_string(), center: String::new(), right: "機密".to_string() },
        footer: WriterBand { left: String::new(), center: "公司".to_string(), right: String::new() },
        number: PageNumber { place: "footer".to_string(), align: "right".to_string(), format: "chineseTotal".to_string() },
        skip_first: true,
        ..page("A4", false, "normal")
    }
}

#[test]
fn 文件預設沒有頁首頁尾和頁碼() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let current = alexa.writer_page(&note).unwrap();
    assert_eq!(current.header, WriterBand::default());
    assert_eq!(current.footer, WriterBand::default());
    assert_eq!(current.number.place, "none");
    assert!(!current.skip_first);
}

#[test]
fn 頁首頁尾與頁碼重開後還在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.set_writer_page(&note, with_bands(), false).unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.writer_page(&note).unwrap(), with_bands());
}

#[test]
fn 不認識的頁碼設定會被拒絕() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let broken = |change: fn(&mut PageNumber)| {
        let mut next = with_bands();
        change(&mut next.number);
        next
    };
    assert!(alexa.set_writer_page(&note, broken(|number| number.place = "side".to_string()), false).is_err());
    assert!(alexa.set_writer_page(&note, broken(|number| number.align = "top".to_string()), false).is_err());
    assert!(alexa.set_writer_page(&note, broken(|number| number.format = "roman".to_string()), false).is_err());
    assert_eq!(alexa.writer_page(&note).unwrap(), page("A4", false, "normal"));
}

#[test]
fn 打頁首時連續輸入併成一步() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.set_writer_page(&note, page("A5", false, "normal"), false).unwrap();
    let mut typed = page("A5", false, "normal");
    for text in ["專", "專案", "專案名稱"] {
        typed.header.left = text.to_string();
        alexa.set_writer_page(&note, typed.clone(), true).unwrap();
    }
    assert!(alexa.undo_note(&note).unwrap());
    let current = alexa.writer_page(&note).unwrap();
    assert_eq!(current.header.left, "");
    assert_eq!(current.size, "A5");
}

#[test]
fn 只有改動的頁首欄位會寫入() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.set_writer_page(&note, with_bands(), false).unwrap();
    let clock = |alexa: &Alexa| alexa.notes[&note].doc.transact().state_vector().iter().map(|(_, clock)| *clock).sum::<u32>();
    let before = clock(&alexa);
    let mut next = with_bands();
    next.header.right = "公開".to_string();
    alexa.set_writer_page(&note, next, true).unwrap();
    // 這一格加上 `meta.updatedAt`。
    assert_eq!(clock(&alexa) - before, 2);
}

#[test]
fn 公式會計算並顯示當下的座標() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let (rows, cols) = axes(&alexa.sheet(&note).unwrap());
    set(&mut alexa, &note, &rows[0], &cols[0], "10");
    set(&mut alexa, &note, &rows[1], &cols[0], "32");
    let state = set(&mut alexa, &note, &rows[2], &cols[0], "=sum(A1:A2)");
    let total = cell(&state, &rows[2], &cols[0]);
    assert_eq!(total.number, Some(42.0));
    assert_eq!(total.raw, "=sum(A1:A2)");
}

#[test]
fn 插入列後公式仍指向原本的格子() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let (rows, cols) = axes(&alexa.sheet(&note).unwrap());
    set(&mut alexa, &note, &rows[1], &cols[0], "7");
    set(&mut alexa, &note, &rows[0], &cols[1], "=A2*2");
    let op = SheetOp::InsertRows { table_id: alexa.sheet(&note).unwrap().tables[0].id.clone(), after: None, before: Some(rows[0].clone()), count: 1 };
    let state = alexa.edit_sheet(&note, op).unwrap();
    let formula = cell(&state, &rows[0], &cols[1]);
    assert_eq!(formula.raw, "=A3*2");
    assert_eq!(formula.number, Some(14.0));
}

#[test]
fn 刪除被參照的列會顯示_ref_錯誤() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    set(&mut alexa, &note, &rows[1], &cols[0], "7");
    set(&mut alexa, &note, &rows[0], &cols[1], "=A2");
    let op = SheetOp::DeleteRows { table_id: state.tables[0].id.clone(), ids: vec![rows[1].clone()] };
    let state = alexa.edit_sheet(&note, op).unwrap();
    let formula = cell(&state, &rows[0], &cols[1]);
    assert_eq!(formula.display, "#REF!");
    assert_eq!(formula.raw, "=#REF!");
}

#[test]
fn 循環參照不會無窮遞迴() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let (rows, cols) = axes(&alexa.sheet(&note).unwrap());
    set(&mut alexa, &note, &rows[0], &cols[0], "=B1");
    let state = set(&mut alexa, &note, &rows[0], &cols[1], "=A1");
    assert_eq!(cell(&state, &rows[0], &cols[0]).display, "#CIRC!");
}

#[test]
fn 公式可以參照別的表格() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    let tab_id = state.tabs[0].id.clone();
    set(&mut alexa, &note, &rows[0], &cols[0], "5");
    let state = alexa.edit_sheet(&note, SheetOp::AddTable { tab_id, x: 0.0, y: 400.0 }).unwrap();
    assert_eq!(state.tables[1].name, "表格2");
    let row = state.tables[1].rows[0].id.clone();
    let col = state.tables[1].cols[0].id.clone();
    let state = set(&mut alexa, &note, &row, &col, "=表格1::A1+1");
    let view = &state.tables[1].cells[&format!("{row}:{col}")];
    assert_eq!(view.number, Some(6.0));
    assert_eq!(view.raw, "=表格1::A1+1");
}

#[test]
fn 貼上超出範圍時表格會長大() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    let op = SheetOp::Paste {
        table_id: state.tables[0].id.clone(),
        row: rows.last().unwrap().clone(),
        col: cols.last().unwrap().clone(),
        values: vec![vec!["a".to_string(), "b".to_string()], vec!["c".to_string(), "d".to_string()]],
    };
    let state = alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(state.tables[0].rows.len(), rows.len() + 1);
    assert_eq!(state.tables[0].cols.len(), cols.len() + 1);
    let last_row = &state.tables[0].rows.last().unwrap().id;
    let last_col = &state.tables[0].cols.last().unwrap().id;
    assert_eq!(state.tables[0].cells[&format!("{last_row}:{last_col}")].display, "d");
}

#[test]
fn 排序只動內容列且空白排最後() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    set(&mut alexa, &note, &rows[0], &cols[0], "標題");
    set(&mut alexa, &note, &rows[1], &cols[0], "3");
    set(&mut alexa, &note, &rows[2], &cols[0], "1");
    set(&mut alexa, &note, &rows[3], &cols[0], "2");
    let op = SheetOp::Sort { table_id: state.tables[0].id.clone(), col_id: cols[0].clone(), descending: false };
    let state = alexa.edit_sheet(&note, op).unwrap();
    let order: Vec<&str> = state.tables[0].rows.iter().map(|row| row.id.as_str()).collect();
    assert_eq!(order[0], rows[0]);
    assert_eq!(&order[1..4], [rows[2].as_str(), rows[3].as_str(), rows[1].as_str()]);
}

#[test]
fn 表格名稱不能重複() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let tab_id = state.tabs[0].id.clone();
    let state = alexa.edit_sheet(&note, SheetOp::AddTable { tab_id, x: 0.0, y: 0.0 }).unwrap();
    let op = SheetOp::PatchTable {
        id: state.tables[1].id.clone(),
        name: Some("表格1".to_string()),
        x: None,
        y: None,
        header_rows: None,
        header_cols: None,
        footer_rows: None,
        filter: None,
    };
    assert!(alexa.edit_sheet(&note, op).is_err());
}

#[test]
fn 表格至少留一列() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, _) = axes(&state);
    let op = SheetOp::DeleteRows { table_id: state.tables[0].id.clone(), ids: rows };
    assert!(alexa.edit_sheet(&note, op).is_err());
}

fn range(note: &str, state: &SheetState, rows: usize, cols: usize) -> CellRange {
    let (row_ids, col_ids) = axes(state);
    CellRange {
        note_id: note.to_string(),
        table_id: state.tables[0].id.clone(),
        rows: row_ids[..rows].to_vec(),
        cols: col_ids[..cols].to_vec(),
    }
}

#[test]
fn 引入的範圍可以寫回來源的格子() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let source = range(&note, &state, 2, 2);
    let view = alexa.cell_range(&source).unwrap();
    assert_eq!(view.row_ids, source.rows);
    assert_eq!(view.col_ids, source.cols);
    set(&mut alexa, &note, &view.row_ids[1], &view.col_ids[1], "42");
    let (rows, cols) = (view.row_ids.clone(), view.col_ids.clone());
    set(&mut alexa, &note, &rows[0], &cols[0], "=1+2");
    let view = alexa.cell_range(&source).unwrap();
    assert_eq!(view.rows[1][1].display, "42");
    assert_eq!(view.rows[0][0].display, "3");
    assert_eq!(view.rows[0][0].raw, "=1+2");
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.cell_range(&source).unwrap().rows[0][0].display, "");
}

#[test]
fn 引入的範圍在增刪列後仍然正確() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    for (index, text) in ["甲", "乙", "丙"].iter().enumerate() {
        set(&mut alexa, &note, &rows[index], &cols[0], text);
    }
    let source = range(&note, &state, 3, 1);
    let table_id = state.tables[0].id.clone();

    // 中間插入的列也算在範圍內。
    let op = SheetOp::InsertRows { table_id: table_id.clone(), after: Some(rows[0].clone()), before: None, count: 1 };
    alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(alexa.cell_range(&source).unwrap().rows.len(), 4);

    // 範圍的第一列被刪除，範圍縮小但內容仍對。
    let op = SheetOp::DeleteRows { table_id, ids: vec![rows[0].clone()] };
    alexa.edit_sheet(&note, op).unwrap();
    let view = alexa.cell_range(&source).unwrap();
    assert_eq!(view.rows.last().unwrap()[0].display, "丙");
    assert!(view.error.is_none());
}

#[test]
fn 來源試算表刪除後引入會說明原因() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let source = range(&note, &state, 2, 2);
    alexa.delete_notes(&[note]).unwrap();
    assert_eq!(alexa.cell_range(&source).unwrap().error.as_deref(), Some("來源試算表已被刪除"));
}

#[test]
fn 圖表跟著試算表更新() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols) = axes(&state);
    set(&mut alexa, &note, &rows[0], &cols[1], "銷售");
    set(&mut alexa, &note, &rows[1], &cols[0], "一月");
    set(&mut alexa, &note, &rows[1], &cols[1], "10");
    set(&mut alexa, &note, &rows[2], &cols[0], "二月");
    set(&mut alexa, &note, &rows[2], &cols[1], "20");
    let tab_id = state.tabs[0].id.clone();
    let created = alexa.create_chart(range(&note, &state, 3, 2), &tab_id, "bar").unwrap();
    assert_eq!(created.sheet.objects.len(), 1);

    let chart = alexa.chart(&created.note.id).unwrap();
    assert_eq!(chart.labels, ["一月", "二月"]);
    assert_eq!(chart.series[0].name, "銷售");
    assert_eq!(chart.series[0].values, [Some(10.0), Some(20.0)]);

    set(&mut alexa, &note, &rows[2], &cols[1], "25");
    assert_eq!(alexa.chart(&created.note.id).unwrap().series[0].values[1], Some(25.0));

    let swapped = alexa.set_chart(&created.note.id, Some("radar"), Some("rows")).unwrap();
    assert_eq!(swapped.kind, "radar");
    assert_eq!(swapped.series.iter().map(|series| series.name.as_str()).collect::<Vec<_>>(), ["一月", "二月"]);
}

#[test]
fn 圖表種類只接受七種() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let source = range(&note, &state, 2, 2);
    assert!(alexa.create_chart(source, &state.tabs[0].id, "bubble").is_err());
}

#[test]
fn 刪除圖表後試算表頁面不再顯示() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let created = alexa.create_chart(range(&note, &state, 2, 2), &state.tabs[0].id, "line").unwrap();
    alexa.delete_notes(&[created.note.id]).unwrap();
    assert!(alexa.sheet(&note).unwrap().objects.is_empty());
}

#[test]
fn 引入內容會出現在連結裡() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let doc = writer(&mut alexa);
    let op = WriterOp::AddBlock {
        after: None,
        kind: "cells".to_string(),
        text: None,
        indent: None,
        target: None,
        source: Some(range(&note, &state, 2, 2)),
        language: None,
        table: None,
        leave_columns: false,
    };
    alexa.edit_writer(&doc, op).unwrap();
    let links = alexa.note_links(&note).unwrap();
    assert_eq!(linked_ids(&links.incoming), [doc.as_str()]);
    assert_eq!(alexa.note_deletion(&[note]).unwrap().linked_cards, 1);
}

fn slides(alexa: &mut Alexa) -> String {
    alexa.create_document(NoteType::Slides).unwrap().id
}

fn add_slide(alexa: &mut Alexa, note: &str, layout: &str) -> SlidesEdit {
    let op = SlidesOp::AddSlide { after: None, layout: layout.to_string() };
    alexa.edit_slides(note, op).unwrap()
}

#[test]
fn 新簡報有一張標題投影片() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let state = alexa.slides(&note).unwrap();
    assert_eq!(state.slides.len(), 1);
    assert_eq!(state.slides[0].elements.len(), 2);
}

#[test]
fn 投影片可以新增複製刪除且至少留一張() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let edit = add_slide(&mut alexa, &note, "content");
    assert_eq!(edit.state.slides.len(), 2);
    let second = edit.created.unwrap();
    let first = edit.state.slides[0].id.clone();

    let edit = alexa.edit_slides(&note, SlidesOp::DuplicateSlide { id: second.clone() }).unwrap();
    assert_eq!(edit.state.slides.len(), 3);
    assert_eq!(edit.state.slides[2].elements.len(), 2);
    assert_ne!(edit.state.slides[2].elements[0].id, edit.state.slides[1].elements[0].id);

    alexa.edit_slides(&note, SlidesOp::DeleteSlide { id: edit.created.unwrap() }).unwrap();
    alexa.edit_slides(&note, SlidesOp::DeleteSlide { id: second }).unwrap();
    assert!(alexa.edit_slides(&note, SlidesOp::DeleteSlide { id: first }).is_err());
}

#[test]
fn 投影片可以調整順序() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let edit = add_slide(&mut alexa, &note, "blank");
    let second = edit.created.unwrap();
    let first = edit.state.slides[0].id.clone();
    let op = SlidesOp::MoveSlide { id: second.clone(), before: Some(first) };
    let edit = alexa.edit_slides(&note, op).unwrap();
    assert_eq!(edit.state.slides[0].id, second);
}

#[test]
fn 物件可以修改移動並調整上下層() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let slide = alexa.slides(&note).unwrap().slides[0].id.clone();
    let op = SlidesOp::AddElement {
        slide_id: slide,
        kind: "shape".to_string(),
        shape: Some("ellipse".to_string()),
        target: None,
        source: None,
        x: None,
        y: None,
    };
    let edit = alexa.edit_slides(&note, op).unwrap();
    let id = edit.created.unwrap();
    assert_eq!(edit.state.slides[0].elements.last().unwrap().id, id);

    let patch = ElementPatch { fill: Some("#ff0000".to_string()), font_size: Some(999.0), ..ElementPatch::default() };
    let edit = alexa.edit_slides(&note, SlidesOp::PatchElement { id: id.clone(), patch }).unwrap();
    let element = edit.state.slides[0].elements.last().unwrap();
    assert_eq!(element.fill.as_deref(), Some("#ff0000"));
    assert_eq!(element.font_size, 200.0);

    let edit = alexa.edit_slides(&note, SlidesOp::OrderElement { id: id.clone(), front: false }).unwrap();
    assert_eq!(edit.state.slides[0].elements[0].id, id);

    let moves = vec![NoteMove { id: id.clone(), x: 10.0, y: 20.0 }];
    let edit = alexa.edit_slides(&note, SlidesOp::MoveElements { moves }).unwrap();
    assert_eq!(edit.state.slides[0].elements[0].x, 10.0);
}

#[test]
fn 不合法的顏色會被拒絕() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let id = alexa.slides(&note).unwrap().slides[0].elements[0].id.clone();
    let patch = ElementPatch { fill: Some("red".to_string()), ..ElementPatch::default() };
    assert!(alexa.edit_slides(&note, SlidesOp::PatchElement { id, patch }).is_err());
}

#[test]
fn 放上白板時會有初始內容() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let created = alexa.create_note(&board, NoteType::Sheet, 0.0, 0.0).unwrap();
    let placed = &created.board.placed_notes[0];
    assert_eq!(placed.w, 460.0);
    assert_eq!(alexa.sheet(&placed.note_id).unwrap().tables.len(), 1);
}

#[test]
fn 名稱存在_context_且重開後還在() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    alexa.rename_note(&note, "  計畫書 ").unwrap();
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.note(&note).unwrap().unwrap().context, Any::from(HashMap::from([("name".to_string(), Any::from("計畫書"))])));
}

#[test]
fn 卡片不能改名() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (_, note) = card(&mut alexa, &board);
    assert!(alexa.rename_note(&note, "名稱").is_err());
}

#[test]
fn each_structural_edit_is_its_own_undo_step() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let add = |alexa: &mut Alexa| {
        let after = alexa.writer(&note).unwrap().last().map(|block| block.id.clone());
        let op = plain_block(after, "paragraph", false);
        alexa.edit_writer(&note, op).unwrap();
    };
    add(&mut alexa);
    add(&mut alexa);
    let count = alexa.writer(&note).unwrap().len();
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.writer(&note).unwrap().len(), count - 1);
    assert!(alexa.undo_note(&note).unwrap());
    assert_eq!(alexa.writer(&note).unwrap().len(), count - 2);
}

#[test]
fn continuous_typing_undoes_together_but_not_with_the_split_before_it() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let first = alexa.writer(&note).unwrap()[0].id.clone();
    let op = WriterOp::Split { id: first, before: "上一段".into(), after: String::new() };
    let id = alexa.edit_writer(&note, op).unwrap().focus.unwrap().id;
    let count = alexa.writer(&note).unwrap().len();
    for text in ["你", "你好"] {
        alexa.edit_writer(&note, WriterOp::SetText { id: id.clone(), text: text.into() }).unwrap();
    }
    assert!(alexa.undo_note(&note).unwrap());
    let blocks = alexa.writer(&note).unwrap();
    assert_eq!(blocks.len(), count);
    assert_eq!(blocks.last().unwrap().text, "");
}

/// 每次插入後，列的順序都要和預期完全相同。
#[test]
fn inserted_rows_keep_their_position_after_many_inserts() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let table = state.tables[0].id.clone();
    let mut expected: Vec<String> = axes(&state).0;
    for round in 0..300usize {
        let at = (round * 7) % expected.len();
        let before_mode = round % 3 != 2;
        let anchor = expected[at].clone();
        let op = if before_mode {
            SheetOp::InsertRows { table_id: table.clone(), after: None, before: Some(anchor), count: 1 }
        } else {
            SheetOp::InsertRows { table_id: table.clone(), after: Some(anchor), before: None, count: 1 }
        };
        let next = axes(&alexa.edit_sheet(&note, op).unwrap()).0;
        assert_eq!(next.len(), expected.len() + 1, "第 {round} 次");
        let slot = if before_mode { at } else { at + 1 };
        let created = next.iter().find(|id| !expected.contains(id)).unwrap().clone();
        expected.insert(slot, created);
        assert_eq!(next, expected, "第 {round} 次插在 {slot}");
    }
}

/// 建立一份有兩個表格的試算表，回傳它與兩個表格的 id。
fn sheet_with_two_tables(alexa: &mut Alexa) -> (String, String, String) {
    let note = sheet(alexa);
    let state = alexa.sheet(&note).unwrap();
    let tab_id = state.tabs[0].id.clone();
    let next = alexa.edit_sheet(&note, SheetOp::AddTable { tab_id, x: 40.0, y: 500.0 }).unwrap();
    (note, next.tables[0].id.clone(), next.tables[1].id.clone())
}

#[test]
fn a_sheet_can_show_each_table_once_on_a_board() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, second) = sheet_with_two_tables(&mut alexa);

    let a = alexa.place_table(&board, &note, &first, 0.0, 0.0).unwrap();
    let b = alexa.place_table(&board, &note, &second, 500.0, 0.0).unwrap();
    assert!(a.created && b.created);
    assert_ne!(a.placed_id, b.placed_id);

    let again = alexa.place_table(&board, &note, &second, 900.0, 900.0).unwrap();
    assert!(!again.created);
    assert_eq!(again.placed_id, b.placed_id);
    assert_eq!(again.board.placed_notes.len(), 2);
}

#[test]
fn a_table_on_a_board_survives_a_reopen() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, _, second) = sheet_with_two_tables(&mut alexa);
    let placed = alexa.place_table(&board, &note, &second, 0.0, 0.0).unwrap();
    let alexa = &mut reopen(alexa);
    let state = alexa.board(&board).unwrap();
    assert_eq!(state.placed_notes[0].id, placed.placed_id);
    assert_eq!(state.placed_notes[0].table_id.as_deref(), Some(second.as_str()));
}

#[test]
fn placing_a_table_rejects_other_notes_and_unknown_tables() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, _) = sheet_with_two_tables(&mut alexa);
    let other = writer(&mut alexa);
    assert!(alexa.place_table(&board, &note, "不存在", 0.0, 0.0).is_err());
    assert!(alexa.place_table(&board, &other, &first, 0.0, 0.0).is_err());
    assert!(alexa.place_table(ROOT_ID, &note, &first, 0.0, 0.0).is_err());
}

#[test]
fn a_placement_without_a_table_counts_as_the_first_one() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let note = alexa.create_note(&board, NoteType::Sheet, 0.0, 0.0).unwrap();
    let id = note.board.placed_notes[0].note_id.clone();
    assert_eq!(note.board.placed_notes[0].table_id, None);
    let first = alexa.sheet(&id).unwrap().tables[0].id.clone();
    let placed = alexa.place_table(&board, &id, &first, 0.0, 0.0).unwrap();
    assert!(!placed.created);
    assert_eq!(placed.placed_id, note.placed_id);
}

#[test]
fn place_note_on_a_sheet_uses_its_first_table() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, _) = sheet_with_two_tables(&mut alexa);
    let placed = alexa.place_note(&board, &note, 0.0, 0.0).unwrap();
    assert_eq!(placed.board.placed_notes[0].table_id.as_deref(), Some(first.as_str()));
}

#[test]
fn the_card_is_sized_to_its_table() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, second) = sheet_with_two_tables(&mut alexa);
    let state = alexa.sheet(&note).unwrap();
    let cols = state.tables[0].cols.len() as f64;
    let width: f64 = state.tables[0].cols.iter().map(|col| col.size).sum();
    assert!(cols > 0.0);
    let small = alexa.place_table(&board, &note, &first, 0.0, 0.0).unwrap();
    let card = &small.board.placed_notes[0];
    assert!(card.w > width);

    // 欄很多時不會比上限寬。
    let table_id = second.clone();
    alexa.edit_sheet(&note, SheetOp::InsertCols { table_id, after: None, before: None, count: 40 }).unwrap();
    let wide = alexa.place_table(&board, &note, &second, 0.0, 0.0).unwrap();
    let card = wide.board.placed_notes.iter().find(|placed| placed.id == wide.placed_id).unwrap();
    assert_eq!(card.w, 900.0);
}

#[test]
fn switching_the_table_refuses_a_table_already_shown() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, second) = sheet_with_two_tables(&mut alexa);
    let tab_id = alexa.sheet(&note).unwrap().tabs[0].id.clone();
    let third = alexa.edit_sheet(&note, SheetOp::AddTable { tab_id, x: 40.0, y: 900.0 }).unwrap().tables[2].id.clone();
    let a = alexa.place_table(&board, &note, &first, 0.0, 0.0).unwrap().placed_id;
    let b = alexa.place_table(&board, &note, &second, 500.0, 0.0).unwrap().placed_id;

    assert!(alexa.set_placed_table(&board, &a, &second).is_err(), "第二個已經在白板上");
    let state = alexa.set_placed_table(&board, &a, &third).unwrap();
    let card = state.placed_notes.iter().find(|placed| placed.id == a).unwrap();
    assert_eq!(card.table_id.as_deref(), Some(third.as_str()));
    assert!(state.placed_notes.iter().any(|placed| placed.id == b));
    assert!(alexa.set_placed_table(&board, &a, "不存在").is_err());
}

#[test]
fn deleting_a_table_keeps_its_card_on_the_board() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let (note, first, second) = sheet_with_two_tables(&mut alexa);
    alexa.place_table(&board, &note, &second, 0.0, 0.0).unwrap();
    alexa.edit_sheet(&note, SheetOp::DeleteTable { id: second.clone() }).unwrap();
    let state = alexa.board(&board).unwrap();
    assert_eq!(state.placed_notes[0].table_id.as_deref(), Some(second.as_str()));
    let placed = state.placed_notes[0].id.clone();
    let state = alexa.set_placed_table(&board, &placed, &first).unwrap();
    assert_eq!(state.placed_notes[0].table_id.as_deref(), Some(first.as_str()));
}

/// 替試算表建立一張圖表，範圍是第一個表格的全部格子。
fn chart_of(alexa: &mut Alexa, note: &str, kind: &str) -> String {
    let state = alexa.sheet(note).unwrap();
    let table = &state.tables[0];
    let source = CellRange {
        note_id: note.to_string(),
        table_id: table.id.clone(),
        rows: table.rows.iter().map(|row| row.id.clone()).collect(),
        cols: table.cols.iter().map(|col| col.id.clone()).collect(),
    };
    let tab = state.tabs[0].id.clone();
    alexa.create_chart(source, &tab, kind).unwrap().note.id
}

#[test]
fn charts_are_kept_inside_their_source_sheet() {
    let mut alexa = alexa();
    let (budget, first, second) = sheet_with_two_tables(&mut alexa);
    let other = sheet(&mut alexa);
    let a = chart_of(&mut alexa, &budget, "line");
    std::thread::sleep(std::time::Duration::from_millis(3));
    let b = chart_of(&mut alexa, &budget, "pie");
    let c = chart_of(&mut alexa, &other, "bar");

    let docs = alexa.office_documents().unwrap();
    let ids = |charts: &[Note]| charts.iter().map(|note| note.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&docs.sheets[&budget].charts), vec![a, b], "依建立順序");
    assert_eq!(ids(&docs.sheets[&other].charts), vec![c]);
    assert!(!docs.notes.iter().any(|note| note.note_type == "chart"), "最上層不放圖表");

    let tables: Vec<&str> = docs.sheets[&budget].tables.iter().map(|table| table.id.as_str()).collect();
    assert_eq!(tables, vec![first.as_str(), second.as_str()]);
    assert_eq!(docs.sheets[&budget].tables[0].rows, 8);
}

#[test]
fn tables_are_listed_in_tab_order() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let state = alexa.edit_sheet(&note, SheetOp::AddTab).unwrap();
    let second_tab = state.tabs[1].id.clone();
    let first_tab = state.tabs[0].id.clone();
    let state = alexa.edit_sheet(&note, SheetOp::AddTable { tab_id: first_tab.clone(), x: 0.0, y: 500.0 }).unwrap();
    let in_tab = |state: &SheetState, tab: &str| state.tables.iter().filter(|t| t.tab_id == tab).count();
    assert_eq!(in_tab(&state, &second_tab), 1);
    let docs = alexa.office_documents().unwrap();
    let names: Vec<usize> = docs.sheets[&note]
        .tables
        .iter()
        .map(|table| state.tables.iter().find(|t| t.id == table.id).unwrap())
        .map(|table| state.tabs.iter().position(|tab| tab.id == table.tab_id).unwrap())
        .collect();
    assert_eq!(names, vec![0, 0, 1]);
}

#[test]
fn a_chart_returns_to_the_top_level_when_its_sheet_is_deleted() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let chart = chart_of(&mut alexa, &note, "line");
    alexa.delete_notes(&[note.clone()]).unwrap();
    let docs = alexa.office_documents().unwrap();
    assert!(docs.sheets.is_empty());
    assert!(docs.notes.iter().any(|item| item.id == chart));
}

#[test]
fn nesting_survives_a_reopen() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let chart = chart_of(&mut alexa, &note, "line");
    let docs = reopen(alexa).office_documents().unwrap();
    assert_eq!(docs.sheets[&note].charts[0].id, chart);
}

#[test]
fn deleting_a_chart_removes_it_from_its_sheet() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let chart = chart_of(&mut alexa, &note, "line");
    alexa.delete_notes(&[chart]).unwrap();
    assert!(alexa.office_documents().unwrap().sheets[&note].charts.is_empty());
}

#[test]
fn card_notes_leave_out_every_office_type() {
    let mut alexa = alexa();
    let board = new_board(&mut alexa);
    let card = alexa.create_note(&board, NoteType::Card, 0.0, 0.0).unwrap().board.placed_notes[0].note_id.clone();
    writer(&mut alexa);
    alexa.create_document(NoteType::Slides).unwrap();
    let note = sheet(&mut alexa);
    chart_of(&mut alexa, &note, "line");

    let cards: Vec<String> = alexa.card_notes().unwrap().into_iter().map(|item| item.id).collect();
    assert_eq!(cards, vec![card.clone()]);
    assert_eq!(alexa.office_documents().unwrap().notes.len(), 3, "Writer、Slides、Excels");
    assert_eq!(alexa.note_library().unwrap().len(), 5, "引入內容的選擇視窗仍要看得到全部");
}

fn ids(state: &SheetState) -> (Vec<String>, Vec<String>, String) {
    let (rows, cols) = axes(state);
    (rows, cols, state.tables[0].id.clone())
}

fn seeded(alexa: &mut Alexa, values: &[&[&str]]) -> (String, Vec<String>, Vec<String>, String) {
    let note = sheet(alexa);
    let state = alexa.sheet(&note).unwrap();
    let (rows, cols, table) = ids(&state);
    let inputs = values.iter().enumerate().flat_map(|(y, line)| {
        let (rows, cols) = (&rows, &cols);
        line.iter().enumerate().map(move |(x, raw)| CellInput { row: rows[y].clone(), col: cols[x].clone(), raw: raw.to_string() })
    });
    alexa.edit_sheet(&note, SheetOp::SetCells { cells: inputs.collect() }).unwrap();
    (note, rows, cols, table)
}

fn shown(state: &SheetState, row: &str, col: &str) -> String {
    state.tables[0].cells.get(&format!("{row}:{col}")).map_or(String::new(), |cell| cell.display.clone())
}

fn raw_of(state: &SheetState, row: &str, col: &str) -> String {
    state.tables[0].cells.get(&format!("{row}:{col}")).map_or(String::new(), |cell| cell.raw.clone())
}

fn fill_down(alexa: &mut Alexa, note: &str, table: &str, from: &[String], to: &[String], col: &str) -> SheetState {
    let op = SheetOp::Fill {
        table_id: table.to_string(),
        source_rows: from.to_vec(),
        source_cols: vec![col.to_string()],
        target_rows: to.to_vec(),
        target_cols: vec![col.to_string()],
        series: true,
    };
    alexa.edit_sheet(note, op).unwrap()
}

#[test]
fn 絕對參照的錢字號存檔後還在() {
    let mut alexa = alexa();
    let (note, rows, cols, _) = seeded(&mut alexa, &[&["=$A$2+A$2+$B2"]]);
    let state = alexa.sheet(&note).unwrap();
    assert_eq!(raw_of(&state, &rows[0], &cols[0]), "=$A$2+A$2+$B2");
}

#[test]
fn 舊格式的公式仍然讀得出來() {
    let mut alexa = alexa();
    let (note, rows, cols, _) = seeded(&mut alexa, &[&["5", "=A1*2"]]);
    let mut alexa = reopen(alexa);
    assert_eq!(shown(&alexa.sheet(&note).unwrap(), &rows[0], &cols[1]), "10");
}

#[test]
fn 填充公式會移動相對參照而絕對參照不動() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["1", "=A1*$A$1"], &["2"], &["3"]]);
    let state = fill_down(&mut alexa, &note, &table, &rows[..1], &rows[1..3], &cols[1]);
    assert_eq!(raw_of(&state, &rows[2], &cols[1]), "=A3*$A$1");
    assert_eq!(shown(&state, &rows[2], &cols[1]), "3");
}

#[test]
fn 往上填公式超出表格會變成_ref() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&[""], &["=A1"]]);
    let state = fill_down(&mut alexa, &note, &table, &rows[1..2], &rows[..1], &cols[0]);
    assert_eq!(shown(&state, &rows[0], &cols[0]), "#REF!");
}

#[test]
fn 填充數字序列與往上延伸() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&[""], &["10"], &["20"], &[""]]);
    let state = fill_down(&mut alexa, &note, &table, &rows[1..3], &rows[3..4], &cols[0]);
    assert_eq!(shown(&state, &rows[3], &cols[0]), "30");
    let state = {
        let _ = state;
        fill_down(&mut alexa, &note, &table, &rows[1..3], &rows[..1], &cols[0])
    };
    assert_eq!(shown(&state, &rows[0], &cols[0]), "0");
}

#[test]
fn 填充會帶上樣式() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["甲"], &[""]]);
    let style = StylePatch { bold: Some(true), fill: Some("#fde8e8".to_string()), ..StylePatch::default() };
    alexa.edit_sheet(&note, SheetOp::SetStyle { rows: rows[..1].to_vec(), cols: cols[..1].to_vec(), style }).unwrap();
    let state = fill_down(&mut alexa, &note, &table, &rows[..1], &rows[1..2], &cols[0]);
    let cell = &state.tables[0].cells[&format!("{}:{}", rows[1], cols[0])];
    assert_eq!((cell.display.as_str(), cell.bold, cell.fill.as_deref()), ("乙", true, Some("#fde8e8")));
}

#[test]
fn 非序列模式只照抄並移動參照() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["1", "=A1"], &["2", ""]]);
    let op = SheetOp::Fill {
        table_id: table,
        source_rows: rows[..1].to_vec(),
        source_cols: cols[..2].to_vec(),
        target_rows: rows[1..2].to_vec(),
        target_cols: cols[..2].to_vec(),
        series: false,
    };
    let state = alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(raw_of(&state, &rows[1], &cols[0]), "1");
    assert_eq!(raw_of(&state, &rows[1], &cols[1]), "=A2");
}

#[test]
fn 合併只留第一個有內容的格子() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["", "乙"], &["丙", ""]]);
    let op = SheetOp::MergeCells { table_id: table, rows: rows[..2].to_vec(), cols: cols[..2].to_vec() };
    let state = alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(state.tables[0].merges, [CellMerge { top: 0, left: 0, rows: 2, cols: 2 }]);
    assert_eq!(shown(&state, &rows[0], &cols[0]), "乙");
    assert_eq!(shown(&state, &rows[1], &cols[0]), "");
    alexa.undo_note(&note).unwrap();
    let state = alexa.sheet(&note).unwrap();
    assert!(state.tables[0].merges.is_empty());
    assert_eq!(shown(&state, &rows[1], &cols[0]), "丙");
}

#[test]
fn 合併重開後還在且增刪列會調整範圍() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["甲"]]);
    alexa.edit_sheet(&note, SheetOp::MergeCells { table_id: table.clone(), rows: rows[1..4].to_vec(), cols: cols[..1].to_vec() }).unwrap();
    let mut alexa = reopen(alexa);
    alexa.edit_sheet(&note, SheetOp::InsertRows { table_id: table.clone(), after: Some(rows[1].clone()), before: None, count: 1 }).unwrap();
    assert_eq!(alexa.sheet(&note).unwrap().tables[0].merges[0].rows, 4);
    let state = alexa.edit_sheet(&note, SheetOp::DeleteRows { table_id: table, ids: rows[1..2].to_vec() }).unwrap();
    assert_eq!(state.tables[0].merges[0], CellMerge { top: 2, left: 0, rows: 2, cols: 1 });
}

#[test]
fn 合併會包住重疊的舊合併而取消合併會移除() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["甲"]]);
    alexa.edit_sheet(&note, SheetOp::MergeCells { table_id: table.clone(), rows: rows[..2].to_vec(), cols: cols[..2].to_vec() }).unwrap();
    let op = SheetOp::MergeCells { table_id: table.clone(), rows: rows[1..3].to_vec(), cols: cols[1..3].to_vec() };
    let state = alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(state.tables[0].merges, [CellMerge { top: 0, left: 0, rows: 3, cols: 3 }]);
    let op = SheetOp::UnmergeCells { table_id: table, rows: rows[2..3].to_vec(), cols: cols[2..3].to_vec() };
    assert!(alexa.edit_sheet(&note, op).unwrap().tables[0].merges.is_empty());
}

#[test]
fn 一格不能合併() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["甲"]]);
    let op = SheetOp::MergeCells { table_id: table, rows: rows[..1].to_vec(), cols: cols[..1].to_vec() };
    assert!(alexa.edit_sheet(&note, op).is_err());
}

#[test]
fn 有跨列合併時不能排序但跨欄可以() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["標題"], &["2"], &["1"]]);
    let across = SheetOp::MergeCells { table_id: table.clone(), rows: rows[..1].to_vec(), cols: cols[..2].to_vec() };
    alexa.edit_sheet(&note, across).unwrap();
    let sort = || SheetOp::Sort { table_id: table.clone(), col_id: cols[0].clone(), descending: false };
    assert!(alexa.edit_sheet(&note, sort()).is_ok());
    let down = SheetOp::MergeCells { table_id: table.clone(), rows: rows[1..3].to_vec(), cols: cols[1..2].to_vec() };
    alexa.edit_sheet(&note, down).unwrap();
    assert!(alexa.edit_sheet(&note, sort()).is_err());
}

#[test]
fn 篩選只藏內容列且資料還在() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["水果", "數量"], &["蘋果", "1"], &["橘子", "2"], &["蘋果", "3"]]);
    alexa.edit_sheet(&note, SheetOp::PatchTable { id: table.clone(), name: None, x: None, y: None, header_rows: None, header_cols: None, footer_rows: None, filter: Some(true) }).unwrap();
    let op = SheetOp::SetFilter { table_id: table.clone(), col_id: cols[0].clone(), values: Some(vec!["蘋果".to_string()]) };
    let state = alexa.edit_sheet(&note, op).unwrap();
    assert_eq!(state.tables[0].hidden_rows, [rows[2].clone()]);
    assert_eq!(shown(&state, &rows[2], &cols[0]), "橘子");
    let mut alexa = reopen(alexa);
    assert_eq!(alexa.sheet(&note).unwrap().tables[0].hidden_rows.len(), 1);
    let off = SheetOp::SetFilter { table_id: table, col_id: cols[0].clone(), values: None };
    assert!(alexa.edit_sheet(&note, off).unwrap().tables[0].hidden_rows.is_empty());
}

#[test]
fn 兩欄都篩選時要同時符合而空白列不藏() {
    let mut alexa = alexa();
    let (note, rows, cols, table) = seeded(&mut alexa, &[&["甲", "乙"], &["1", "x"], &["1", "y"], &["2", "x"]]);
    for (col, value) in [(&cols[0], "1"), (&cols[1], "x")] {
        let op = SheetOp::SetFilter { table_id: table.clone(), col_id: col.clone(), values: Some(vec![value.to_string()]) };
        alexa.edit_sheet(&note, op).unwrap();
    }
    let state = alexa.sheet(&note).unwrap();
    assert_eq!(state.tables[0].hidden_rows, [rows[2].clone(), rows[3].clone()]);
}

#[test]
fn 關閉篩選會清除條件() {
    let mut alexa = alexa();
    let (note, _, cols, table) = seeded(&mut alexa, &[&["甲"], &["1"], &["2"]]);
    let patch = |on| SheetOp::PatchTable { id: table.clone(), name: None, x: None, y: None, header_rows: None, header_cols: None, footer_rows: None, filter: Some(on) };
    alexa.edit_sheet(&note, patch(true)).unwrap();
    alexa.edit_sheet(&note, SheetOp::SetFilter { table_id: table.clone(), col_id: cols[0].clone(), values: Some(vec!["1".to_string()]) }).unwrap();
    let state = alexa.edit_sheet(&note, patch(false)).unwrap();
    assert!(state.tables[0].filters.is_empty() && state.tables[0].hidden_rows.is_empty() && !state.tables[0].filter_on);
}

#[test]
fn 底線與刪除線() {
    let mut alexa = alexa();
    let (note, rows, cols, _) = seeded(&mut alexa, &[&["甲"]]);
    let style = StylePatch { underline: Some(true), strike: Some(true), ..StylePatch::default() };
    let state = alexa.edit_sheet(&note, SheetOp::SetStyle { rows: rows[..1].to_vec(), cols: cols[..1].to_vec(), style }).unwrap();
    let cell = &state.tables[0].cells[&format!("{}:{}", rows[0], cols[0])];
    assert!(cell.underline && cell.strike);
}

#[test]
fn 新增的函數() {
    let mut alexa = alexa();
    let rows: &[&[&str]] = &[
        &["甲", "1", "x", "=SUMIFS(B1:B3,A1:A3,\"甲\",C1:C3,\"x\")"],
        &["乙", "2", "y", "=COUNTIFS(A1:A3,\"甲\")"],
        &["甲", "4", "x", "=XLOOKUP(\"乙\",A1:A3,B1:B3)"],
        &["=LARGE(B1:B3,1)", "=SMALL(B1:B3,1)", "=SUBSTITUTE(\"a-b\",\"-\",\"+\")", "=FIND(\"乙\",\"甲乙\")"],
        &["=CEILING(2.1,0.5)", "=FLOOR(2.9)", "=COUNTBLANK(A6:C6)", "=TEXTJOIN(\",\",TRUE,A1:A3)"],
        &["", "", "", "=HLOOKUP(2,B1:B3,1)"],
    ];
    let (note, ids, cols, _) = seeded(&mut alexa, rows);
    let state = alexa.sheet(&note).unwrap();
    let at = |y: usize, x: usize| shown(&state, &ids[y], &cols[x]);
    assert_eq!((at(0, 3), at(1, 3), at(2, 3)), ("5".to_string(), "2".to_string(), "2".to_string()));
    assert_eq!((at(3, 0), at(3, 1), at(3, 2), at(3, 3)), ("4".to_string(), "1".to_string(), "a+b".to_string(), "2".to_string()));
    assert_eq!((at(4, 0), at(4, 1), at(4, 2), at(4, 3)), ("2.5".to_string(), "2".to_string(), "3".to_string(), "甲,乙,甲".to_string()));
}

mod series_rules {
    use crate::model::fill::{series, today, Filled};

    fn next(samples: &[&str], offset: i64) -> Filled {
        series(&samples.iter().map(ToString::to_string).collect::<Vec<_>>(), offset)
    }

    fn text(value: &str) -> Filled {
        Filled::Text(value.to_string())
    }

    #[test]
    fn 單一數字照抄_兩個數字才是數列() {
        assert_eq!(next(&["5"], 1), Filled::Copy(0));
        assert_eq!(next(&["1", "3"], 2), text("5"));
        assert_eq!(next(&["1", "3"], -1), text("-1"));
        assert_eq!(next(&["0.1", "0.2"], 2), text("0.3"));
    }

    #[test]
    fn 文字裡的編號會遞增且保留前導零() {
        assert_eq!(next(&["第1週"], 3), text("第4週"));
        assert_eq!(next(&["A-007"], 1), text("A-008"));
        assert_eq!(next(&["Item 2", "Item 4"], 2), text("Item 6"));
        assert_eq!(next(&["第1週"], -5), Filled::Copy(0));
    }

    #[test]
    fn 日期會處理跨月與閏年() {
        assert_eq!(next(&["2026-01-31"], 1), text("2026-02-01"));
        assert_eq!(next(&["2028/2/28"], 1), text("2028/2/29"));
        assert_eq!(next(&["2026-11-06", "2026-11-13"], 2), text("2026-11-20"));
        // 不是合法的日期，就當成一般的編號。
        assert_eq!(next(&["2026-13-01"], 1), text("2026-13-02"));
    }

    #[test]
    fn 清單會循環() {
        assert_eq!(next(&["星期日"], 1), text("星期一"));
        assert_eq!(next(&["一月"], 12), text("一月"));
        assert_eq!(next(&["Q4"], 1), text("Q1"));
        assert_eq!(next(&["週一", "週三"], 2), text("週五"));
        assert_eq!(next(&["Mon"], -1), text("Sun"));
    }

    #[test]
    fn 看不出規則就循環照抄() {
        assert_eq!(next(&["蘋果"], 3), Filled::Copy(0));
        assert_eq!(next(&["蘋果", "橘子"], 3), Filled::Copy(1));
        assert_eq!(next(&["=A1"], 2), Filled::Copy(0));
        assert_eq!(next(&["", "1"], 2), Filled::Copy(0));
    }

    #[test]
    fn 今天是日期格式() {
        assert_eq!(today().len(), 10);
    }
}

fn add_card_block(alexa: &mut Alexa, note: &str, card: &str) -> Result<WriterEdit, String> {
    let op = WriterOp::AddBlock {
        after: None,
        kind: "card".to_string(),
        text: None,
        indent: None,
        target: Some(card.to_string()),
        source: None,
        language: None,
        table: None,
        leave_columns: false,
    };
    alexa.edit_writer(note, op)
}

fn add_card_element(alexa: &mut Alexa, note: &str, slide: &str, card: &str, at: Option<(f64, f64)>) -> Result<SlidesEdit, String> {
    let op = SlidesOp::AddElement {
        slide_id: slide.to_string(),
        kind: "card".to_string(),
        shape: None,
        target: Some(card.to_string()),
        source: None,
        x: at.map(|point| point.0),
        y: at.map(|point| point.1),
    };
    alexa.edit_slides(note, op)
}

#[test]
fn 卡片放進_writer_是引用_同一份文件只放一次() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let card = alexa.create_card("原本的內容").unwrap().id;

    let first = add_card_block(&mut alexa, &note, &card).unwrap();
    let id = first.focus.unwrap().id;
    let again = add_card_block(&mut alexa, &note, &card).unwrap();
    assert_eq!(again.focus.unwrap().id, id, "再放一次要回到原本的區塊");
    let count = |blocks: &[WriterBlock]| blocks.iter().filter(|block| block.kind == "card").count();
    assert_eq!(count(&alexa.writer(&note).unwrap()), 1);

    let copy = alexa.edit_writer(&note, WriterOp::Duplicate { id: id.clone() }).unwrap();
    assert_eq!(count(&copy.blocks), 1, "複製區塊不能繞過一份文件一次的規則");

    let block = alexa.writer(&note).unwrap().into_iter().find(|block| block.id == id).unwrap();
    assert_eq!(block.note_id.as_deref(), Some(card.as_str()));
    assert_eq!(block.text, "", "卡片的內容不能複製進文件");
}

#[test]
fn 文件不能當成卡片放置() {
    let mut alexa = alexa();
    let note = writer(&mut alexa);
    let other = writer(&mut alexa);
    assert!(add_card_block(&mut alexa, &note, &other).is_err());
    assert!(add_card_block(&mut alexa, &note, "missing").is_err());
}

#[test]
fn 卡片不能放進卡片() {
    let mut alexa = alexa();
    let card = alexa.create_card("外面").unwrap().id;
    let inner = alexa.create_card("裡面").unwrap().id;
    assert!(add_card_block(&mut alexa, &card, &inner).is_err());
}

#[test]
fn 卡片放到投影片的位置_不超出畫面_每張投影片一次() {
    let mut alexa = alexa();
    let note = slides(&mut alexa);
    let card = alexa.create_card("內容").unwrap().id;
    let slide = alexa.slides(&note).unwrap().slides[0].id.clone();

    let edit = add_card_element(&mut alexa, &note, &slide, &card, Some((640.0, 360.0))).unwrap();
    let id = edit.created.unwrap();
    let element = edit.state.slides[0].elements.iter().find(|item| item.id == id).unwrap().clone();
    assert_eq!((element.x + element.w / 2.0, element.y + element.h / 2.0), (640.0, 360.0));

    let again = add_card_element(&mut alexa, &note, &slide, &card, Some((10.0, 10.0))).unwrap();
    assert_eq!(again.created.as_deref(), Some(id.as_str()));
    let count = |state: &SlidesState, slide: usize| state.slides[slide].elements.iter().filter(|item| item.kind == "card").count();
    assert_eq!(count(&again.state, 0), 1);

    let copy = alexa.edit_slides(&note, SlidesOp::DuplicateElements { ids: vec![id] }).unwrap();
    assert_eq!(count(&copy.state, 0), 1, "複製物件不能繞過一張投影片一次的規則");

    let added = alexa.edit_slides(&note, SlidesOp::AddSlide { after: None, layout: "blank".to_string() }).unwrap();
    let next = added.created.unwrap();
    let edit = add_card_element(&mut alexa, &note, &next, &card, Some((0.0, 9999.0))).unwrap();
    let element = edit.state.slides.iter().flat_map(|slide| &slide.elements).find(|item| item.slide_id == next && item.kind == "card").unwrap();
    assert_eq!(element.x, 0.0);
    assert_eq!(element.y + element.h, 720.0);
}

#[test]
fn 卡片放到_excels_分頁_刪除後消失且不刪除卡片() {
    let mut alexa = alexa();
    let note = sheet(&mut alexa);
    let card = alexa.create_card("內容").unwrap().id;
    let state = alexa.sheet(&note).unwrap();
    let tab = state.tabs[0].id.clone();
    let place = |tab: &str, x| SheetOp::PlaceCard { tab_id: tab.to_string(), target: card.clone(), x, y: 300.0 };

    let state = alexa.edit_sheet(&note, place(&tab, 500.0)).unwrap();
    assert_eq!(state.objects.len(), 1);
    assert_eq!(state.objects[0].note_type, "card");
    assert_eq!(state.objects[0].note_id, card);

    let state = alexa.edit_sheet(&note, place(&tab, 900.0)).unwrap();
    assert_eq!(state.objects.len(), 1, "同一個分頁只放一次");

    alexa.edit_sheet(&note, SheetOp::AddTab).unwrap();
    let state = alexa.sheet(&note).unwrap();
    let other = state.tabs.iter().find(|item| item.id != tab).unwrap().id.clone();
    let state = alexa.edit_sheet(&note, place(&other, 500.0)).unwrap();
    assert_eq!(state.objects.len(), 2);

    let refs = alexa.mention_references().unwrap();
    assert!(refs.iter().any(|reference| reference.from_id == note && reference.to_id == card), "卡片要看得到放在哪份 Excels");

    let id = state.objects[0].id.clone();
    let state = alexa.edit_sheet(&note, SheetOp::RemoveObject { id }).unwrap();
    assert_eq!(state.objects.len(), 1);
    assert!(alexa.note(&card).unwrap().is_some());

    alexa.delete_notes(std::slice::from_ref(&card)).unwrap();
    assert!(alexa.sheet(&note).unwrap().objects.is_empty());
}
