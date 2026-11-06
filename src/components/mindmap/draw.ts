import * as api from "../../api.ts";
import type { MindNode } from "../../types.ts";
import type { PreviewRenderer } from "../canvas/notePreview.ts";
import { edgePath, edgePoint, layoutMindmap, nodeLook, type MindLayout, type PlacedMindNode } from "./layout.ts";

// 把心智圖畫成一張圖，白板與 Library 縮圖共用。外觀要和 App.css 的 `.mindmap-node` 一致。

const RASTER_LONG_SIDE = 1600;
const MAX_RASTER_SCALE = 3;
const TEXT_COLOR = "#26282c";
const EDGE_WIDTH = 2;
const BORDER_WIDTH = 1.5;
export const FOLD_DISTANCE = 12;
const BADGE_RADIUS = 9;
const BADGE_FONT = '11px "Segoe UI", sans-serif';

let measuring: CanvasRenderingContext2D | null = null;

/** 量文字的寬度，編輯器也用這個，版面才會和縮圖一樣。 */
export function measureText(text: string, font: string) {
    measuring ??= document.createElement("canvas").getContext("2d");
    if (!measuring) return text.length * 14;
    measuring.font = font;
    return measuring.measureText(text).width;
}

function drawNode(ctx: CanvasRenderingContext2D, node: PlacedMindNode) {
    const look = nodeLook(node);
    if (node.shapeKind !== "none") {
        ctx.beginPath();
        ctx.roundRect(node.x, node.y, node.w, node.h, look.radius);
        ctx.fillStyle = look.fill;
        ctx.fill();
        ctx.strokeStyle = look.border;
        ctx.lineWidth = BORDER_WIDTH;
        ctx.stroke();
    }

    const root = node.depth === 0;
    ctx.font = node.font;
    ctx.textAlign = root ? "center" : "left";
    ctx.fillStyle = TEXT_COLOR;
    const textX = root ? node.x + node.w / 2 : node.x + node.paddingX;
    node.lines.forEach((line, index) => {
        ctx.fillText(line, textX, node.y + node.paddingY + node.lineHeight * (index + 0.5));
    });

    if (node.hiddenCount === 0 || !node.out) return;
    const { x, y } = edgePoint(node, node.out, FOLD_DISTANCE);
    ctx.beginPath();
    ctx.arc(x, y, BADGE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = node.branchColor;
    ctx.fill();
    ctx.font = BADGE_FONT;
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(node.hiddenCount), x, y);
}

export function paintMindmap(layout: MindLayout) {
    const scale = Math.min(RASTER_LONG_SIDE / Math.max(layout.width, layout.height, 1), MAX_RASTER_SCALE);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(Math.round(layout.width * scale), 1);
    canvas.height = Math.max(Math.round(layout.height * scale), 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;

    ctx.scale(scale, scale);
    ctx.lineWidth = EDGE_WIDTH;
    ctx.lineCap = "round";
    for (const edge of layout.edges) {
        ctx.strokeStyle = edge.to.branchColor;
        ctx.stroke(new Path2D(edgePath(edge, layout.lineStyle)));
    }

    ctx.textBaseline = "middle";
    for (const node of layout.nodes) drawNode(ctx, node);
    return canvas;
}

export const paintNodes = (nodes: MindNode[]) => paintMindmap(layoutMindmap(nodes, measureText));

export const mindmapPreview: PreviewRenderer = {
    version: (note) => String(note.updatedAt),
    render: async (note) => paintNodes(await api.getMindmap(note.id)),
};
