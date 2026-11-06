// 投影片的座標固定在 1280×720，要和 Rust 的預設版面一致。縮放都在顯示時做。

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;
export const MIN_ELEMENT = 16;

export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** 把畫面塞進容器裡的縮放比例，比例不變形。 */
export function fitScale(width: number, height: number): number {
    return Math.max(Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT), 0.01);
}

/** 拖曳控制點後的新框。另一側固定不動，太小時停在最小尺寸。 */
export function resizeRect(rect: Rect, handle: Handle, dx: number, dy: number): Rect {
    let { x, y, w, h } = rect;
    if (handle.includes("e")) w = Math.max(rect.w + dx, MIN_ELEMENT);
    if (handle.includes("s")) h = Math.max(rect.h + dy, MIN_ELEMENT);
    if (handle.includes("w")) {
        w = Math.max(rect.w - dx, MIN_ELEMENT);
        x = rect.x + rect.w - w;
    }
    if (handle.includes("n")) {
        h = Math.max(rect.h - dy, MIN_ELEMENT);
        y = rect.y + rect.h - h;
    }
    return { x, y, w, h };
}

/** 靠近畫面中線時吸附，放置物件時容易對齊。 */
export function snapToCenter(rect: Rect, threshold: number): Rect {
    const near = (value: number, target: number) => Math.abs(value - target) <= threshold;
    return {
        ...rect,
        x: near(rect.x + rect.w / 2, STAGE_WIDTH / 2) ? (STAGE_WIDTH - rect.w) / 2 : rect.x,
        y: near(rect.y + rect.h / 2, STAGE_HEIGHT / 2) ? (STAGE_HEIGHT - rect.h) / 2 : rect.y,
    };
}
