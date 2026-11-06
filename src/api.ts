import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
    Arrangement,
    ArrowDirection,
    BoardState,
    NoteDeletion,
    CardMatch,
    CellRange,
    ChartData,
    CreatedChart,
    CreatedWhiteboard,
    ImportedFiles,
    MindNode,
    MindSide,
    Note,
    NoteFit,
    NoteLinks,
    NoteMove,
    NoteTag,
    NoteType,
    OfficeDocuments,
    PlacedCard,
    RangeView,
    RenamedWhiteboard,
    SheetOp,
    SheetState,
    SlidesEdit,
    SlidesOp,
    SlidesState,
    TagInfo,
    ViewState,
    WhiteboardDeletion,
    WorkspaceState,
    WriterBlock,
    WriterEdit,
    WriterOp,
    WriterPage,
} from "./types.ts";

// 所有資料操作都由 Rust 處理，這裡只負責呼叫命令。
// 依序送出，連續輸入時舊內容才不會蓋過新內容。
let queue: Promise<unknown> = Promise.resolve();

function send<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const result = queue.then(() => invoke<T>(command, args));
    queue = result.catch(() => undefined);
    return result;
}

export const getWorkspace = () => send<WorkspaceState>("get_workspace");

export const createWhiteboard = (parentId: string, centerX: number, centerY: number) =>
    send<CreatedWhiteboard>("create_whiteboard", { parentId, centerX, centerY });

export const renameWhiteboard = (id: string, name: string) =>
    send<RenamedWhiteboard>("rename_whiteboard", { id, name });

export const selectWhiteboard = (id: string) =>
    send<WorkspaceState>("select_whiteboard", { id });

export const getNote = (id: string) => send<Note | null>("get_note", { id });

export const getNoteLibrary = () => send<Note[]>("get_note_library");

export const getCardNotes = () => send<Note[]>("get_card_notes");

export const getOfficeDocuments = () => send<OfficeDocuments>("get_office_documents");

export const searchCards = (query: string, excludeId: string) =>
    send<CardMatch[]>("search_cards", { query, excludeId });

export const createCard = (content: string) => send<Note>("create_card", { content });

export const getNoteDeletion = (ids: string[]) => send<NoteDeletion>("get_note_deletion", { ids });

export const deleteNotes = (ids: string[]) => send<void>("delete_notes", { ids });

export const getWhiteboardDeletion = (ids: string[]) =>
    send<WhiteboardDeletion>("get_whiteboard_deletion", { ids });

export const deleteWhiteboards = (ids: string[]) =>
    send<WorkspaceState>("delete_whiteboards", { ids });

export const getTags = () => send<TagInfo[]>("get_tags");

export const addNoteTag = (noteId: string, name: string) =>
    send<NoteTag>("add_note_tag", { noteId, name });

export const removeNoteTag = (noteId: string, tagId: string) =>
    send<void>("remove_note_tag", { noteId, tagId });

export const renameTag = (id: string, name: string) => send<void>("rename_tag", { id, name });

export const setTagColor = (id: string, color: string) => send<void>("set_tag_color", { id, color });

export const deleteTag = (id: string) => send<void>("delete_tag", { id });

export const getNoteLinks = (id: string) => send<NoteLinks>("get_note_links", { id });

export const getBoard = (whiteboardId: string) =>
    send<BoardState>("get_board", { whiteboardId });

/** 內容直接以二進位傳送，不轉成 JSON；其餘參數放在標頭。 */
async function sendBytes<T>(command: string, blob: Blob, headers: Record<string, string>) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const result = queue.then(() => invoke<T>(command, bytes, { headers }));
    queue = result.catch(() => undefined);
    return result;
}

/**
 * 拖進來或用檔案對話框選的檔案，只傳路徑。
 * 影片可能很大，要複製很久，所以不排進佇列，複製期間仍然可以編輯。
 */
