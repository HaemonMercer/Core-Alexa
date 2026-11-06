//! 模型對外的資料形狀，也是前端看到的 JSON。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use yrs::Any;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteType {
    Card,
    Sheet,
    Mindmap,
    Mermaid,
    Image,
    Video,
    Drawio,
    Code,
    Writer,
    Slides,
    Chart,
}

impl NoteType {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            NoteType::Card => "card",
            NoteType::Sheet => "sheet",
            NoteType::Mindmap => "mindmap",
            NoteType::Mermaid => "mermaid",
            NoteType::Image => "image",
            NoteType::Video => "video",
            NoteType::Drawio => "drawio",
            NoteType::Code => "code",
            NoteType::Writer => "writer",
            NoteType::Slides => "slides",
            NoteType::Chart => "chart",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Whiteboard {
    pub id: String,
    pub name: String,
    pub created_at: f64,
    /// 方塊所在的白板；只有 Root 沒有上層。
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PlacedNoteStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Size {
    pub w: f64,
    pub h: f64,
}

/// 箭頭畫在哪一端。線永遠從 `fromPlacedID` 拉到 `toPlacedID`，反向只改這個值。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArrowDirection {
    Forward,
    Backward,
    Both,
    None,
}

impl ArrowDirection {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            ArrowDirection::Forward => "forward",
            ArrowDirection::Backward => "backward",
            ArrowDirection::Both => "both",
            ArrowDirection::None => "none",
        }
    }

    pub(super) fn parse(value: Option<String>) -> Self {
        match value.as_deref() {
            Some("backward") => ArrowDirection::Backward,
            Some("both") => ArrowDirection::Both,
            Some("none") => ArrowDirection::None,
            _ => ArrowDirection::Forward,
        }
    }
}

/// 白板上的連線。接在放置上而不是筆記上：同一張卡片可以放在很多白板上，
/// 線只屬於其中一個白板。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Arrow {
    pub id: String,
    #[serde(rename = "fromPlacedID")]
    pub from_placed_id: String,
    #[serde(rename = "toPlacedID")]
    pub to_placed_id: String,
    pub direction: ArrowDirection,
    pub label: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReferenceSource {
    /// 內文裡的連結。
    Mention,
    /// 白板上的箭頭。
    Arrow,
}

/// ER 模型的 Note References，加上另一端的筆記與箭頭所在的白板。
/// 由內文與白板推導而來，不另外儲存，多人同時編輯時不會有兩份資料不一致。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteLink {
    pub id: String,
    #[serde(rename = "fromID")]
    pub from_id: String,
    #[serde(rename = "toID")]
    pub to_id: String,
    pub source: ReferenceSource,
    pub label: String,
    pub whiteboard_name: Option<String>,
    pub note: Note,
}

/// 連結卡片時的一個候選。內容相同或空白的卡片要靠所在白板分辨。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CardMatch {
    pub note: Note,
    pub whiteboards: Vec<String>,
}

/// 刪除筆記前要讓使用者知道的影響。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDeletion {
    pub whiteboards: Vec<String>,
    /// 內文連到這些筆記、又沒有一起被刪的卡片數，刪除後那些連結會失效。
    pub linked_cards: usize,
}

/// 刪除白板前要讓使用者知道的影響。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhiteboardDeletion {
    pub child_whiteboards: usize,
    /// 放在這些白板上的不重複筆記數；筆記本身不會被刪除。
    pub notes: usize,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct NoteLinks {
    pub outgoing: Vec<NoteLink>,
    pub incoming: Vec<NoteLink>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlacedNote {
    pub id: String,
    #[serde(rename = "whiteboardID")]
    pub whiteboard_id: String,
    #[serde(rename = "noteID")]
    pub note_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(rename = "zKey")]
    pub z_key: String,
    pub style: PlacedNoteStyle,
    /// 卡片高度是否跟著內容；舊資料沒有這個欄位，視為開啟。
    #[serde(rename = "autoFit")]
    pub auto_fit: bool,
    pub collapsed: bool,
    /// 試算表放在白板上時顯示的表格；舊資料沒有這個欄位，視為第一個表格。
    #[serde(rename = "tableID")]
    pub table_id: Option<String>,
    /// 由 Rust 決定，不存進資料；前端拖曳預覽時用同一個限制。
    #[serde(rename = "minSize")]
    pub min_size: Size,
}

