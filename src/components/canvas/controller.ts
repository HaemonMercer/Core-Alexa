import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as api from "../../api.ts";
import { noteTitle } from "../../noteTypes.ts";
import type {
    Arrangement,
    Arrow,
    ArrowDirection,
    BoardState,
    Note,
    NoteFit,
    PlacedNote,
    WorkspaceState,
} from "../../types.ts";
import {
    hitConnector,
    hitsSegment,
    midpoint,
    nearConnectors,
    type Point,
} from "./arrow.ts";
import {
    arrowSegments,
    marqueeRect,
    noteAt,
    previewNotes,
    TILE_TITLE_HEIGHT,
    type DragGesture,
    type LinkGesture,
    type MarqueeGesture,
    type ResizeGesture,
} from "./gestures.ts";
import { CARD_HEADER_HEIGHT, cardHeight, codeHeight, COLLAPSED_CARD_HEIGHT, NOTE_PADDING, onCardImageLoaded } from "./noteRenderer.ts";
import {
    hitResizeHandle,
    resizeCursor,
    keepRatio,
    resizeRect,
    widthOnlyHandle,
    type Rect,
    type ResizeHandle,
} from "./resize.ts";
import type { NoteType } from "../../types.ts";
import { mediaRatio, videoDetails } from "../../media.ts";
import { drawioPreview, imagePreview, videoPreview } from "../media/imagePreview.ts";
import { probeVideo } from "../media/videoProbe.ts";
import { mermaidPreview } from "../mermaid/render.ts";
import { chartPreview, sheetPreview, slidesPreview, writerPreview } from "../office/officePreview.ts";
import { measureText, mindmapPreview } from "../mindmap/draw.ts";
import {
    cardAroundMap,
    layoutMindmap,
    mapInCard,
    nodeAtCardPoint,
    revealShift,
    type MapSize,
} from "../mindmap/layout.ts";
import { NotePreviews, type PreviewRenderer } from "./notePreview.ts";
import { drawScene } from "./scene.ts";
import { boundsOf, findGuides, intersects, NO_SNAP, snapMove, snapResize, type Guide } from "./snap.ts";
import { toScreen, toWorld, visibleWorld, zoomAt, type View } from "./viewport.ts";

// 畫布的狀態與事件都在這裡，一個白板一個實例；React 只負責疊在畫布上的輸入框和選單。

const EMPTY_BOARD: BoardState = { placedNotes: [], notes: {}, arrows: [] };
/** 單擊後要等過雙擊的時間，才分得出是直接編輯、改名，還是雙擊。 */
const DOUBLE_CLICK_MS = 250;
/** 一次匯入多張圖片時依序錯開。 */
const IMPORT_CASCADE = 32;
/** 各類型內容怎麼產生畫布上的圖。還沒有渲染器的類型畫成佔位框。 */
const PREVIEW_RENDERERS: Record<string, PreviewRenderer> = {
    chart: chartPreview,
    drawio: drawioPreview,
    image: imagePreview,
    mermaid: mermaidPreview,
    mindmap: mindmapPreview,
    sheet: sheetPreview,
    slides: slidesPreview,
    video: videoPreview,
    writer: writerPreview,
};
/** 螢幕上移動不到這個距離仍算單擊。 */
export const CLICK_SLOP = 4;
const SAVE_VIEW_DELAY_MS = 300;

export interface Editing {
    noteID: string;
    text: string;
    left: number;
    top: number;
    width: number;
    height: number;
    scale: number;
    /** 高度跟著內容，編輯器要一起長高；否則維持卡片的高度，內容在裡面捲動。 */
    fitContent: boolean;
    /** 和卡片的內文對齊。 */
    paddingTop: number;
}

export interface Renaming {
    whiteboardID: string;
    name: string;
    left: number;
    top: number;
    width: number;
    scale: number;
}

export interface ArrowLabelDraft {
    id: string;
    label: string;
    left: number;
    top: number;
}

/** 選取單張卡片時，疊在卡片裡的按鈕位置（相對畫布）。 */
/** 正在播放的影片在畫面上的位置。寬高是世界座標，跟著 `scale` 一起縮放。 */
export interface VideoAnchor {
    placedID: string;
    file: string;
    left: number;
    top: number;
    width: number;
    height: number;
    scale: number;
}

/** 就地編輯心智圖時，根節點在畫布上的位置。量好心智圖的大小之前 `scale` 是 null。 */
export interface MapEditAnchor {
    noteID: string;
    rootLeft: number;
    rootTop: number;
    scale: number | null;
    /** 打開時選取的節點，null 是根節點。 */
    startNode: string | null;
    /** 打開時直接改這個節點的文字。 */
    startTyping: boolean;
}

interface MapEdit {
    placedID: string;
    noteID: string;
    startNode: string | null;
    startTyping: boolean;
    /** 根節點的世界座標與心智圖的比例，打開時量一次，編輯中不變。 */
    place: { rootX: number; rootY: number; scale: number } | null;
    rect: { x: number; y: number; w: number; h: number } | null;
    savedRect: string;
}

export interface CardAnchor {
    placed: PlacedNote;
    left: number;
    top: number;
    /** 世界座標的寬度，按鈕列跟著 `scale` 一起縮放。 */
    width: number;
    scale: number;
}

export interface MenuAnchor {
    /** 螢幕座標，決定選單的位置。 */
    clientX: number;
    clientY: number;
    /** 世界座標，決定新項目的位置。 */
    x: number;
    y: number;
    /** 按在箭頭上時，選單改成這條箭頭的操作。 */
    arrow?: Arrow;
    /** 按在筆記或白板方塊上時，選單改成它的操作。 */
    placed?: PlacedNote;
}

export interface BoardCallbacks {
    onOpenWhiteboard: (id: string) => void;
    onWorkspaceChange: (workspace: WorkspaceState) => void;
    /** 雙擊卡片：右側面板換成它的內容。 */
    onOpenCard: (noteID: string) => void;
    /** Draw.io 放不進右側面板，直接開全螢幕。 */
    onOpenFullscreen: (noteID: string) => void;
    /** 換到這個白板：右側面板回到 Card Library。 */
    onCloseCard: () => void;
    onCardCreated: () => void;
    /** 箭頭改變時呼叫，卡片的連結清單要重新計算。 */
    onLinksChange: () => void;
    onSelectionCount: (count: number) => void;
    onCardAnchor: (anchor: CardAnchor | null) => void;
    onMapEdit: (anchor: MapEditAnchor | null) => void;
    onVideoAnchor: (anchor: VideoAnchor | null) => void;
    /** 匯入開始與結束時呼叫，`delta` 是 +1 或 -1。 */
    onImporting: (delta: number) => void;
    /** 這個白板上有哪些筆記；一個白板同一張卡片只能放一次，清單要知道哪些不能再放。 */
    onPlacedNotes: (noteIDs: ReadonlySet<string>) => void;
    onEdit: (editing: Editing) => void;
    onRename: (renaming: Renaming) => void;
    onEditArrowLabel: (draft: ArrowLabelDraft) => void;
    onMenu: (anchor: MenuAnchor) => void;
    onError: (error: unknown) => void;
}

