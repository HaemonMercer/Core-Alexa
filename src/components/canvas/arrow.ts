import type { ArrowDirection } from "../../types.ts";
import type { Rect } from "./resize.ts";
import { intersects } from "./snap.ts";

// 通用的「兩個矩形之間的連線」：只處理矩形和線段，不認識筆記。
// 座標都是世界座標；`scale` 是視圖縮放，用來讓滑鼠的判定範圍和連接點在螢幕上維持固定大小。

export interface Point {
    x: number;
    y: number;
}

export interface Segment {
    from: Point;
    to: Point;
}

const LINE_WIDTH = 2;
const HEAD_LENGTH = 12;
const HEAD_ANGLE = Math.PI / 7;
const HIT_DISTANCE = 6;
const CONNECTOR_OFFSET = 18;
const CONNECTOR_RADIUS = 5;
const CONNECTOR_HIT = 9;
const LABEL_FONT = '12px "Segoe UI", "Microsoft JhengHei", sans-serif';
const LABEL_HEIGHT = 20;
const LABEL_PADDING = 6;
const LABEL_BACKGROUND = "#ffffff";
const LABEL_COLOR = "#57606a";

export const centerOf = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

export const midpoint = ({ from, to }: Segment): Point => ({
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
});

/** 從矩形中心朝 `toward` 出發，碰到邊框的位置。 */
export function borderPoint(rect: Rect, toward: Point): Point {
    const center = centerOf(rect);
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    if (dx === 0 && dy === 0) return center;
    const distance = Math.min(rect.w / 2 / Math.abs(dx), rect.h / 2 / Math.abs(dy));
    return { x: center.x + dx * distance, y: center.y + dy * distance };
}

/** 線只畫在兩個矩形之間，所以會跟著筆記移動；重疊時沒有線可畫，回傳 null。 */
export function connect(from: Rect, to: Rect): Segment | null {
    if (intersects(from, to)) return null;
    return { from: borderPoint(from, centerOf(to)), to: borderPoint(to, centerOf(from)) };
}

export function distanceToSegment(point: Point, { from, to }: Segment): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const along = lengthSquared === 0
        ? 0
        : ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
    const clamped = Math.min(1, Math.max(0, along));
    return Math.hypot(point.x - (from.x + dx * clamped), point.y - (from.y + dy * clamped));
}

export const hitsSegment = (point: Point, segment: Segment, scale: number) =>
    distanceToSegment(point, segment) <= HIT_DISTANCE / scale;

/** 四邊外側的連接點，留在控制點的判定範圍之外，拉線才不會變成調整大小。 */
export function connectorPoints(rect: Rect, scale: number): Point[] {
    const offset = CONNECTOR_OFFSET / scale;
    const { x, y } = centerOf(rect);
    return [
        { x, y: rect.y - offset },
        { x: rect.x + rect.w + offset, y },
        { x, y: rect.y + rect.h + offset },
        { x: rect.x - offset, y },
    ];
}

export const hitConnector = (rect: Rect, point: Point, scale: number): boolean =>
    connectorPoints(rect, scale).some(
        (dot) => Math.hypot(point.x - dot.x, point.y - dot.y) <= CONNECTOR_HIT / scale,
    );

/** 滑鼠從筆記往連接點移動時會經過這段空隙，連接點不能在這裡消失。 */
export function nearConnectors(rect: Rect, { x, y }: Point, scale: number): boolean {
    const reach = (CONNECTOR_OFFSET + CONNECTOR_HIT) / scale;
    return x >= rect.x - reach && x <= rect.x + rect.w + reach
        && y >= rect.y - reach && y <= rect.y + rect.h + reach;
}

export function drawConnectors(ctx: CanvasRenderingContext2D, rect: Rect, scale: number, color: string) {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5 / scale;
    for (const { x, y } of connectorPoints(rect, scale)) {
        ctx.beginPath();
        ctx.arc(x, y, CONNECTOR_RADIUS / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }
}

function drawHead(ctx: CanvasRenderingContext2D, tip: Point, tail: Point) {
    const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    for (const side of [HEAD_ANGLE, -HEAD_ANGLE]) {
        ctx.lineTo(
            tip.x - HEAD_LENGTH * Math.cos(angle + side),
            tip.y - HEAD_LENGTH * Math.sin(angle + side),
        );
    }
    ctx.closePath();
    ctx.fill();
}

function drawLabel(ctx: CanvasRenderingContext2D, segment: Segment, label: string) {
    const { x, y } = midpoint(segment);
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = ctx.measureText(label).width + LABEL_PADDING * 2;
    ctx.fillStyle = LABEL_BACKGROUND;
    ctx.fillRect(x - width / 2, y - LABEL_HEIGHT / 2, width, LABEL_HEIGHT);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(label, x, y);
}

export function drawArrow(
    ctx: CanvasRenderingContext2D,
    segment: Segment,
    direction: ArrowDirection,
    label: string,
    color: string,
) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();

    if (direction === "forward" || direction === "both") drawHead(ctx, segment.to, segment.from);
    if (direction === "backward" || direction === "both") drawHead(ctx, segment.from, segment.to);
    if (label) drawLabel(ctx, segment, label);
}

/** 拉線途中的虛線，放開之前還不是一條箭頭。 */
export function drawLinkPreview(
    ctx: CanvasRenderingContext2D,
    segment: Segment,
    scale: number,
    color: string,
) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = LINE_WIDTH / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.beginPath();
    ctx.moveTo(segment.from.x, segment.from.y);
    ctx.lineTo(segment.to.x, segment.to.y);
    ctx.stroke();
    ctx.restore();
}