export const importMediaFiles = (whiteboardId: string, paths: string[], centerX: number, centerY: number) =>
    invoke<ImportedFiles>("import_media_files", { whiteboardId, paths, centerX, centerY });

export const importImageBytes = (whiteboardId: string, file: File, centerX: number, centerY: number) =>
    sendBytes<ImportedFiles>("import_image_bytes", file, {
        "x-whiteboard": whiteboardId,
        "x-center-x": String(centerX),
        "x-center-y": String(centerY),
        "x-name": encodeURIComponent(file.name),
    });

export const saveDrawioXml = (noteId: string, xml: string) =>
    send<void>("save_drawio_xml", { noteId, xml });

export const saveDrawioPreview = (noteId: string, preview: Blob) =>
    sendBytes<void>("save_drawio_preview", preview, { "x-note": noteId });

export const saveVideoInfo = (
    whiteboardId: string,
    noteId: string,
    { width, height, duration }: { width: number; height: number; duration: number },
    poster: Blob,
) =>
    sendBytes<BoardState>("save_video_info", poster, {
        "x-whiteboard": whiteboardId,
        "x-note": noteId,
        "x-width": String(width),
        "x-height": String(height),
        "x-duration": String(duration),
    });

export const getMindmap = (noteId: string) => send<MindNode[]>("get_mindmap", { noteId });

export const addMindNode = (noteId: string, parentId: string, after: string | null, side: MindSide | null) =>
    send<{ id: string; nodes: MindNode[] }>("add_mind_node", { noteId, parentId, after, side });

export const duplicateMindNode = (noteId: string, nodeId: string, parentId: string, after: string | null) =>
    send<{ id: string; nodes: MindNode[] }>("duplicate_mind_node", { noteId, nodeId, parentId, after });

export const setMindStyle = (noteId: string, nodeId: string, key: string, value: string) =>
    send<MindNode[]>("set_mind_style", { noteId, nodeId, key, value });

export const randomizeMindColors = (noteId: string) => send<MindNode[]>("randomize_mind_colors", { noteId });

export const renameMindNode = (noteId: string, nodeId: string, text: string) =>
    send<MindNode[]>("rename_mind_node", { noteId, nodeId, text });

export const setMindCollapsed = (noteId: string, nodeId: string, collapsed: boolean) =>
    send<MindNode[]>("set_mind_collapsed", { noteId, nodeId, collapsed });

export const deleteMindNode = (noteId: string, nodeId: string) =>
    send<MindNode[]>("delete_mind_node", { noteId, nodeId });

export const moveMindNode = (
    noteId: string,
    nodeId: string,
    parentId: string,
    before: string | null,
    side: MindSide | null,
) => send<MindNode[]>("move_mind_node", { noteId, nodeId, parentId, before, side });

export const createNote = (
    whiteboardId: string,
    noteType: NoteType,
    centerX: number,
    centerY: number,
) =>
    send<{ placedId: string; board: BoardState }>("create_note", {
        whiteboardId,
        noteType,
        centerX,
        centerY,
    });

export const placeNote = (
    whiteboardId: string,
    noteId: string,
    centerX: number,
    centerY: number,
) => send<PlacedCard>("place_note", { whiteboardId, noteId, centerX, centerY });

export const placeTable = (
    whiteboardId: string,
    noteId: string,
    tableId: string,
    centerX: number,
    centerY: number,
) => send<PlacedCard>("place_table", { whiteboardId, noteId, tableId, centerX, centerY });

export const setPlacedTable = (whiteboardId: string, placedId: string, tableId: string) =>
    send<BoardState>("set_placed_table", { whiteboardId, placedId, tableId });

export const moveNotes = (whiteboardId: string, moves: NoteMove[]) =>
    send<BoardState>("move_notes", { whiteboardId, moves });

export const raiseNotes = (whiteboardId: string, placedIds: string[]) =>
    send<BoardState>("raise_notes", { whiteboardId, placedIds });