/// 前端依內容量出來的卡片高度。
#[derive(Debug, Clone, Deserialize)]
pub struct NoteFit {
    pub id: String,
    pub h: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NoteMove {
    pub id: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    /// 保留字串：讀到新版才有的類型時，舊版仍能顯示佔位框。
    #[serde(rename = "type")]
    pub note_type: String,
    pub context: Any,
    pub content: String,
    pub updated_at: f64,
    pub created_at: f64,
}

/// 畫布需要的全部資料。`notes` 的值為 null 表示筆記資料已遺失。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardState {
    pub placed_notes: Vec<PlacedNote>,
    pub notes: HashMap<String, Option<Note>>,
    pub arrows: Vec<Arrow>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    pub whiteboards: Vec<Whiteboard>,
    pub active_whiteboard_id: String,
    pub root_whiteboard_id: String,
    /// 從 Root 到目前白板的路徑。
    pub path: Vec<Whiteboard>,
}

/// `created` 為 false 表示卡片已經在這個白板上，`placed_id` 是原本那一處。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacedCard {
    pub placed_id: String,
    pub created: bool,
    pub board: BoardState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedNote {
    pub placed_id: String,
    pub board: BoardState,
}

/// 一次匯入的結果。`failed` 是沒有匯入的檔案與原因，要讓使用者知道。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFiles {
    pub placed_ids: Vec<String>,
    pub failed: Vec<String>,
    pub board: BoardState,
}

/// 心智圖的一個節點。清單依深度優先排好，`parent_id` 一定指向清單裡的節點。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MindNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub text: String,
    pub collapsed: bool,
    /// 第一層分支在根節點的哪一側（`left`、`right`）。直向版面時對應上、下。
    pub side: Option<String>,
    /// 沒有值時沿用父節點的顏色。第一層一定有值。
    pub color: Option<String>,
    pub shape: Option<String>,
    /// 整張圖的方向，只在根節點上。
    pub orientation: Option<String>,
    /// 整張圖的線條，只在根節點上。
    pub line_style: Option<String>,
}

/// 新增節點的結果。
#[derive(Debug, Clone, Serialize)]
pub struct MindEdit {
    pub id: String,
    pub nodes: Vec<MindNode>,
}

