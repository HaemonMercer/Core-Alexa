export type NoteType = "card" | "sheet" | "mindmap" | "mermaid" | "image" | "video" | "drawio" | "code" | "writer" | "slides" | "chart";

export type Arrangement =
    | "alignLeft"
    | "alignCenterX"
    | "alignRight"
    | "alignTop"
    | "alignCenterY"
    | "alignBottom"
    | "distributeX"
    | "distributeY"
    | "grid";

/** 箭頭畫在哪一端，線本身永遠從 from 到 to。 */
export type ArrowDirection = "forward" | "backward" | "both" | "none";

export interface Whiteboard {
    id: string;
    name: string;
    createdAt: number;
    parentId: string | null;
}

export interface WorkspaceState {
    whiteboards: Whiteboard[];
    activeWhiteboardId: string;
    rootWhiteboardId: string;
    /** 從 Root 到目前白板。 */
    path: Whiteboard[];
}

export interface RenamedWhiteboard {
    board: BoardState;
    workspace: WorkspaceState;
}

/** `created` 為 false 表示卡片已經在這個白板上，`placedId` 是原本那一處。 */
export interface PlacedCard {
    placedId: string;
    created: boolean;
    board: BoardState;
}

export interface CreatedWhiteboard {
    placedId: string;
    board: BoardState;
    workspace: WorkspaceState;
}

export interface Size {
    w: number;
    h: number;
}

export interface PlacedNoteStyle {
    color?: string;
}

export interface PlacedNote {
    id: string;
    whiteboardID: string;
    noteID: string;
    x: number;
    y: number;
    w: number;
    h: number;
    zKey: string;
    style: PlacedNoteStyle;
    /** 卡片高度是否跟著內容。 */
    autoFit: boolean;
    collapsed: boolean;
    /** 試算表顯示的表格；null 表示第一個。 */
    tableID: string | null;
    /** 由 Rust 決定，拖曳預覽時用同一個限制。 */
    minSize: Size;
}

export interface Note {
    id: string;
    type: string;
    context: Record<string, unknown>;
    content: string;
    updatedAt: number;
    createdAt: number;
    /** 依名稱排序。 */
    tags: NoteTag[];
}

/** 貼在筆記上的 Tag。 */
export interface NoteTag {
    id: string;
    name: string;
    color: string;
}

/** Tag 目錄的一筆，`count` 是用到它的筆記數。 */
export interface TagInfo extends NoteTag {
    count: number;
}

export interface NoteFit {
    id: string;
    h: number;
}

export interface NoteMove {
    id: string;
    x: number;
    y: number;
}

export interface Arrow {
    id: string;
    fromPlacedID: string;
    toPlacedID: string;
    direction: ArrowDirection;
    label: string;
}

export type MindSide = "left" | "right";
export type MindShape = "none" | "pill" | "rounded" | "rect";
export type MindOrientation = "horizontal" | "vertical";
export type MindLineStyle = "curved" | "elbow";

/** 心智圖的一個節點。清單由 Rust 依深度優先排好。 */
export interface MindNode {
    id: string;
    parentId: string | null;
    text: string;
    collapsed: boolean;
    /** 第一層分支在根節點的哪一側，直向版面時 left 在上、right 在下。 */
    side: MindSide | null;
    /** 沒有值時沿用父節點的顏色。 */
    color: string | null;
    shape: MindShape | null;
    /** 整張圖的方向，只在根節點上。 */
    orientation: MindOrientation | null;
    /** 整張圖的線條，只在根節點上。 */
    lineStyle: MindLineStyle | null;
}

export interface ImportedFiles {
    placedIds: string[];
    /** 沒有匯入的檔案與原因。 */
    failed: string[];
    board: BoardState;
}

export interface BoardState {
    placedNotes: PlacedNote[];
    /** 值為 null 表示筆記資料已遺失。 */
    notes: Record<string, Note | null>;
    arrows: Arrow[];
}

/** ER 模型的 Note References，由 Rust 從內文與白板推導。 */
export interface NoteLink {
    id: string;
    fromID: string;
    toID: string;
    source: "mention" | "arrow";
    label: string;
    whiteboardName: string | null;
    /** 另一端的筆記。 */
    note: Note;
}

/** 連結卡片時的一個候選。 */
export interface CardMatch {
    note: Note;
    /** 卡片所在的白板名稱，內容相同或空白時靠它分辨。 */
    whiteboards: string[];
}

/** 刪除筆記前要讓使用者知道的影響。 */
export interface NoteDeletion {
    whiteboards: string[];
    /** 內文連到這些筆記的其他卡片數。 */
    linkedCards: number;
}

