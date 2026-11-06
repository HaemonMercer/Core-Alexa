import type { Arrow, Note, PlacedNote } from "../../types.ts";
import {
    borderPoint,
    centerOf,
    drawArrow,
    drawConnectors,
    drawLinkPreview,
    type Segment,
} from "./arrow.ts";
import { marqueeRect, type LinkGesture, type MarqueeGesture } from "./gestures.ts";
import type { PreviewImage } from "./notePreview.ts";
import { drawNote, SELECTED_COLOR } from "./noteRenderer.ts";
import { drawResizeHandles } from "./resize.ts";
import { drawGuides, intersects, type Guide } from "./snap.ts";
import { gridStep, visibleWorld, type View } from "./viewport.ts";

const GUIDE_COLOR = "#d6249f";
const ARROW_COLOR = "#8a8f98";
const MARQUEE_FILL = "rgba(79, 91, 213, 0.1)";

export interface Scene {
    view: View;
    notes: PlacedNote[];
    noteData: Record<string, Note | null>;
    /** 正在就地編輯的筆記，由疊在上面的編輯器顯示。 */
    hiddenID: string | null;
    previewOf: (note: Note, variant?: string) => PreviewImage | null;
    arrows: { arrow: Arrow; segment: Segment }[];
    selection: Set<string>;
    selectedArrow: string | null;
    /** 顯示調整大小控制點的筆記。 */
    resizable?: PlacedNote;
    /** 顯示連接點的筆記。 */
    connectable?: PlacedNote;
    linking: LinkGesture | null;
    guides: Guide[];
    marquee: MarqueeGesture | null;
}

function drawGrid(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    view: View,
    dpr: number,
) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    // 從 CSS 讀取樣式
    const style = getComputedStyle(canvas);
    const gridColor = style.getPropertyValue("--grid-color").trim();
    const gridSize = parseFloat(style.getPropertyValue("--grid-size")) || 24;
    const step = gridStep(gridSize, view.scale);

    ctx.fillStyle = gridColor;
    for (let x = ((view.x % step) + step) % step; x < w; x += step) {
        ctx.fillRect(Math.round(x * dpr) / dpr, 0, 1 / dpr, h);
    }
    for (let y = ((view.y % step) + step) % step; y < h; y += step) {
        ctx.fillRect(0, Math.round(y * dpr) / dpr, w, 1 / dpr);
    }
}

function drawLinking(
    ctx: CanvasRenderingContext2D,
    { fromID, pointer, targetID }: LinkGesture,
    notes: PlacedNote[],
    scale: number,
) {
    const from = notes.find((placed) => placed.id === fromID);
    const target = notes.find((placed) => placed.id === targetID);
    if (!from) return;
    const end = target ? centerOf(target) : pointer;
    drawLinkPreview(
        ctx,
        { from: borderPoint(from, end), to: target ? borderPoint(target, centerOf(from)) : pointer },
        scale,
        SELECTED_COLOR,
    );
    if (target) {
        ctx.strokeStyle = SELECTED_COLOR;
        ctx.lineWidth = 2 / scale;
        ctx.strokeRect(target.x, target.y, target.w, target.h);
    }
}

function drawMarquee(ctx: CanvasRenderingContext2D, marquee: MarqueeGesture, scale: number) {
    const area = marqueeRect(marquee);
    ctx.fillStyle = MARQUEE_FILL;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(area.x, area.y, area.w, area.h);
}

export function drawScene(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, scene: Scene) {
    const { view } = scene;
    const dpr = window.devicePixelRatio;

    // 背景交給 CSS，這裡只清空畫布
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    drawGrid(ctx, canvas, view, dpr);

    ctx.setTransform(
        dpr * view.scale, 0,
        0, dpr * view.scale,
        dpr * view.x, dpr * view.y,
    );

    // 線畫在筆記底下，第三張筆記擋在中間時不會蓋住文字。
    for (const { arrow, segment } of scene.arrows) {
        const color = arrow.id === scene.selectedArrow ? SELECTED_COLOR : ARROW_COLOR;
        drawArrow(ctx, segment, arrow.direction, arrow.label, color);
    }

    const viewport = visibleWorld(view, canvas.clientWidth, canvas.clientHeight);
    for (const placed of scene.notes) {
        if (placed.id === scene.hiddenID || !intersects(placed, viewport)) continue;
        const note = scene.noteData[placed.noteID] ?? null;
        drawNote(ctx, placed, note, scene.selection.has(placed.id), note && scene.previewOf(note, placed.tableID ?? undefined));
    }

    // 畫在所有筆記之上，選取的筆記被蓋住時控制點仍然看得到、拖得到。
    if (scene.resizable) drawResizeHandles(ctx, scene.resizable, view.scale, SELECTED_COLOR);
    if (scene.connectable) drawConnectors(ctx, scene.connectable, view.scale, SELECTED_COLOR);
    if (scene.linking) drawLinking(ctx, scene.linking, scene.notes, view.scale);
    drawGuides(ctx, scene.guides, view.scale, GUIDE_COLOR);
    if (scene.marquee) drawMarquee(ctx, scene.marquee, view.scale);
}