/// 影片解碼後才知道的資料。
#[derive(Debug, Clone, PartialEq)]
pub struct VideoInfo {
    pub width: f64,
    pub height: f64,
    pub duration: f64,
    pub poster: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedWhiteboard {
    pub placed_id: String,
    pub board: BoardState,
    pub workspace: WorkspaceState,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedWhiteboard {
    pub board: BoardState,
    pub workspace: WorkspaceState,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewState {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

/// 試算表上的一段範圍。記著當初選到的所有列與欄，只有部分被刪除時還能找回範圍。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellRange {
    pub note_id: String,
    pub table_id: String,
    pub rows: Vec<String>,
    pub cols: Vec<String>,
}

/// Writer 的一個區塊。`text` 是行內 Markdown。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterBlock {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub indent: u32,
    pub checked: bool,
    pub collapsed: bool,
    pub language: Option<String>,
    /// `chart`、`image` 區塊指向的筆記。
    pub note_id: Option<String>,
    /// `cells` 區塊引入的範圍。
    pub source: Option<CellRange>,
    /// `table` 區塊的內容，每格是行內 Markdown。
    pub table: Option<Vec<Vec<String>>>,
    /// 同一組並排的區塊共用這個 id。
    pub group: Option<String>,
    /// 在 `group` 裡的第幾欄，0 是左邊。
    pub column: u32,
    /// `center`、`right`、`justify`，沒有就是靠左。
    pub align: Option<String>,
    /// 圖片佔可用寬度的百分比，沒有就是原本大小。
    pub width: Option<f64>,
}

/// Writer 的版面。`size` 是紙張名稱，`margin` 是邊距名稱，實際尺寸由畫面換算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriterPage {
    pub size: String,
    pub landscape: bool,
    pub margin: String,
    pub header: WriterBand,
    pub footer: WriterBand,
    pub number: PageNumber,
    /// 第一頁不顯示頁首、頁尾和頁碼，封面用。
    pub skip_first: bool,
}

/// 頁首或頁尾的三格純文字，每一頁都一樣。
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct WriterBand {
    pub left: String,
    pub center: String,
    pub right: String,
}

/// 頁碼放在哪、怎麼顯示。數字由畫面依分頁結果產生，不儲存。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageNumber {
    pub place: String,
    pub align: String,
    pub format: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WriterFocus {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WriterEdit {
    pub blocks: Vec<WriterBlock>,
    /// 改動後游標該去的區塊。
    pub focus: Option<WriterFocus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BlockSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum WriterOp {
    AddBlock {
        after: Option<String>,
        kind: String,
        text: Option<String>,
        indent: Option<u32>,
        target: Option<String>,
        source: Option<CellRange>,
        language: Option<String>,
        table: Option<Vec<Vec<String>>>,
        /// 接在分欄後面時留在分欄外，否則新區塊會加入 `after` 那一欄。
        #[serde(default)]
        leave_columns: bool,
    },
    SetText { id: String, text: String },
    /// `typing` 是連續打字，復原時併成一步。
    SetTable {
        id: String,
        rows: Vec<Vec<String>>,
        #[serde(default)]
        typing: bool,
    },
    /// 取消分欄，整組變回上下排列。
    Uncolumn { id: String },
    Patch {
        id: String,
        kind: Option<String>,
        indent: Option<u32>,
        checked: Option<bool>,
        collapsed: Option<bool>,
        language: Option<String>,
        /// 空字串是回到靠左。
        align: Option<String>,
        width: Option<f64>,
    },
    Split { id: String, before: String, after: String },
    Merge { id: String },
    Delete { ids: Vec<String> },
    Duplicate { id: String },
    /// 拖到 `target` 的左邊或右邊：開一個新欄，`target` 還沒分欄時就成為新的一組。
    MoveBeside { ids: Vec<String>, target: String, side: BlockSide },
    /// `group` 是搬進哪一組分欄，沒有就是搬到分欄外。
    Move {
        ids: Vec<String>,
        before: Option<String>,
        indent: Option<u32>,
        group: Option<String>,
        column: Option<u32>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetTab {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetAxis {
    pub id: String,
    pub size: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CellView {
    /// 編輯時顯示的內容；公式是當下的座標。
    pub raw: String,
    pub display: String,
    /// `empty`、`number`、`text`、`bool`、`error`。
    pub kind: String,
    pub number: Option<f64>,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub align: Option<String>,
    pub valign: Option<String>,
    pub fill: Option<String>,
    pub color: Option<String>,
    pub format: Option<String>,
}

/// 一塊合併的格子，用當下的列欄索引表示。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CellMerge {
    pub top: usize,
    pub left: usize,
    pub rows: usize,
    pub cols: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetTable {
    pub id: String,
    pub tab_id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub header_rows: usize,
    pub header_cols: usize,
    pub footer_rows: usize,
    pub rows: Vec<SheetAxis>,
    pub cols: Vec<SheetAxis>,
    /// 鍵是 `列id:欄id`，沒有內容也沒有樣式的格子不在裡面。
    pub cells: HashMap<String, CellView>,
    pub merges: Vec<CellMerge>,
    /// 是否顯示欄標題上的篩選按鈕。
    pub filter_on: bool,
    /// 鍵是欄 id，值是要留下的內容。
    pub filters: HashMap<String, Vec<String>>,
    /// 被篩選掉的列。只是不顯示，資料還在。
    pub hidden_rows: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetObject {
    pub id: String,
    pub tab_id: String,
    pub note_id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetState {
    pub tabs: Vec<SheetTab>,
    pub tables: Vec<SheetTable>,
    pub objects: Vec<SheetObject>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CellInput {
    pub row: String,
    pub col: String,
    pub raw: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct StylePatch {
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub align: Option<String>,
    pub valign: Option<String>,
    pub fill: Option<String>,
    pub color: Option<String>,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SheetOp {
    AddTab,
    RenameTab { id: String, name: String },
    DeleteTab { id: String },
    AddTable { tab_id: String, x: f64, y: f64 },
    PatchTable {
        id: String,
        name: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        header_rows: Option<usize>,
        header_cols: Option<usize>,
        footer_rows: Option<usize>,
        /// 關掉時所有欄的篩選一起清除。
        filter: Option<bool>,
    },
    DeleteTable { id: String },
    InsertRows { table_id: String, after: Option<String>, before: Option<String>, count: usize },
    InsertCols { table_id: String, after: Option<String>, before: Option<String>, count: usize },
    DeleteRows { table_id: String, ids: Vec<String> },
    DeleteCols { table_id: String, ids: Vec<String> },
    SetRowHeight { id: String, size: f64 },
    SetColWidth { id: String, size: f64 },
    SetCells { cells: Vec<CellInput> },
    Paste { table_id: String, row: String, col: String, values: Vec<Vec<String>> },
    Clear { rows: Vec<String>, cols: Vec<String> },
    SetStyle { rows: Vec<String>, cols: Vec<String>, style: StylePatch },
    Sort { table_id: String, col_id: String, descending: bool },
    /// 只留下第一個有內容的格子。
    MergeCells { table_id: String, rows: Vec<String>, cols: Vec<String> },
    /// 解除和這些格子重疊的合併。
    UnmergeCells { table_id: String, rows: Vec<String>, cols: Vec<String> },
    /// `values` 是要留下的內容，None 是清除這一欄的篩選。
    SetFilter { table_id: String, col_id: String, values: Option<Vec<String>> },
    /// 把來源的格子填到目標。`series` 會推算下一個值，否則只照抄並移動公式的參照。
    Fill {
        table_id: String,
        source_rows: Vec<String>,
        source_cols: Vec<String>,
        target_rows: Vec<String>,
        target_cols: Vec<String>,
        series: bool,
    },
    MoveObject { id: String, x: f64, y: f64, w: f64, h: f64 },
    RemoveObject { id: String },
}

/// Excels 裡的一個表格，Library 用來列出與放到白板。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetTableInfo {
    pub id: String,
    pub name: String,
    pub rows: usize,
    pub cols: usize,
}

/// 收在一份 Excels 裡的東西。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SheetContents {
    pub tables: Vec<SheetTableInfo>,
    pub charts: Vec<Note>,
}

/// Office Library 的全部內容。`notes` 是最上層，`sheets` 的鍵是 Excels 的 id。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OfficeDocuments {
    pub notes: Vec<Note>,
    pub sheets: HashMap<String, SheetContents>,
}

/// 引入內容與圖表讀到的資料。來源不見時 `error` 說明原因，`rows` 是空的。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeView {
    pub title: String,
    pub table_name: String,
    pub header_rows: usize,
    pub header_cols: usize,
    pub col_sizes: Vec<f64>,
    /// `rows` 每一列與每一欄的 id，在別處編輯時才知道要寫回哪一格。
    pub row_ids: Vec<String>,
    pub col_ids: Vec<String>,
    pub rows: Vec<Vec<CellView>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChartSeries {
    pub name: String,
    pub values: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartData {
    pub kind: String,
    pub title: String,
    /// 每個數列是一欄（`cols`）還是一列（`rows`）。
    pub series_by: String,
    pub labels: Vec<String>,
    pub series: Vec<ChartSeries>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreatedChart {
    pub note: Note,
    pub sheet: SheetState,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlideElement {
    pub id: String,
    pub slide_id: String,
    /// `text`、`shape`、`image`、`cells`、`chart`。
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub text: String,
    /// 文字框還空著時顯示的提示，放映時不顯示。
    pub placeholder: Option<String>,
    pub shape: Option<String>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub color: Option<String>,
    pub font_size: f64,
    pub bold: bool,
    pub italic: bool,
    pub align: Option<String>,
    pub valign: Option<String>,
    pub bullets: bool,
    pub note_id: Option<String>,
    pub source: Option<CellRange>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Slide {
    pub id: String,
    pub background: String,
    pub notes: String,
    pub elements: Vec<SlideElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlidesState {
    pub slides: Vec<Slide>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlidesEdit {
    pub state: SlidesState,
    /// 新建立的投影片或物件。
    pub created: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementPatch {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
    pub text: Option<String>,
    pub shape: Option<String>,
    pub fill: Option<String>,
    pub stroke: Option<String>,
    pub color: Option<String>,
    pub font_size: Option<f64>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub align: Option<String>,
    pub valign: Option<String>,
    pub bullets: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SlidesOp {
    AddSlide { after: Option<String>, layout: String },
    DeleteSlide { id: String },
    DuplicateSlide { id: String },
    MoveSlide { id: String, before: Option<String> },
    PatchSlide { id: String, background: Option<String>, notes: Option<String>, all: Option<bool> },
    AddElement {
        slide_id: String,
        kind: String,
        shape: Option<String>,
        target: Option<String>,
        source: Option<CellRange>,
    },
    PatchElement { id: String, patch: ElementPatch },
    MoveElements { moves: Vec<NoteMove> },
    DeleteElements { ids: Vec<String> },
    DuplicateElements { ids: Vec<String> },
    OrderElement { id: String, front: bool },
}