/** 刪除白板前要讓使用者知道的影響。 */
export interface WhiteboardDeletion {
    childWhiteboards: number;
    /** 放在這些白板上的筆記數；筆記本身不會被刪除。 */
    notes: number;
}

export interface NoteLinks {
    outgoing: NoteLink[];
    incoming: NoteLink[];
}

export interface ViewState {
    x: number;
    y: number;
    scale: number;
}

export interface SheetTableInfo {
    id: string;
    name: string;
    rows: number;
    cols: number;
}

/** 收在一份 Excels 裡的東西，由 Rust 依圖表的來源推導。 */
export interface SheetContents {
    tables: SheetTableInfo[];
    charts: Note[];
}

export interface OfficeDocuments {
    /** 最上層的內容；有來源 Excels 的圖表不在這裡。 */
    notes: Note[];
    /** 鍵是 Excels 的 id。 */
    sheets: Record<string, SheetContents>;
}

/** 試算表上的一段範圍。記著所有列與欄的 id，增刪列欄後仍然找得到。 */
export interface CellRange {
    noteId: string;
    tableId: string;
    rows: string[];
    cols: string[];
}

export interface WriterBlock {
    id: string;
    kind: string;
    /** 行內 Markdown，程式碼區塊是純文字。 */
    text: string;
    indent: number;
    checked: boolean;
    collapsed: boolean;
    language: string | null;
    noteId: string | null;
    source: CellRange | null;
    /** `table` 區塊的內容，每格是行內 Markdown。 */
    table: string[][] | null;
    /** 同一組並排的區塊共用這個 id。 */
    group: string | null;
    /** 在 `group` 裡的第幾欄，0 是左邊。 */
    column: number;
    /** `center`、`right`、`justify`，沒有就是靠左。 */
    align: string | null;
    /** 圖片佔可用寬度的百分比，沒有就是原本大小。 */
    width: number | null;
}

/** Writer 的版面。尺寸由 `writer/pageFormat.ts` 換算。 */
export interface WriterPage {
    size: string;
    landscape: boolean;
    margin: string;
    header: WriterBand;
    footer: WriterBand;
    number: PageNumber;
    /** 第一頁不顯示頁首、頁尾和頁碼。 */
    skipFirst: boolean;
}

export type BandSlot = "left" | "center" | "right";

/** 頁首或頁尾的三格純文字，每一頁都一樣。 */
export type WriterBand = Record<BandSlot, string>;

/** 頁碼放在哪、怎麼顯示。數字由 `writer/pageFormat.ts` 依分頁結果產生。 */
export interface PageNumber {
    place: "none" | "header" | "footer";
    align: BandSlot;
    format: "plain" | "chinese" | "fraction" | "chineseTotal";
}

export interface WriterEdit {
    blocks: WriterBlock[];
    focus: { id: string } | null;
}

export type BlockSide = "left" | "right";

export type WriterOp =
    | { op: "addBlock"; after?: string | null; kind: string; text?: string; indent?: number; target?: string; source?: CellRange; language?: string; table?: string[][]; leaveColumns?: boolean }
    | { op: "setText"; id: string; text: string }
    | { op: "setTable"; id: string; rows: string[][]; typing?: boolean }
    | { op: "moveBeside"; ids: string[]; target: string; side: BlockSide }
    | { op: "uncolumn"; id: string }
    | { op: "patch"; id: string; kind?: string; indent?: number; checked?: boolean; collapsed?: boolean; language?: string; align?: string; width?: number }
    | { op: "split"; id: string; before: string; after: string }
    | { op: "merge"; id: string }
    | { op: "delete"; ids: string[] }
    | { op: "duplicate"; id: string }
    | { op: "move"; ids: string[]; before: string | null; indent?: number; group?: string | null; column?: number };

export interface SheetAxis {
    id: string;
    size: number;
}

export interface CellView {
    raw: string;
    display: string;
    kind: "empty" | "number" | "text" | "bool" | "error";
    number: number | null;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    align: string | null;
    valign: string | null;
    fill: string | null;
    color: string | null;
    format: string | null;
}

export interface SheetTable {
    id: string;
    tabId: string;
    name: string;
    x: number;
    y: number;
    headerRows: number;
    headerCols: number;
    footerRows: number;
    rows: SheetAxis[];
    cols: SheetAxis[];
    /** 鍵是 `列id:欄id`。 */
    cells: Record<string, CellView>;
    merges: CellMerge[];
    filterOn: boolean;
    /** 鍵是欄 id，值是要留下的內容。 */
    filters: Record<string, string[]>;
    /** 被篩選掉的列，資料還在。 */
    hiddenRows: string[];
}

