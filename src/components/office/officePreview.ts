import * as api from "../../api.ts";
import { mediaUrl, imageInfo } from "../../media.ts";
import type { Note, SlideElement, WriterBlock } from "../../types.ts";
import { noteTitle } from "../../noteTypes.ts";
import type { PreviewRenderer } from "../canvas/notePreview.ts";
import { layoutChart, marksToSvg } from "../chart/layout.ts";
import { shapePath } from "../slides/shapes.ts";
import { STAGE_HEIGHT, STAGE_WIDTH } from "../slides/stage.ts";

// Writer、Excels、Slides 與圖表在白板上的圖。內容不在 note 裡，所以要向 Rust 讀。

const SCALE = 2;
const FONT = '"Segoe UI", "Microsoft JhengHei", sans-serif';
const INK = "#1f2328";
const MUTED = "#57606a";
const LINE = "#e2e0db";
const HEADER = "#f0efeb";
const SHEET_MARGIN = 12;
const SHEET_TITLE = 36;
const SHEET_MIN_WIDTH = 300;
const SHEET_MISSING_WIDTH = 460;
const SHEET_MISSING_HEIGHT = 240;
const SHEET_MAX_WIDTH = 1400;
const SHEET_MAX_HEIGHT = 1000;

let sheetRevision = 0;

/** 試算表改過，引用它的圖表要重畫。 */
export const bumpSheetRevision = () => {
    sheetRevision += 1;
};

function surface(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布");
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "top";
    return { canvas, ctx };
}

function clipped(ctx: CanvasRenderingContext2D, text: string, width: number) {
    if (ctx.measureText(text).width <= width) return text;
    let result = "";
    for (const char of text) {
        if (ctx.measureText(`${result}${char}…`).width > width) break;
        result += char;
    }
    return `${result}…`;
}

function wrapped(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        let line = "";
        for (const char of paragraph) {
            if (line && ctx.measureText(line + char).width > width) {
                lines.push(line);
                line = "";
            }
            line += char;
        }
        lines.push(line);
    }
    return lines;
}