// 複製的筆記要能貼到其他白板，所以放在實例之外。
// dx、dy 是相對整組中心的位置，貼上時保留彼此的相對位置。
let copiedNotes: { noteID: string; tableID: string | null; dx: number; dy: number }[] = [];

export class BoardController {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly whiteboardID: string;
    private readonly previews = new NotePreviews(PREVIEW_RENDERERS, () => {
        if (!this.disposed) this.draw();
    });
    private readonly isRoot: boolean;
    private readonly callbacks: BoardCallbacks;
    private readonly observer: ResizeObserver;

    private readonly view: View = { x: 0, y: 0, scale: 1 };
    private board: BoardState = EMPTY_BOARD;
    private selection = new Set<string>();
    private selectedArrow: string | null = null;
    /** 滑鼠所在的筆記，它的四邊會出現連接點。 */
    private hoveredID: string | null = null;
    private guides: Guide[] = [];
    private cardAnchor: CardAnchor | null = null;
    /** 上次回報的筆記；換白板時是新實例，第一次一定會回報。 */
    private reportedNotes: string | null = null;
    private disposed = false;

    private drag: DragGesture | null = null;
    private marquee: MarqueeGesture | null = null;
    private resizing: ResizeGesture | null = null;
    private stopDragDrop: (() => void) | null = null;
    private playingID: string | null = null;
    private videoAnchor: VideoAnchor | null = null;
    private mapEdit: MapEdit | null = null;
    private mapAnchor: MapEditAnchor | null = null;
    private linking: LinkGesture | null = null;
    private panning = false;
    private lastX = 0;
    private lastY = 0;
    private panStartX = 0;
    private panStartY = 0;
    /** 右鍵拖曳過畫布：放開時不開選單。 */
    private panDragged = false;

