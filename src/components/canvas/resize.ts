// 通用的「拖曳調整大小」：只處理矩形，不認識筆記，任何畫在畫布上的矩形物件都能使用。
// 座標都是世界座標；`scale` 是視圖縮放，用來讓控制點在螢幕上維持固定大小。

export interface Size {
    w: number;
    h: number;
}

export interface Rect extends Size {
    x: number;
    y: number;
}

/** 依方位命名，名稱裡的字母代表被拖動的邊。 */
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const HIT_DISTANCE = 6;
const HANDLE_SIZE = 8;

const CURSORS: Record<ResizeHandle, string> = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize",
};

export const resizeCursor = (handle: ResizeHandle) => CURSORS[handle];

/** 回傳 (x, y) 碰到的控制點，四角優先於四邊，沒碰到時回傳 null。 */
export function hitResizeHandle(rect: Rect, x: number, y: number, scale: number): ResizeHandle | null {
    const reach = HIT_DISTANCE / scale;
    const right = rect.x + rect.w;
    const bottom = rect.y + rect.h;
    if (x < rect.x - reach || x > right + reach || y < rect.y - reach || y > bottom + reach) return null;

    // 往內的範圍不超過四分之一，縮得很小時中間仍能拖曳移動。
    const insetX = Math.min(reach, rect.w / 4);
    const insetY = Math.min(reach, rect.h / 4);
    const vertical = y <= rect.y + insetY ? "n" : y >= bottom - insetY ? "s" : "";
    const horizontal = x <= rect.x + insetX ? "w" : x >= right - insetX ? "e" : "";
    return (`${vertical}${horizontal}` || null) as ResizeHandle | null;
}

/** 高度由內容決定的物件只能拖寬度：四角當成左右邊，上下邊不算控制點。 */
export const widthOnlyHandle = (handle: ResizeHandle | null) =>
    (handle?.replace(/[ns]/, "") || null) as ResizeHandle | null;

/** 依拖曳距離算出新矩形，對邊固定不動；到達 `min` 後不再縮小。 */
export function resizeRect(start: Rect, handle: ResizeHandle, dx: number, dy: number, min: Size): Rect {
    let { x, y, w, h } = start;
    if (handle.includes("e")) {
        w = Math.max(min.w, start.w + dx);
    } else if (handle.includes("w")) {
        w = Math.max(min.w, start.w - dx);
        x = start.x + start.w - w;
    }
    if (handle.includes("s")) {
        h = Math.max(min.h, start.h + dy);
    } else if (handle.includes("n")) {
        h = Math.max(min.h, start.h - dy);
        y = start.y + start.h - h;
    }
    return { x, y, w, h };
}

/** 維持長寬比。拖四角時以變化較大的一邊為準，對角固定不動；`min` 是兩邊各自的下限。 */
export function keepRatio(start: Rect, handle: ResizeHandle, rect: Rect, ratio: number, min: Size): Rect {
    const horizontal = /[ew]/.test(handle);
    const vertical = /[ns]/.test(handle);
    const followsWidth = horizontal
        && (!vertical || Math.abs(rect.w - start.w) / start.w >= Math.abs(rect.h - start.h) / start.h);
    const wanted = followsWidth ? rect.w : rect.h * ratio;
    const w = Math.max(wanted, min.w, min.h * ratio);
    const h = w / ratio;
    return {
        x: handle.includes("w") ? start.x + start.w - w : start.x,
        y: handle.includes("n") ? start.y + start.h - h : start.y,
        w,
        h,
    };
}

/** 畫出四角的控制點；四邊沒有畫出來，但一樣可以拖曳。 */
export function drawResizeHandles(ctx: CanvasRenderingContext2D, rect: Rect, scale: number, color: string) {
    const size = HANDLE_SIZE / scale;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / scale;
    for (const x of [rect.x, rect.x + rect.w]) {
        for (const y of [rect.y, rect.y + rect.h]) {
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            ctx.strokeRect(x - size / 2, y - size / 2, size, size);
        }
    }
}
