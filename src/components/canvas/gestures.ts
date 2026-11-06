import type { Arrow, PlacedNote } from "../../types.ts";
import { connect, type Point, type Segment } from "./arrow.ts";
import type { Rect, ResizeHandle } from "./resize.ts";
import type { Snap } from "./snap.ts";

// 拖曳中的狀態與預覽。全部只算畫面，放開滑鼠時才寫入 Rust。

/** 方塊上方放名稱的區域，單擊這裡就是改名，高度和名稱輸入框一致。 */
export const TILE_TITLE_HEIGHT = 54;

export interface DragGesture {
    ids: Set<string>;
    clickedID: string;
    dx: number;
    dy: number;
    snap: Snap;
    moved: boolean;
    onTileTitle: boolean;
    /** 按下前這張卡片已經是唯一選取：沒有拖動就是再點一次，要進入編輯。 */
    reclickedCard: boolean;
    /** 按下的世界座標，心智圖用它找點到的節點。 */
    pressX: number;
    pressY: number;
}

export interface MarqueeGesture {
    base: Set<string>;
    /** Shift 按在這張筆記上：沒有拖動就當成單點，切換它的選取。 */
    clickedID?: string;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export interface ResizeGesture {
    id: string;
    handle: ResizeHandle;
    start: PlacedNote;
    rect: Rect;
    dx: number;
    dy: number;
}

export interface LinkGesture {
    fromID: string;
    pointer: Point;
    targetID: string | null;
}

/** 套用進行中的拖曳與縮放後的筆記，順序就是由下到上的繪製順序。 */
export function previewNotes(
    placedNotes: PlacedNote[],
    drag: DragGesture | null,
    resizing: ResizeGesture | null,
): PlacedNote[] {
    return placedNotes.map((placed) => {
        if (resizing?.id === placed.id) return { ...placed, ...resizing.rect };
        return drag?.ids.has(placed.id)
            ? { ...placed, x: placed.x + drag.dx + drag.snap.x, y: placed.y + drag.dy + drag.snap.y }
            : placed;
    });
}

/** 最上層的筆記優先。 */
export function noteAt(notes: PlacedNote[], x: number, y: number): PlacedNote | null {
    for (let i = notes.length - 1; i >= 0; i -= 1) {
        const placed = notes[i];
        if (
            x >= placed.x && x <= placed.x + placed.w &&
            y >= placed.y && y <= placed.y + placed.h
        ) {
            return placed;
        }
    }
    return null;
}

export function arrowSegments(arrows: Arrow[], notes: PlacedNote[]): { arrow: Arrow; segment: Segment }[] {
    const placedByID = new Map(notes.map((placed) => [placed.id, placed]));
    const found: { arrow: Arrow; segment: Segment }[] = [];
    for (const arrow of arrows) {
        const from = placedByID.get(arrow.fromPlacedID);
        const to = placedByID.get(arrow.toPlacedID);
        const segment = from && to && connect(from, to);
        if (segment) found.push({ arrow, segment });
    }
    return found;
}

export const marqueeRect = (box: MarqueeGesture): Rect => ({
    x: Math.min(box.x0, box.x1),
    y: Math.min(box.y0, box.y1),
    w: Math.abs(box.x1 - box.x0),
    h: Math.abs(box.y1 - box.y0),
});
