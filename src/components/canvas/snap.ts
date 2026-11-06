// 通用的輔助對齊：只處理矩形，不認識筆記，移動和調整大小都共用。
// 座標都是世界座標；`scale` 是視圖縮放，讓吸附距離在螢幕上維持固定。

import type { Rect, ResizeHandle } from "./resize.ts";

export interface Snap {
    x: number;
    y: number;
}

export interface Guide {
    axis: "x" | "y";
    at: number;
    from: number;
    to: number;
}

const SNAP_DISTANCE = 6;
const SAME_POSITION = 0.01;

export const NO_SNAP: Snap = { x: 0, y: 0 };

const stopsX = (rect: Rect) => [rect.x, rect.x + rect.w / 2, rect.x + rect.w];
const stopsY = (rect: Rect) => [rect.y, rect.y + rect.h / 2, rect.y + rect.h];

/** 找出把任一 `values` 對上任一 `targets` 所需的最小位移，超出範圍時回傳 0。 */
function nearestOffset(values: number[], targets: number[], reach: number): number {
    let best = 0;
    let bestDistance = reach;
    for (const value of values) {
        for (const target of targets) {
            const distance = Math.abs(target - value);
            if (distance < bestDistance) {
                best = target - value;
                bestDistance = distance;
            }
        }
    }
    return best;
}

/** 移動中的矩形：左、中、右與上、中、下都能對齊其他矩形。 */
export function snapMove(rect: Rect, others: Rect[], scale: number): Snap {
    const reach = SNAP_DISTANCE / scale;
    return {
        x: nearestOffset(stopsX(rect), others.flatMap(stopsX), reach),
        y: nearestOffset(stopsY(rect), others.flatMap(stopsY), reach),
    };
}

/** 調整大小中的矩形：只有被拖動的邊會吸附。 */
export function snapResize(rect: Rect, handle: ResizeHandle, others: Rect[], scale: number): Snap {
    const reach = SNAP_DISTANCE / scale;
    const edgesX = handle.includes("e") ? [rect.x + rect.w] : handle.includes("w") ? [rect.x] : [];
    const edgesY = handle.includes("s") ? [rect.y + rect.h] : handle.includes("n") ? [rect.y] : [];
    return {
        x: nearestOffset(edgesX, others.flatMap(stopsX), reach),
        y: nearestOffset(edgesY, others.flatMap(stopsY), reach),
    };
}

/** 依矩形的最終位置算出參考線，畫面上的線一定代表真的對齊。 */
export function findGuides(rect: Rect, others: Rect[]): Guide[] {
    const lines = new Map<string, Guide>();
    const collect = (
        axis: Guide["axis"],
        own: number[],
        stops: (other: Rect) => number[],
        span: (other: Rect) => [number, number],
    ) => {
        for (const at of own) {
            for (const other of others) {
                if (!stops(other).some((stop) => Math.abs(stop - at) < SAME_POSITION)) continue;
                const [from, to] = span(other);
                const key = `${axis}${at.toFixed(2)}`;
                const line = lines.get(key);
                lines.set(key, {
                    axis,
                    at,
                    from: Math.min(from, line?.from ?? from),
                    to: Math.max(to, line?.to ?? to),
                });
            }
        }
    };

    collect("x", stopsX(rect), stopsX, (other) => [
        Math.min(rect.y, other.y),
        Math.max(rect.y + rect.h, other.y + other.h),
    ]);
    collect("y", stopsY(rect), stopsY, (other) => [
        Math.min(rect.x, other.x),
        Math.max(rect.x + rect.w, other.x + other.w),
    ]);
    return [...lines.values()];
}

export function drawGuides(ctx: CanvasRenderingContext2D, guides: Guide[], scale: number, color: string) {
    ctx.fillStyle = color;
    const thickness = 1.5 / scale;
    for (const { axis, at, from, to } of guides) {
        if (axis === "x") ctx.fillRect(at - thickness / 2, from, thickness, to - from);
        else ctx.fillRect(from, at - thickness / 2, to - from, thickness);
    }
}

/** 涵蓋所有矩形的最小範圍；`rects` 不可為空。 */
export function boundsOf(rects: Rect[]): Rect {
    const x = Math.min(...rects.map((rect) => rect.x));
    const y = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.w));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
    return { x, y, w: right - x, h: bottom - y };
}

export const intersects = (a: Rect, b: Rect) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