    private clickTimer: ReturnType<typeof setTimeout> | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        canvas: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        whiteboardID: string,
        isRoot: boolean,
        callbacks: BoardCallbacks,
    ) {
        this.canvas = canvas;
        this.ctx = ctx;
        this.whiteboardID = whiteboardID;
        this.isRoot = isRoot;
        this.callbacks = callbacks;
        onCardImageLoaded(this.draw);

        this.select([]);
        callbacks.onCloseCard();

        this.observer = new ResizeObserver(this.resize);
        this.observer.observe(canvas);

        api.getView(whiteboardID)
            .then((saved) => {
                if (this.disposed || !saved) return;
                Object.assign(this.view, saved);
                this.draw();
            })
            .catch(callbacks.onError);

        canvas.style.cursor = "default";
        canvas.addEventListener("wheel", this.onWheel, { passive: false });
        canvas.addEventListener("pointerdown", this.onPointerDown);
        canvas.addEventListener("pointermove", this.onPointerMove);
        canvas.addEventListener("pointerup", this.onPointerUp);
        canvas.addEventListener("pointercancel", this.onPointerUp);
        canvas.addEventListener("pointerleave", this.onPointerLeave);
        canvas.addEventListener("dblclick", this.onDoubleClick);
        canvas.addEventListener("contextmenu", this.onContextMenu);
        window.addEventListener("keydown", this.onKeyDown);
        window.addEventListener("copy", this.onCopy);
        window.addEventListener("paste", this.onPaste);
        void getCurrentWebview().onDragDropEvent(({ payload }) => {
            if (payload.type !== "drop") return;
            const scale = window.devicePixelRatio;
            this.dropFiles(payload.paths, payload.position.x / scale, payload.position.y / scale);
        }).then((unlisten) => {
            if (this.disposed) unlisten();
            else this.stopDragDrop = unlisten;
        }, this.callbacks.onError);

        api.getBoard(whiteboardID).then(this.applyBoard).catch(callbacks.onError);
    }

    dispose() {
        const { canvas, whiteboardID } = this;
        this.disposed = true;
        this.previews.dispose();
        this.cancelPendingClick();
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            api.saveView(whiteboardID, { ...this.view }).catch(this.callbacks.onError);
        }
        this.observer.disconnect();
        canvas.removeEventListener("wheel", this.onWheel);
        canvas.removeEventListener("pointerdown", this.onPointerDown);
        canvas.removeEventListener("pointermove", this.onPointerMove);
        canvas.removeEventListener("pointerup", this.onPointerUp);
        canvas.removeEventListener("pointercancel", this.onPointerUp);
        canvas.removeEventListener("pointerleave", this.onPointerLeave);
        canvas.removeEventListener("dblclick", this.onDoubleClick);
        canvas.removeEventListener("contextmenu", this.onContextMenu);
        window.removeEventListener("keydown", this.onKeyDown);
        window.removeEventListener("copy", this.onCopy);
        window.removeEventListener("paste", this.onPaste);
        this.stopDragDrop?.();
        this.callbacks.onVideoAnchor(null);
    }

    // ---- 給 React 呼叫的操作 ----

    noteOf(noteID: string): Note | null {
        return this.board.notes[noteID] ?? null;
    }

    /** 內容在別處改過時，畫布上的文字要跟著變。 */
    setNoteContent(noteID: string, content: string) {
        const note = this.board.notes[noteID];
        if (note) note.content = content;
        this.fitCards();
        this.draw();
    }

    createWhiteboardAtCenter() {
        const { x, y } = this.viewportCenter();
        void this.createWhiteboard(x, y);
    }

    readonly createWhiteboard = async (x: number, y: number) => {
        const { callbacks } = this;
        try {
            const { placedId, board, workspace } = await api.createWhiteboard(this.whiteboardID, x, y);
            callbacks.onWorkspaceChange(workspace);
            if (this.disposed) return;
            this.select([placedId]);
            this.applyBoard(board);
        } catch (error) {
            callbacks.onError(error);
        }
    };

    readonly createCard = (x: number, y: number) => this.createNote("card", x, y);

    /** 卡片與心智圖就地編輯，其他類型在右側面板編輯。 */
    readonly createNote = async (type: NoteType, x: number, y: number) => {
        try {
            const { placedId, board } = await api.createNote(this.whiteboardID, type, x, y);
            this.callbacks.onCardCreated();
            if (this.disposed) return;
            this.applyBoard(board);
            this.select([placedId]);
            const created = board.placedNotes.find((note) => note.id === placedId);
            if (!created) return;
            if (type === "card") this.openEditor(created);
            else if (type === "mindmap") this.openMapEditor(created);
            else if (["drawio", "writer", "sheet", "slides"].includes(type)) this.callbacks.onOpenFullscreen(created.noteID);
            else this.callbacks.onOpenCard(created.noteID);
        } catch (error) {
            this.callbacks.onError(error);
        }
    };

    /** 檔案選擇器或貼上的圖片，`x`、`y` 是世界座標。 */
    readonly importImages = async (files: File[], x: number, y: number) => {
        if (this.isRoot) return;
        const placed: string[] = [];
        for (const [index, file] of files.entries()) {
            try {
                const offset = index * IMPORT_CASCADE;
                const result = await api.importImageBytes(this.whiteboardID, file, x + offset, y + offset);
                placed.push(...result.placedIds);
                this.applyImported(result.board, placed);
            } catch (error) {
                this.callbacks.onError(`無法匯入 ${file.name}：${String(error)}`);
            }
        }
    };

    private applyImported(board: BoardState, placed: string[]) {
        this.callbacks.onCardCreated();
        if (this.disposed) return;
        this.applyBoard(board);
        this.select(placed);
        this.draw();
    }

    /** 放開在畫布以外的地方（例如面板）就不匯入。 */
    private dropFiles(paths: string[], clientX: number, clientY: number) {
        if (document.elementFromPoint(clientX, clientY) !== this.canvas) return;
        const { x, y } = this.toWorld({ clientX, clientY });
        void this.importPaths(paths, x, y);
    }

    /** 拖進來或用檔案對話框選的檔案，`x`、`y` 是世界座標。 */
    readonly importPaths = async (paths: string[], x: number, y: number) => {
        if (this.isRoot || paths.length === 0) return;
        const { callbacks } = this;
        callbacks.onImporting(1);
        try {
            const { board, placedIds, failed } = await api.importMediaFiles(this.whiteboardID, paths, x, y);
            if (placedIds.length > 0) this.applyImported(board, placedIds);
            if (failed.length > 0) callbacks.onError(`無法匯入：${failed.join("、")}`);
            for (const id of placedIds) await this.describeVideo(board, id);
        } catch (error) {
            callbacks.onError(error);
        } finally {
            callbacks.onImporting(-1);
        }
    };

    /** 解碼剛匯入的影片，取得尺寸與封面。影片留著，使用者可以自己決定要不要刪除。 */
    private async describeVideo(board: BoardState, placedID: string) {
        const noteID = board.placedNotes.find((placed) => placed.id === placedID)?.noteID;
        const note = noteID ? board.notes[noteID] : null;
        const video = note?.type === "video" ? videoDetails(note) : null;
        if (!noteID || !video) return;
        try {
            const { poster, ...info } = await probeVideo(video.file);
            const next = await api.saveVideoInfo(this.whiteboardID, noteID, info, poster);
            this.callbacks.onCardCreated();
            if (!this.disposed) this.applyBoard(next);
        } catch {
            this.callbacks.onError(`無法播放 ${video.name}，可能是不支援的編碼（例如 HEVC），建議轉成 H.264 的 MP4。`);
        }
    }

    playVideo(placedID: string) {
        this.playingID = placedID;
        this.updateVideoAnchor();
    }

    readonly stopVideo = () => {
        this.playingID = null;
        this.updateVideoAnchor();
    };

    /** 播放器蓋在畫布上，滾輪要交回給畫布。 */
    forwardWheel(evt: WheelEvent) {
        this.canvas.dispatchEvent(new WheelEvent("wheel", evt));
    }

    private updateVideoAnchor() {
        const placed = this.notesInOrder().find((note) => note.id === this.playingID);
        const note = placed && this.board.notes[placed.noteID];
        const video = note?.type === "video" ? videoDetails(note) : null;
        let next: VideoAnchor | null = null;
        if (placed && video) {
            const corner = toScreen(this.view, placed.x, placed.y);
            next = {
                placedID: placed.id,
                file: video.file,
                left: corner.x,
                top: corner.y,
                width: placed.w,
                height: placed.h,
                scale: this.view.scale,
            };
        } else {
            this.playingID = null;
        }
        const previous = this.videoAnchor;
        if (next === previous || (next && previous && JSON.stringify(next) === JSON.stringify(previous))) return;
        this.videoAnchor = next;
        this.callbacks.onVideoAnchor(next);
    }

    /** 螢幕座標不在畫布上時（例如放開在面板上）回傳 null，就不放。 */
    worldPointAt(clientX: number, clientY: number) {
        if (document.elementFromPoint(clientX, clientY) !== this.canvas) return null;
        return this.toWorld({ clientX, clientY });
    }

    centerPoint() {
        return this.viewportCenter();
    }

    placeAt(noteID: string, x: number, y: number, tableID?: string) {
        void this.placeNotes([{ noteID, x, y, tableID }]);
    }

    /** 這份試算表在白板上顯示的表格；null 是沒有記錄、顯示第一個的舊放置。 */
    shownTables(noteID: string) {
        return this.board.placedNotes.filter((placed) => placed.noteID === noteID).map((placed) => placed.tableID);
    }

    setPlacedTable(placedID: string, tableID: string) {
        api.setPlacedTable(this.whiteboardID, placedID, tableID)
            .then(this.applyBoard)
            .catch(this.callbacks.onError);
    }

    toggleCollapsed({ id, collapsed }: PlacedNote) {
        api.setCollapsed(this.whiteboardID, id, !collapsed, COLLAPSED_CARD_HEIGHT)
            .then(this.applyBoard)
            .catch(this.callbacks.onError);
    }

    setAutoFit(placedID: string, autoFit: boolean) {
        api.setAutoFit(this.whiteboardID, placedID, autoFit)
            .then(this.applyBoard)
            .catch(this.callbacks.onError);
    }

    submitRename(id: string, name: string) {
        api.renameWhiteboard(id, name)
            .then(({ board, workspace }) => {
                this.callbacks.onWorkspaceChange(workspace);
                this.applyBoard(board);
            })
            .catch(this.callbacks.onError);
    }

    removeNote(placedID: string) {
        this.select([]);
        this.applyLinkChange(api.removeNote(this.whiteboardID, placedID));
    }

    refresh() {
        this.select([]);
        api.getBoard(this.whiteboardID).then(this.applyBoard).catch(this.callbacks.onError);
    }

    updateArrow(id: string, changes: { direction?: ArrowDirection; label?: string }) {
        this.applyLinkChange(api.updateArrow(this.whiteboardID, id, changes));
    }

    removeArrow(id: string) {
        this.applyLinkChange(api.removeArrow(this.whiteboardID, id));
    }

    editArrowLabel(arrow: Arrow) {
        const found = this.segments().find((item) => item.arrow.id === arrow.id);
        if (!found) return;
        const { x, y } = midpoint(found.segment);
        const { left, top } = this.clientPosition(x, y);
        this.callbacks.onEditArrowLabel({ id: arrow.id, label: arrow.label, left, top });
    }

    arrangeSelection(arrangement: Arrangement) {
        api.arrangeNotes(this.whiteboardID, [...this.selection], arrangement)
            .then(this.applyBoard)
            .catch(this.callbacks.onError);
    }

    // ---- 狀態 ----

    private select(ids: Iterable<string>) {
        this.selectedArrow = null;
        this.selection = new Set(ids);
        this.callbacks.onSelectionCount(this.selection.size);
    }

    private selectArrow(id: string) {
        this.select([]);
        this.selectedArrow = id;
    }

    private readonly applyBoard = (board: BoardState) => {
        if (this.disposed) return;
        this.board = board;
        // 編輯中的大小比 Rust 新，寫入還在佇列裡時不能被舊的蓋掉。
        const editedMap = this.mapEdit?.rect && this.placedByID(this.mapEdit.placedID);
        if (editedMap && this.mapEdit?.rect) Object.assign(editedMap, this.mapEdit.rect);
        this.fitCards();
        this.reportPlacedNotes();
        this.draw();
    };

    /** 移動、改變上下層也會回到這裡，內容沒變時不通知，React 才不用重畫清單。 */
    private reportPlacedNotes() {
        const noteIDs = [...new Set(this.board.placedNotes.map((placed) => placed.noteID))].sort();
        const reported = noteIDs.join();
        if (reported === this.reportedNotes) return;
        this.reportedNotes = reported;
        this.callbacks.onPlacedNotes(new Set(noteIDs));
    }

    /** 卡片高度跟著內容。量文字是前端的事，量到的高度存回 Rust，快速排版才用得到；只有行數變了才會寫入。 */
    private fitCards() {
        const fits: NoteFit[] = [];
        for (const placed of this.board.placedNotes) {
            if (!this.fitsContent(placed)) continue;
            const h = this.fittedHeight(placed, placed.w);
            if (h === placed.h) continue;
            placed.h = h;
            fits.push({ id: placed.id, h });
        }
        if (fits.length > 0) api.fitNotes(this.whiteboardID, fits).catch(this.callbacks.onError);
    }

    private fittedHeight(placed: PlacedNote, width: number) {
        const note = this.board.notes[placed.noteID];
        if (note?.type === "code") return codeHeight(this.ctx, note, width, placed.minSize.h);
        return cardHeight(this.ctx, note?.content ?? "", width, placed.minSize.h);
    }

    private fitsContent(placed: PlacedNote) {
        const type = this.board.notes[placed.noteID]?.type;
        return (type === "card" || type === "code") && placed.autoFit && !placed.collapsed;
    }

    private applyLinkChange(change: Promise<BoardState>) {
        change
            .then((board) => {
                this.applyBoard(board);
                this.callbacks.onLinksChange();
            })
            .catch(this.callbacks.onError);
    }

    /** 已經在白板上的卡片不會多一張，改成選取原本那張，看不到時把畫面移過去。 */
    private async placeNotes(notes: { noteID: string; x: number; y: number; tableID?: string | null }[]) {
        try {
            const placed = await Promise.all(
                notes.map(({ noteID, x, y, tableID }) => (tableID
                    ? api.placeTable(this.whiteboardID, noteID, tableID, x, y)
                    : api.placeNote(this.whiteboardID, noteID, x, y))),
            );
            const last = placed[placed.length - 1];
            if (!last || this.disposed) return;
            this.applyBoard(last.board);
            this.select(placed.map((item) => item.placedId));
            this.raiseSelection();
            if (placed.length === 1 && !last.created) this.reveal(last.placedId);
            this.draw();
        } catch (error) {
            this.callbacks.onError(error);
        }
    }

    private reveal(placedID: string) {
        const placed = this.board.placedNotes.find((note) => note.id === placedID);
        if (!placed || intersects(placed, this.worldViewport())) return;
        this.view.x = this.canvas.clientWidth / 2 - (placed.x + placed.w / 2) * this.view.scale;
        this.view.y = this.canvas.clientHeight / 2 - (placed.y + placed.h / 2) * this.view.scale;
        this.saveView();
    }

    private raiseSelection() {
        if (this.selection.size === 0) return;
        api.raiseNotes(this.whiteboardID, [...this.selection])
            .then(this.applyBoard)
            .catch(this.callbacks.onError);
    }

    private isCard(placed: PlacedNote) {
        return this.board.notes[placed.noteID]?.type === "card";
    }

    /** 資料還在、不是白板方塊的內容，什麼類型都算。 */
    private isMindmap(placed: PlacedNote) {
        return this.board.notes[placed.noteID]?.type === "mindmap";
    }

    private isNote(placed: PlacedNote) {
        const type = this.board.notes[placed.noteID]?.type;
        return type !== undefined && type !== "whiteboard";
    }

    /** 圖片與影片縮放時要維持的比例；其他內容回傳 null。摺疊時框是裁切的，不用維持。 */
    private lockedRatio(placed: PlacedNote) {
        const note = this.board.notes[placed.noteID];
        return note && !placed.collapsed ? mediaRatio(note) : null;
    }

    private isTile(placed: PlacedNote) {
        return this.board.notes[placed.noteID]?.type === "whiteboard";
    }

    private onTileTitle(placed: PlacedNote, y: number) {
        return this.isTile(placed) && y - placed.y <= TILE_TITLE_HEIGHT;
    }

    private cancelPendingClick() {
        if (this.clickTimer !== null) clearTimeout(this.clickTimer);
        this.clickTimer = null;
    }

    // ---- 查詢畫面上的東西 ----

    private notesInOrder() {
        return previewNotes(this.board.placedNotes, this.drag, this.resizing);
    }

    private segments() {
        return arrowSegments(this.board.arrows, this.notesInOrder());
    }

    /** 只有選取單一筆記時才能調整大小。 */
    private selectedNote() {
        return this.selection.size === 1
            ? this.notesInOrder().find((placed) => this.selection.has(placed.id))
            : undefined;
    }

    private hoveredNote() {
        return this.notesInOrder().find((placed) => placed.id === this.hoveredID);
    }

    private hitTest(x: number, y: number) {
        return noteAt(this.notesInOrder(), x, y);
    }

    private handleAt(x: number, y: number): ResizeHandle | null {
        const selected = this.selectedNote();
        if (!selected) return null;
        const handle = hitResizeHandle(selected, x, y, this.view.scale);
        return this.fitsContent(selected) || selected.collapsed ? widthOnlyHandle(handle) : handle;
    }

    private onConnector(point: Point) {
        const hovered = this.hoveredNote();
        return hovered !== undefined && hitConnector(hovered, point, this.view.scale);
    }

    private arrowAt(point: Point) {
        return this.segments().find(({ segment }) => hitsSegment(point, segment, this.view.scale))?.arrow ?? null;
    }

    private worldViewport(): Rect {
        return visibleWorld(this.view, this.canvas.clientWidth, this.canvas.clientHeight);
    }

    private viewportCenter() {
        return toWorld(this.view, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2);
    }

    // 只對齊畫面上看得到的筆記，否則筆記會被看不見的東西吸走。
    private snapTargets(moving: Set<string>) {
        const viewport = this.worldViewport();
        return this.board.placedNotes.filter(
            (placed) => !moving.has(placed.id) && intersects(placed, viewport),
        );
    }

    private toWorld(evt: Pick<MouseEvent, "clientX" | "clientY">) {
        const rect = this.canvas.getBoundingClientRect();
        return toWorld(this.view, evt.clientX - rect.left, evt.clientY - rect.top);
    }

    /** 世界座標在視窗中的位置，疊在畫布上的輸入框要對齊這裡。 */
    private clientPosition(x: number, y: number) {
        const rect = this.canvas.getBoundingClientRect();
        const screen = toScreen(this.view, x, y);
        return { left: rect.left + screen.x, top: rect.top + screen.y };
    }

    // ---- 繪製 ----

    private readonly draw = () => {
        const { drag, resizing, marquee, linking } = this;
        const notes = this.notesInOrder();
        const hovered = this.hoveredNote();
        const idle = !drag && !resizing && !marquee && !linking;
        drawScene(this.ctx, this.canvas, {
            view: this.view,
            notes,
            noteData: this.board.notes,
            hiddenID: this.mapEdit?.placedID ?? null,
            previewOf: (note, variant) => this.previews.get(note, variant),
            arrows: arrowSegments(this.board.arrows, notes),
            selection: this.selection,
            selectedArrow: this.selectedArrow,
            resizable: this.selectedNote(),
            connectable: idle ? hovered : undefined,
            linking,
            guides: this.guides,
            marquee,
        });
        this.updateCardAnchor(!drag?.moved && !resizing && !marquee && !linking);
        this.updateVideoAnchor();
        this.updateMapAnchor();
    };

    private updateMapAnchor() {
        const edit = this.mapEdit;
        const root = edit?.place ? toScreen(this.view, edit.place.rootX, edit.place.rootY) : { x: 0, y: 0 };
        const next: MapEditAnchor | null = edit && {
            noteID: edit.noteID,
            rootLeft: root.x,
            rootTop: root.y,
            scale: edit.place ? edit.place.scale * this.view.scale : null,
            startNode: edit.startNode,
            startTyping: edit.startTyping,
        };
        const previous = this.mapAnchor;
        const same = next === previous || (next && previous
            && next.noteID === previous.noteID
            && next.rootLeft === previous.rootLeft
            && next.rootTop === previous.rootTop
            && next.scale === previous.scale);
        if (same) return;
        this.mapAnchor = next;
        this.callbacks.onMapEdit(next);
    }

    private updateCardAnchor(visible: boolean) {
        const selected = visible ? this.selectedNote() : undefined;
        const previous = this.cardAnchor;
        let next: CardAnchor | null = null;
        if (selected && this.isNote(selected)) {
            const corner = toScreen(this.view, selected.x, selected.y);
            next = {
                placed: selected,
                left: corner.x,
                top: corner.y,
                width: selected.w,
                scale: this.view.scale,
            };
        }
        const same = next === previous || (next && previous
            && next.placed.id === previous.placed.id
            && next.placed.autoFit === previous.placed.autoFit
            && next.placed.collapsed === previous.placed.collapsed
            && next.left === previous.left
            && next.top === previous.top
            && next.width === previous.width
            && next.scale === previous.scale);
        if (same) return;
        this.cardAnchor = next;
        this.callbacks.onCardAnchor(next);
    }

    private readonly resize = () => {
        const dpr = window.devicePixelRatio;
        this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
        this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
        this.draw();
    };

    private updateHover(world: Point, hit: PlacedNote | null, shiftKey: boolean) {
        const { hoveredID } = this;
        const hovered = this.hoveredNote();
        const staysNear = hovered !== undefined && nearConnectors(hovered, world, this.view.scale);
        let next: string | null = null;
        if (!shiftKey) next = this.onConnector(world) ? hoveredID : hit?.id ?? (staysNear ? hoveredID : null);
        if (next === hoveredID) return;
        this.hoveredID = next;
        this.draw();
    }

    private updateCursor(evt: MouseEvent) {
        const { canvas } = this;
        const world = this.toWorld(evt);
        const handle = evt.shiftKey ? null : this.handleAt(world.x, world.y);
        const hit = this.hitTest(world.x, world.y);
        const onNote = hit !== null;
        this.updateHover(world, hit, evt.shiftKey);
        if (handle) canvas.style.cursor = resizeCursor(handle);
        else if (!evt.shiftKey && this.onConnector(world)) canvas.style.cursor = "crosshair";
        else if (hit && !evt.shiftKey && this.onTileTitle(hit, world.y)) canvas.style.cursor = "text";
        else if (!hit && !evt.shiftKey && this.arrowAt(world)) canvas.style.cursor = "pointer";
        else canvas.style.cursor = onNote && !evt.shiftKey ? "grab" : "default";
    }

    // ---- 視圖 ----

    private saveView() {
        if (this.saveTimer !== null) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            api.saveView(this.whiteboardID, { ...this.view }).catch(this.callbacks.onError);
        }, SAVE_VIEW_DELAY_MS);
    }

    /** 滾輪上下滑動，Shift 左右滑動，Ctrl 以滑鼠位置為中心縮放。 */
    private readonly onWheel = (evt: WheelEvent) => {
        const { view } = this;
        evt.preventDefault();
        // 就地編輯心智圖時可以邊打字邊移動白板。
        if (!this.mapEdit && document.activeElement instanceof HTMLElement) document.activeElement.blur();

        if (!evt.ctrlKey) {
            if (evt.shiftKey) {
                // 瀏覽器可能已把 Shift + 滾輪換成 deltaX，兩種都要接。
                view.x -= evt.deltaX || evt.deltaY;
            } else {
                view.x -= evt.deltaX;
                view.y -= evt.deltaY;
            }
        } else {
            const rect = this.canvas.getBoundingClientRect();
            Object.assign(view, zoomAt(view, evt.clientX - rect.left, evt.clientY - rect.top, evt.deltaY < 0));
        }
        this.draw();
        this.saveView();
    };

    // ---- 指標：按下 ----

    private readonly onPointerDown = (evt: PointerEvent) => {
        const { canvas } = this;
        this.leaveMapEditor();
        this.cancelPendingClick();
        this.panDragged = false;
        // 右鍵按在空白處可以拖曳畫布，沒拖動就是開選單；兩者都不影響目前的選取。
        if (evt.button === 2) {
            const { x, y } = this.toWorld(evt);
            if (this.hitTest(x, y)) return;
            this.lastX = this.panStartX = evt.clientX;
            this.lastY = this.panStartY = evt.clientY;
            canvas.setPointerCapture(evt.pointerId);
            this.panning = true;
            canvas.style.cursor = "grabbing";
            return;
        }
        if (evt.button !== 0) return;
        this.lastX = evt.clientX;
        this.lastY = evt.clientY;
        canvas.setPointerCapture(evt.pointerId);

        const world = this.toWorld(evt);
        const handle = evt.shiftKey ? null : this.handleAt(world.x, world.y);
        const selected = this.selectedNote();
        if (handle && selected) {
            this.resizing = { id: selected.id, handle, start: selected, rect: selected, dx: 0, dy: 0 };
            return;
        }

        if (!evt.shiftKey && this.hoveredID !== null && this.onConnector(world)) {
            this.linking = { fromID: this.hoveredID, pointer: world, targetID: null };
            this.draw();
            return;
        }

        const hit = this.hitTest(world.x, world.y);
        if (hit && evt.shiftKey) {
            // 放開時才知道是單點還是拖曳。
            this.marquee = {
                base: this.selection,
                clickedID: hit.id,
                x0: world.x,
                y0: world.y,
                x1: world.x,
                y1: world.y,
            };
        } else if (hit) {
            const reclickedCard = (this.isCard(hit) || this.isMindmap(hit))
                && this.selection.size === 1
                && this.selection.has(hit.id);
            if (!this.selection.has(hit.id)) this.select([hit.id]);
            this.raiseSelection();
            this.drag = {
                ids: this.selection,
                clickedID: hit.id,
                dx: 0,
                dy: 0,
                snap: NO_SNAP,
                moved: false,
                onTileTitle: this.onTileTitle(hit, world.y),
                reclickedCard,
                pressX: world.x,
                pressY: world.y,
            };
        } else {
            const arrow = evt.shiftKey ? null : this.arrowAt(world);
            if (arrow) {
                this.selectArrow(arrow.id);
                this.draw();
                return;
            }
            // 按住 Shift 從空白處框選是加選，保留原本的選取。
            if (!evt.shiftKey) this.select([]);
            this.marquee = { base: this.selection, x0: world.x, y0: world.y, x1: world.x, y1: world.y };
        }
        this.draw();
    };

    // ---- 指標：移動 ----

    private readonly onPointerMove = (evt: PointerEvent) => {
        const deltaX = evt.clientX - this.lastX;
        const deltaY = evt.clientY - this.lastY;
        this.lastX = evt.clientX;
        this.lastY = evt.clientY;

        if (this.linking) {
            const world = this.toWorld(evt);
            const hit = this.hitTest(world.x, world.y);
            this.linking.pointer = world;
            this.linking.targetID = hit && hit.id !== this.linking.fromID ? hit.id : null;
            this.draw();
        } else if (this.resizing) {
            this.continueResize(this.resizing, deltaX, deltaY, evt.altKey);
        } else if (this.drag) {
            this.continueDrag(this.drag, deltaX, deltaY, evt.altKey);
        } else if (this.marquee) {
            const world = this.toWorld(evt);
            this.marquee.x1 = world.x;
            this.marquee.y1 = world.y;
            const area = marqueeRect(this.marquee);
            const inside = this.board.placedNotes
                .filter((placed) => intersects(placed, area))
                .map((placed) => placed.id);
            this.select([...this.marquee.base, ...inside]);
            this.draw();
        } else if (this.panning) {
            this.view.x += deltaX;
            this.view.y += deltaY;
            if (Math.hypot(evt.clientX - this.panStartX, evt.clientY - this.panStartY) >= CLICK_SLOP) {
                this.panDragged = true;
            }
            this.draw();
        } else {
            this.updateCursor(evt);
        }
    };

    /** 和移動一樣，放開時才寫入。 */
    private continueResize(resizing: ResizeGesture, deltaX: number, deltaY: number, freeform: boolean) {
        const { scale } = this.view;
        resizing.dx += deltaX / scale;
        resizing.dy += deltaY / scale;
        const { start, handle, dx, dy } = resizing;
        const raw = resizeRect(start, handle, dx, dy, start.minSize);
        if (freeform) {
            resizing.rect = raw;
            this.guides = [];
        } else {
            const others = this.snapTargets(new Set([resizing.id]));
            const snap = snapResize(raw, handle, others, scale);
            resizing.rect = resizeRect(start, handle, dx + snap.x, dy + snap.y, start.minSize);
            this.guides = findGuides(resizing.rect, others);
        }
        if (this.fitsContent(start)) {
            resizing.rect = { ...resizing.rect, h: this.fittedHeight(start, resizing.rect.w) };
        }
        const ratio = this.lockedRatio(start);
        if (ratio !== null) {
            resizing.rect = keepRatio(start, handle, resizing.rect, ratio, start.minSize);
        }
        this.draw();
    }

    /** 拖曳中只更新畫面，放開時才寫入，整段拖曳只形成一筆修改。按住 Alt 時暫時關閉吸附。 */
    private continueDrag(drag: DragGesture, deltaX: number, deltaY: number, freeform: boolean) {
        const { scale } = this.view;
        drag.dx += deltaX / scale;
        drag.dy += deltaY / scale;
        drag.moved = true;

        const { ids, dx, dy } = drag;
        const moving = this.board.placedNotes.filter((placed) => ids.has(placed.id));
        if (freeform || moving.length === 0) {
            drag.snap = NO_SNAP;
            this.guides = [];
        } else {
            const start = boundsOf(moving);
            const raw = { ...start, x: start.x + dx, y: start.y + dy };
            const others = this.snapTargets(ids);
            const snap = snapMove(raw, others, scale);
            drag.snap = snap;
            this.guides = findGuides({ ...raw, x: raw.x + snap.x, y: raw.y + snap.y }, others);
        }
        this.draw();
    }

    // ---- 指標：放開 ----

    private readonly onPointerUp = (evt: PointerEvent) => {
        const { canvas } = this;
        if (canvas.hasPointerCapture(evt.pointerId)) {
            canvas.releasePointerCapture(evt.pointerId);
        }
        this.updateCursor(evt);
        this.guides = [];

        if (this.linking) {
            const { fromID, targetID } = this.linking;
            this.linking = null;
            if (targetID && evt.type === "pointerup") {
                this.applyLinkChange(api.createArrow(this.whiteboardID, fromID, targetID));
            }
            this.draw();
        } else if (this.resizing) {
            this.finishResize(this.resizing);
        } else if (this.drag) {
            this.finishDrag(this.drag);
        } else if (this.marquee) {
            this.finishMarquee(this.marquee);
        } else if (this.panning) {
            this.panning = false;
            this.saveView();
        }
    };

    private finishResize(finished: ResizeGesture) {
        const clear = () => {
            if (this.resizing === finished) this.resizing = null;
        };
        if (finished.rect === finished.start) {
            clear();
            this.draw();
            return;
        }
        // 收到 Rust 的結果才結束，筆記不會閃回舊尺寸。
        api.resizeNote(this.whiteboardID, finished.id, finished.rect)
            .then((board) => {
                clear();
                this.applyBoard(board);
            })
            .catch((error: unknown) => {
                clear();
                this.draw();
                this.callbacks.onError(error);
            });
    }

    private finishDrag(finished: DragGesture) {
        const clear = () => {
            if (this.drag === finished) this.drag = null;
        };
        const { ids, clickedID, dx, dy, snap, moved } = finished;
        if (Math.hypot(dx, dy) * this.view.scale < CLICK_SLOP) {
            if (finished.onTileTitle) this.clickTimer = setTimeout(this.startRename, DOUBLE_CLICK_MS);
            else if (this.isMapClick(clickedID, ids)) {
                this.clickTimer = setTimeout(() => void this.clickMap(finished), DOUBLE_CLICK_MS);
            } else if (finished.reclickedCard) this.clickTimer = setTimeout(this.startEdit, DOUBLE_CLICK_MS);
        }
        const moves = this.board.placedNotes
            .filter((placed) => ids.has(placed.id))
            .map((placed) => ({ id: placed.id, x: placed.x + dx + snap.x, y: placed.y + dy + snap.y }));
        if (moved && moves.length > 0) {
            // 收到 Rust 的結果才結束拖曳，筆記不會閃回舊位置。
            api.moveNotes(this.whiteboardID, moves)
                .then((board) => {
                    clear();
                    this.applyBoard(board);
                })
                .catch((error: unknown) => {
                    clear();
                    this.draw();
                    this.callbacks.onError(error);
                });
        } else {
            clear();
            // 多選時單點其中一張，才縮小成只選那一張；按下時不能縮，否則無法整組拖曳。
            if (this.selection.size > 1) {
                this.select([clickedID]);
                this.raiseSelection();
            }
        }
        this.draw();
    }

    private finishMarquee({ clickedID, x0, y0, x1, y1 }: MarqueeGesture) {
        this.marquee = null;
        if (clickedID && x0 === x1 && y0 === y1) {
            const next = new Set(this.selection);
            const added = !next.delete(clickedID);
            if (added) next.add(clickedID);
            this.select(next);
            if (added) this.raiseSelection();
        } else {
            this.raiseSelection();
        }
        this.draw();
    }

    private readonly onPointerLeave = () => {
        if (this.hoveredID === null) return;
        this.hoveredID = null;
        this.draw();
    };

    // ---- 編輯 ----

    private openEditor(placed: PlacedNote) {
        this.callbacks.onEdit({
            noteID: placed.noteID,
            text: this.board.notes[placed.noteID]?.content ?? "",
            ...this.clientPosition(placed.x, placed.y),
            width: placed.w,
            height: placed.h,
            scale: this.view.scale,
            fitContent: this.fitsContent(placed),
            paddingTop: NOTE_PADDING + CARD_HEADER_HEIGHT,
        });
    }

    private readonly startEdit = () => {
        const placed = this.selectedNote();
        if (!placed || placed.collapsed) return;
        if (this.isMindmap(placed)) this.openMapEditor(placed);
        else this.openEditor(placed);
    };

    // ---- 心智圖就地編輯 ----

    private placedByID(id: string) {
        return this.board.placedNotes.find((placed) => placed.id === id);
    }

    private openMapEditor(placed: PlacedNote, startNode: string | null = null, startTyping = false) {
        // 取消選取，控制點和卡片按鈕才不會壓在節點上。
        this.select([]);
        this.mapEdit = {
            placedID: placed.id,
            noteID: placed.noteID,
            startNode,
            startTyping,
            place: null,
            rect: null,
            savedRect: "",
        };
        this.draw();
    }

    private isMapClick(clickedID: string, ids: Set<string>) {
        const placed = this.placedByID(clickedID);
        return placed !== undefined && ids.size === 1 && this.isMindmap(placed) && !placed.collapsed;
    }

    /** 白板上的心智圖是一張圖，要等 Rust 回傳節點才知道點到哪一個。 */
    private async mapNodeAt(placed: PlacedNote, x: number, y: number) {
        const nodes = await api.getMindmap(placed.noteID);
        return nodeAtCardPoint(layoutMindmap(nodes, measureText), placed, x, y);
    }

    /** 單擊：點到節點就開始編輯那個節點；點到空白處第一次只是選取卡片，再點一次才打開。 */
    private async clickMap(gesture: DragGesture) {
        const placed = this.placedByID(gesture.clickedID);
        if (!placed) return;
        try {
            const node = await this.mapNodeAt(placed, gesture.pressX, gesture.pressY);
            // 等待時可能已經點到別的地方。
            if (this.disposed || this.mapEdit || !this.selection.has(placed.id) || this.selection.size !== 1) return;
            if (node) this.openMapEditor(placed, node);
            else if (gesture.reclickedCard) this.openMapEditor(placed);
        } catch (error) {
            this.callbacks.onError(error);
        }
    }

    /** 雙擊節點直接改文字，雙擊空白處就只是打開。 */
    private async doubleClickMap(placed: PlacedNote, x: number, y: number) {
        try {
            const node = await this.mapNodeAt(placed, x, y);
            if (this.disposed || this.mapEdit) return;
            this.openMapEditor(placed, node, node !== null);
        } catch (error) {
            this.callbacks.onError(error);
        }
    }

    /** 編輯器算好版面後呼叫：第一次決定比例，之後卡片跟著長大。打字中只改畫面，`save` 時才寫入。 */
    readonly fitMapCard = (size: MapSize, save: boolean) => {
        const edit = this.mapEdit;
        const placed = edit && this.placedByID(edit.placedID);
        if (!edit) return;
        if (!placed) {
            this.closeMapEditor(false);
            return;
        }
        edit.place ??= mapInCard(placed, size);
        edit.rect = cardAroundMap(edit.place.rootX, edit.place.rootY, edit.place.scale, size);
        Object.assign(placed, edit.rect);
        this.draw();

        const rect = JSON.stringify(edit.rect);
        if (!save || rect === edit.savedRect) return;
        edit.savedRect = rect;
        api.resizeNote(this.whiteboardID, edit.placedID, edit.rect).catch(this.callbacks.onError);
    };

    /** 鍵盤一路新增時，把節點拉回畫面內。座標相對畫布。 */
    readonly revealOnCanvas = (left: number, top: number, right: number, bottom: number) => {
        const dx = revealShift(left, right, this.canvas.clientWidth);
        const dy = revealShift(top, bottom, this.canvas.clientHeight);
        if (dx === 0 && dy === 0) return;
        this.view.x += dx;
        this.view.y += dy;
        this.draw();
        this.saveView();
    };

    readonly closeMapEditor = (reselect: boolean) => {
        const edit = this.mapEdit;
        if (!edit) return;
        this.mapEdit = null;
        if (reselect) this.select([edit.placedID]);
        this.draw();
    };

    /** 點到白板就結束。先讓輸入框存好文字、卡片量好大小，下一輪才移除編輯器。 */
    private leaveMapEditor() {
        const edit = this.mapEdit;
        if (!edit) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest(".mindmap-editor")) active.blur();
        setTimeout(() => {
            if (this.mapEdit === edit && !this.disposed) this.closeMapEditor(false);
        }, 0);
    }

    private readonly startRename = () => {
        const placed = this.selectedNote();
        if (!placed || !this.isTile(placed)) return;
        this.callbacks.onRename({
            whiteboardID: placed.noteID,
            name: this.board.notes[placed.noteID]?.content ?? "",
            ...this.clientPosition(placed.x, placed.y),
            width: placed.w,
            scale: this.view.scale,
        });
    };

    private readonly onDoubleClick = async (evt: MouseEvent) => {
        this.cancelPendingClick();
        const world = this.toWorld(evt);
        const hit = this.hitTest(world.x, world.y);
        if (hit) {
            if (this.isTile(hit)) this.callbacks.onOpenWhiteboard(hit.noteID);
            else if (this.board.notes[hit.noteID]?.type === "drawio") this.callbacks.onOpenFullscreen(hit.noteID);
            else if (this.isMindmap(hit) && !hit.collapsed) await this.doubleClickMap(hit, world.x, world.y);
            else if (this.isNote(hit)) this.callbacks.onOpenCard(hit.noteID);
            else this.openEditor(hit);
            return;
        }
        // 控制點有一半在筆記外，雙擊到那裡不算點到空白處。
        if (this.handleAt(world.x, world.y) || this.onConnector(world)) return;

        const arrow = this.arrowAt(world);
        if (arrow) {
            this.editArrowLabel(arrow);
            return;
        }

        if (this.isRoot) await this.createWhiteboard(world.x, world.y);
        else await this.createCard(world.x, world.y);
    };

    private readonly onContextMenu = (evt: MouseEvent) => {
        evt.preventDefault();
        if (this.panDragged) return;
        const world = this.toWorld(evt);
        const placed = this.hitTest(world.x, world.y) ?? undefined;
        const arrow = (placed ? null : this.arrowAt(world)) ?? undefined;
        // 選單只作用在按到的那一個，多選時要先縮小，畫面才不會讓人以為整組都受影響。
        if (placed) this.select([placed.id]);
        else if (arrow) this.selectArrow(arrow.id);
        this.draw();
        this.callbacks.onMenu({ clientX: evt.clientX, clientY: evt.clientY, x: world.x, y: world.y, arrow, placed });
    };

    // ---- 鍵盤 ----

    private readonly onKeyDown = (evt: KeyboardEvent) => {
        const target = evt.target as HTMLElement;
        if (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
        // 心智圖編輯器有自己的鍵盤操作，Delete 不能刪到白板上的選取。
        if (target.closest(".mindmap-editor")) return;
        // 確認框開著或卡片全螢幕時，按鍵不能動到畫布上的選取。
        if (target.closest(".confirm-backdrop") || document.querySelector(".card-fullscreen")) return;

        // 方塊不能刪除或複製，規則由 Rust 把關。
        const selected = this.board.placedNotes.filter(
            (note) => this.selection.has(note.id) && !this.isTile(note),
        );
        const command = evt.ctrlKey || evt.metaKey;
        const deleting = evt.key === "Delete" || evt.key === "Backspace";

        if (evt.key === "a" && command) {
            evt.preventDefault();
            this.select(this.board.placedNotes.map((note) => note.id));
            this.draw();
        } else if (evt.key === "Escape" && this.playingID) {
            this.stopVideo();
        } else if (evt.key === "F2") {
            this.startRename();
        } else if (deleting && this.selectedArrow) {
            const id = this.selectedArrow;
            this.select([]);
            this.removeArrow(id);
        } else if (deleting && selected.length > 0) {
            this.select([]);
            for (const note of selected) {
                this.applyLinkChange(api.removeNote(this.whiteboardID, note.id));
            }
        } else if (evt.key === "c" && command && selected.length > 0) {
            const bounds = boundsOf(selected);
            copiedNotes = selected.map((note) => ({
                noteID: note.noteID,
                tableID: note.tableID,
                dx: note.x + note.w / 2 - (bounds.x + bounds.w / 2),
                dy: note.y + note.h / 2 - (bounds.y + bounds.h / 2),
            }));
        }
    };

    private ignoresClipboard(evt: ClipboardEvent) {
        const target = evt.target as HTMLElement;
        return target.isContentEditable
            || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)
            || target.closest?.(".confirm-backdrop, .mindmap-editor") != null
            || document.querySelector(".card-fullscreen") !== null;
    }

    /** 複製筆記時也蓋掉系統剪貼簿，之後貼上才不會貼出更早複製的圖片。 */
    private readonly onCopy = (evt: ClipboardEvent) => {
        if (this.ignoresClipboard(evt) || copiedNotes.length === 0) return;
        const selected = this.board.placedNotes.filter((note) => this.selection.has(note.id) && !this.isTile(note));
        const first = selected[0] && this.board.notes[selected[0].noteID];
        if (!first) return;
        evt.preventDefault();
        evt.clipboardData?.setData("text/plain", noteTitle(first));
    };

    /** 剪貼簿裡的圖片比白板內複製的筆記新，因為複製筆記時已經蓋掉了系統剪貼簿。 */
    private readonly onPaste = (evt: ClipboardEvent) => {
        if (this.ignoresClipboard(evt) || this.isRoot) return;
        const { x, y } = this.viewportCenter();
        const images = [...(evt.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
        if (images.length > 0) {
            evt.preventDefault();
            void this.importImages(images, x, y);
            return;
        }
        void this.placeNotes(copiedNotes.map(({ noteID, tableID, dx, dy }) => ({ noteID, tableID, x: x + dx, y: y + dy })));
    };
}
