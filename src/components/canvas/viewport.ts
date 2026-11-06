import type { Point } from "./arrow.ts";
import type { Rect } from "./resize.ts";

/** 視圖狀態：螢幕座標 = 世界座標 * scale + (x, y)。這裡的螢幕座標都相對於畫布左上角。 */
export interface View {
    x: number;
    y: number;
    scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
const ZOOM_STEP = 1.1;
const MIN_GRID_STEP = 12;
const MAX_GRID_STEP = 48;

export const toWorld = (view: View, screenX: number, screenY: number): Point => ({
    x: (screenX - view.x) / view.scale,
    y: (screenY - view.y) / view.scale,
});

export const toScreen = (view: View, worldX: number, worldY: number): Point => ({
    x: worldX * view.scale + view.x,
    y: worldY * view.scale + view.y,
});

export const visibleWorld = (view: View, width: number, height: number): Rect => ({
    ...toWorld(view, 0, 0),
    w: width / view.scale,
    h: height / view.scale,
});

/** 以螢幕上的一點為中心縮放，同一個世界座標仍留在那一點。 */
export function zoomAt(view: View, screenX: number, screenY: number, zoomIn: boolean): View {
    const world = toWorld(view, screenX, screenY);
    const factor = zoomIn ? ZOOM_STEP : 1 / ZOOM_STEP;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    return { x: screenX - world.x * scale, y: screenY - world.y * scale, scale };
}

/** 格線間距維持在固定範圍內，縮放時才不會太密或太疏。 */
export function gridStep(gridSize: number, scale: number): number {
    let step = gridSize * scale;
    while (step < MIN_GRID_STEP) step *= 2;
    while (step > MAX_GRID_STEP) step /= 2;
    return step;
}