/** 一塊合併的格子，用當下的列欄索引表示。 */
export interface CellMerge {
    top: number;
    left: number;
    rows: number;
    cols: number;
}

export interface SheetObject {
    id: string;
    tabId: string;
    noteId: string;
    /** 圖表或放上來的卡片。 */
    noteType: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface SheetState {
    tabs: { id: string; name: string }[];
    tables: SheetTable[];
    objects: SheetObject[];
}

export interface CellInput {
    row: string;
    col: string;
    raw: string;
}

export interface StylePatch {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    align?: string;
    valign?: string;
    fill?: string;
    color?: string;
    format?: string;
}

export type SheetOp =
    | { op: "addTab" }
    | { op: "renameTab"; id: string; name: string }
    | { op: "deleteTab"; id: string }
    | { op: "addTable"; tabId: string; x: number; y: number }
    | { op: "patchTable"; id: string; name?: string; x?: number; y?: number; headerRows?: number; headerCols?: number; footerRows?: number; filter?: boolean }
    | { op: "deleteTable"; id: string }
    | { op: "insertRows"; tableId: string; after?: string; before?: string; count: number }
    | { op: "insertCols"; tableId: string; after?: string; before?: string; count: number }
    | { op: "deleteRows"; tableId: string; ids: string[] }
    | { op: "deleteCols"; tableId: string; ids: string[] }
    | { op: "setRowHeight"; id: string; size: number }
    | { op: "setColWidth"; id: string; size: number }
    | { op: "setCells"; cells: { row: string; col: string; raw: string }[] }
    | { op: "paste"; tableId: string; row: string; col: string; values: string[][] }
    | { op: "clear"; rows: string[]; cols: string[] }
    | { op: "setStyle"; rows: string[]; cols: string[]; style: StylePatch }
    | { op: "sort"; tableId: string; colId: string; descending: boolean }
    | { op: "mergeCells"; tableId: string; rows: string[]; cols: string[] }
    | { op: "unmergeCells"; tableId: string; rows: string[]; cols: string[] }
    | { op: "setFilter"; tableId: string; colId: string; values: string[] | null }
    | { op: "fill"; tableId: string; sourceRows: string[]; sourceCols: string[]; targetRows: string[]; targetCols: string[]; series: boolean }
    | { op: "placeCard"; tabId: string; target: string; x: number; y: number }
    | { op: "moveObject"; id: string; x: number; y: number; w: number; h: number }
    | { op: "removeObject"; id: string };

/** 來源不見時 `error` 說明原因，`rows` 是空的。 */
export interface RangeView {
    title: string;
    tableName: string;
    headerRows: number;
    headerCols: number;
    colSizes: number[];
    rowIds: string[];
    colIds: string[];
    rows: CellView[][];
    error: string | null;
}

export interface ChartSeries {
    name: string;
    values: (number | null)[];
}

export interface ChartData {
    kind: string;
    title: string;
    seriesBy: string;
    labels: string[];
    series: ChartSeries[];
    error: string | null;
}

export interface CreatedChart {
    note: Note;
    sheet: SheetState;
}

export interface SlideElement {
    id: string;
    slideId: string;
    kind: string;
    x: number;
    y: number;
    w: number;
    h: number;
    text: string;
    placeholder: string | null;
    shape: string | null;
    fill: string | null;
    stroke: string | null;
    color: string | null;
    fontSize: number;
    bold: boolean;
    italic: boolean;
    align: string | null;
    valign: string | null;
    bullets: boolean;
    noteId: string | null;
    source: CellRange | null;
}

export interface Slide {
    id: string;
    background: string;
    notes: string;
    elements: SlideElement[];
}

export interface SlidesState {
    slides: Slide[];
}

export interface SlidesEdit {
    state: SlidesState;
    created: string | null;
}

export interface ElementPatch {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    text?: string;
    shape?: string;
    fill?: string;
    stroke?: string;
    color?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    align?: string;
    valign?: string;
    bullets?: boolean;
}

export type SlidesOp =
    | { op: "addSlide"; after: string | null; layout: string }
    | { op: "deleteSlide"; id: string }
    | { op: "duplicateSlide"; id: string }
    | { op: "moveSlide"; id: string; before: string | null }
    | { op: "patchSlide"; id: string; background?: string; notes?: string; all?: boolean }
    | { op: "addElement"; slideId: string; kind: string; shape?: string; target?: string; source?: CellRange; x?: number; y?: number }
    | { op: "patchElement"; id: string; patch: ElementPatch }
    | { op: "moveElements"; moves: NoteMove[] }
    | { op: "deleteElements"; ids: string[] }
    | { op: "duplicateElements"; ids: string[] }
    | { op: "orderElement"; id: string; front: boolean };