export const arrangeNotes = (whiteboardId: string, placedIds: string[], arrangement: Arrangement) =>
    send<BoardState>("arrange_notes", { whiteboardId, placedIds, arrangement });

export const resizeNote = (
    whiteboardId: string,
    placedId: string,
    rect: { x: number; y: number; w: number; h: number },
) => send<BoardState>("resize_note", { whiteboardId, placedId, ...rect });

export const fitNotes = (whiteboardId: string, fits: NoteFit[]) =>
    send<void>("fit_notes", { whiteboardId, fits });

export const setAutoFit = (whiteboardId: string, placedId: string, autoFit: boolean) =>
    send<BoardState>("set_auto_fit", { whiteboardId, placedId, autoFit });

export const setCollapsed = (whiteboardId: string, placedId: string, collapsed: boolean, collapsedH: number) =>
    send<BoardState>("set_collapsed", { whiteboardId, placedId, collapsed, collapsedH });

export const removeNote = (whiteboardId: string, placedId: string) =>
    send<BoardState>("remove_note", { whiteboardId, placedId });

export const createArrow = (whiteboardId: string, fromPlacedId: string, toPlacedId: string) =>
    send<BoardState>("create_arrow", { whiteboardId, fromPlacedId, toPlacedId });

export const updateArrow = (
    whiteboardId: string,
    id: string,
    changes: { direction?: ArrowDirection; label?: string },
) => send<BoardState>("update_arrow", { whiteboardId, id, ...changes });

export const removeArrow = (whiteboardId: string, id: string) =>
    send<BoardState>("remove_arrow", { whiteboardId, id });

export const updateNoteContent = (noteId: string, content: string) =>
    send<void>("update_note_content", { noteId, content });

export const setCodeLanguage = (noteId: string, language: string) =>
    send<void>("set_code_language", { noteId, language });

export const getView = (whiteboardId: string) =>
    send<ViewState | null>("get_view", { whiteboardId });

export const saveView = (whiteboardId: string, view: ViewState) =>
    send<void>("save_view", { whiteboardId, view });

export const createDocument = (noteType: NoteType) => send<Note>("create_document", { noteType });

export const renameNote = (noteId: string, name: string) => send<void>("rename_note", { noteId, name });

export const undoNote = (noteId: string) => send<boolean>("undo_note", { noteId });

export const redoNote = (noteId: string) => send<boolean>("redo_note", { noteId });

export const getWriter = (noteId: string) => send<WriterBlock[]>("get_writer", { noteId });

export const getWriterPage = (noteId: string) => send<WriterPage>("get_writer_page", { noteId });

export const setWriterPage = (noteId: string, page: WriterPage, typing = false) =>
    send<WriterPage>("set_writer_page", { noteId, page, typing });

/** 貼進 Writer 的圖片，只建立筆記，不放到白板上。 */
export const importWriterImage = (file: File) =>
    sendBytes<Note>("import_writer_image", file, { "x-name": encodeURIComponent(file.name) });

export const editWriter = (noteId: string, op: WriterOp) => send<WriterEdit>("edit_writer", { noteId, op });

export const getSheet = (noteId: string) => send<SheetState>("get_sheet", { noteId });

export const editSheet = (noteId: string, op: SheetOp) => send<SheetState>("edit_sheet", { noteId, op });

export const getCellRange = (source: CellRange) => send<RangeView>("get_cell_range", { source });

export const createChart = (source: CellRange, tabId: string, kind: string) =>
    send<CreatedChart>("create_chart", { source, tabId, kind });

export const getChart = (noteId: string) => send<ChartData>("get_chart", { noteId });

export const setChart = (noteId: string, kind?: string, seriesBy?: string) =>
    send<ChartData>("set_chart", { noteId, kind, seriesBy });

export const getSlides = (noteId: string) => send<SlidesState>("get_slides", { noteId });

export const editSlides = (noteId: string, op: SlidesOp) => send<SlidesEdit>("edit_slides", { noteId, op });

export const openLink = (href: string) => openUrl(href);