const plain = (text: string) => text.replace(/\*\*|~~|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

const WRITER_STYLE: Record<string, { size: number; weight: number; gap: number }> = {
    h1: { size: 18, weight: 700, gap: 8 },
    h2: { size: 16, weight: 700, gap: 6 },
    h3: { size: 14, weight: 700, gap: 4 },
};

const EMBED_LABELS: Record<string, string> = { cells: "引入的格子", chart: "圖表", image: "圖片", table: "表格", toc: "目錄" };

const BULLETS: Record<string, string> = { bullet: "•", number: "•", todo: "☐", toggle: "▸" };

function paintWriter(note: Note, blocks: WriterBlock[]) {
    const width = 340;
    const height = 260;
    const { canvas, ctx } = surface(width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    let y = 14;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(clipped(ctx, noteTitle(note), width - 28), 14, y);
    y += 32;
    for (const block of blocks) {
        if (y > height - 16) break;
        const style = WRITER_STYLE[block.kind] ?? { size: 13, weight: 400, gap: 3 };
        ctx.font = `${style.weight} ${style.size}px ${FONT}`;
        ctx.fillStyle = block.kind === "quote" ? MUTED : INK;
        if (block.kind === "divider" || block.kind === "pagebreak") {
            ctx.fillStyle = LINE;
            ctx.fillRect(14, y + 6, width - 28, 1);
            y += 14;
            continue;
        }
        const left = 14 + block.indent * 14;
        const marker = BULLETS[block.kind];
        const text = !(block.kind in EMBED_LABELS) ? plain(block.text) : `〔${EMBED_LABELS[block.kind]}〕`;
        if (marker) ctx.fillText(marker, left, y);
        const offset = marker ? 14 : 0;
        for (const line of wrapped(ctx, text, width - left - offset - 14).slice(0, 4)) {
            ctx.fillText(line, left + offset, y);
            y += style.size + 5;
        }
        y += style.gap;
    }
    return canvas;
}

async function renderWriter(note: Note) {
    return paintWriter(note, await api.getWriter(note.id));
}

/** 卡片顯示一個表格。太大的表格只畫到上限，縮小後還要看得清楚。 */
async function renderSheet(note: Note, tableID?: string) {
    const state = await api.getSheet(note.id);
    const table = tableID ? state.tables.find((item) => item.id === tableID) : state.tables[0];
    if (!table) {
        const { canvas, ctx } = surface(SHEET_MISSING_WIDTH, SHEET_MISSING_HEIGHT);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, SHEET_MISSING_WIDTH, SHEET_MISSING_HEIGHT);
        ctx.font = `700 15px ${FONT}`;
        ctx.fillStyle = INK;
        ctx.fillText(clipped(ctx, noteTitle(note), SHEET_MISSING_WIDTH - SHEET_MARGIN * 2), SHEET_MARGIN, 10);
        ctx.font = `13px ${FONT}`;
        ctx.fillStyle = MUTED;
        ctx.fillText(tableID ? "這個表格已被刪除，可以從右鍵選單更換。" : "這份試算表還沒有表格。", SHEET_MARGIN, 44);
        return canvas;
    }
    const tableWidth = table.cols.reduce((sum, col) => sum + col.size, 0);
    const rows = table.rows.filter((row) => !table.hiddenRows.includes(row.id));
    const tableHeight = rows.reduce((sum, row) => sum + row.size, 0);
    const width = Math.min(Math.max(tableWidth + SHEET_MARGIN * 2, SHEET_MIN_WIDTH), SHEET_MAX_WIDTH);
    const height = Math.min(tableHeight + SHEET_TITLE + SHEET_MARGIN, SHEET_MAX_HEIGHT);
    const { canvas, ctx } = surface(width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.font = `700 15px ${FONT}`;
    ctx.fillStyle = INK;
    ctx.fillText(clipped(ctx, `${noteTitle(note)} · ${table.name}`, width - SHEET_MARGIN * 2), SHEET_MARGIN, 10);
    let y = SHEET_TITLE;
    rows.forEach((row) => {
        if (y >= height) return;
        const rowIndex = table.rows.indexOf(row);
        let x = SHEET_MARGIN;
        table.cols.forEach((col, colIndex) => {
            if (x >= width) return;
            const cell = table.cells[`${row.id}:${col.id}`];
            const header = rowIndex < table.headerRows || colIndex < table.headerCols;
            ctx.fillStyle = cell?.fill ?? (header ? HEADER : "#ffffff");
            ctx.fillRect(x, y, col.size, row.size);
            ctx.strokeStyle = LINE;
            ctx.strokeRect(x + 0.5, y + 0.5, col.size, row.size);
            if (cell?.display) {
                ctx.font = `${cell.bold || header ? 600 : 400} 12px ${FONT}`;
                ctx.fillStyle = cell.color ?? INK;
                const text = clipped(ctx, cell.display, col.size - 10);
                const measured = ctx.measureText(text).width;
                ctx.fillText(text, cell.kind === "number" ? x + col.size - measured - 5 : x + 5, y + (row.size - 14) / 2);
            }
            x += col.size;
        });
        y += row.size;
    });
    return canvas;
}

function loadImage(src: string) {
    const image = new Image();
    image.src = src;
    return image.decode().then(() => image);
}

async function paintElement(ctx: CanvasRenderingContext2D, element: SlideElement, images: Map<string, string>) {
    const { x, y, w, h } = element;
    if (element.kind === "image" && element.noteId) {
        const file = images.get(element.noteId);
        if (!file) return;
        ctx.drawImage(await loadImage(file), x, y, w, h);
        return;
    }
    if (element.kind === "chart" && element.noteId) {
        const data = await api.getChart(element.noteId);
        const svg = marksToSvg(layoutChart(data, w, h), w, h);
        ctx.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), x, y, w, h);
        return;
    }
    if (element.kind === "cells") {
        ctx.strokeStyle = LINE;
        ctx.strokeRect(x, y, w, h);
        ctx.fillStyle = MUTED;
        ctx.font = `24px ${FONT}`;
        ctx.fillText("引入的格子", x + 16, y + 16);
        return;
    }
    if (element.kind === "shape") {
        const path = new Path2D(shapePath(element.shape ?? "rect", x, y, w, h));
        if (element.fill) {
            ctx.fillStyle = element.fill;
            ctx.fill(path);
        }
        if (element.stroke || element.shape === "line") {
            ctx.strokeStyle = element.stroke || element.fill || INK;
            ctx.lineWidth = 3;
            ctx.stroke(path);
        }
    }
    if (!element.text) return;
    ctx.font = `${element.italic ? "italic " : ""}${element.bold ? 700 : 400} ${element.fontSize}px ${FONT}`;
    ctx.fillStyle = element.color ?? INK;
    const lines = wrapped(ctx, element.text, w).slice(0, Math.floor(h / (element.fontSize * 1.3)) + 1);
    const height = lines.length * element.fontSize * 1.3;
    const top = element.valign === "middle" ? y + (h - height) / 2 : element.valign === "bottom" ? y + h - height : y;
    lines.forEach((line, index) => {
        const measured = ctx.measureText(line).width;
        const left = element.align === "center" ? x + (w - measured) / 2 : element.align === "right" ? x + w - measured : x;
        ctx.fillText(line, left, top + index * element.fontSize * 1.3);
    });
}

async function renderSlides(note: Note) {
    const { slides } = await api.getSlides(note.id);
    const slide = slides[0];
    const width = 480;
    const height = 270;
    const { canvas, ctx } = surface(width, height);
    if (!slide) return canvas;
    ctx.fillStyle = slide.background;
    ctx.fillRect(0, 0, width, height);
    const notes = await api.getNoteLibrary();
    const images = new Map<string, string>();
    for (const item of notes) {
        const info = item.type === "image" ? imageInfo(item) : null;
        if (info) images.set(item.id, mediaUrl(info.file));
    }
    ctx.save();
    ctx.scale(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    for (const element of slide.elements) await paintElement(ctx, element, images);
    ctx.restore();
    return canvas;
}

async function renderChart(note: Note) {
    const data = await api.getChart(note.id);
    const width = 460;
    const height = 300;
    const { canvas, ctx } = surface(width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const svg = marksToSvg(layoutChart(data, width, height), width, height);
    ctx.drawImage(await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`), 0, 0, width, height);
    return canvas;
}

const byUpdate = (note: Note) => String(note.updatedAt);

export const writerPreview: PreviewRenderer = { version: byUpdate, render: renderWriter };
export const sheetPreview: PreviewRenderer = { version: byUpdate, render: renderSheet };
export const slidesPreview: PreviewRenderer = {
    version: (note) => `${note.updatedAt}:${sheetRevision}`,
    render: renderSlides,
};
export const chartPreview: PreviewRenderer = {
    version: (note) => `${note.updatedAt}:${sheetRevision}`,
    render: renderChart,
};
