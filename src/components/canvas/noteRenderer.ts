import { paintRuns } from "../code/highlight.ts";
import { languageLabel, noteLanguage } from "../code/languages.ts";
import { parseMarkdown } from "../../markdown/parse.ts";
import { serializeMarkdown } from "../../markdown/serialize.ts";
import { mediaUrl } from "../../media.ts";
import { noteTypeLabel } from "../../noteTypes.ts";
import type { Note, PlacedNote } from "../../types.ts";
import { layoutBlocks, layoutCode, type DrawCommand } from "./noteLayout.ts";
import type { PreviewImage } from "./notePreview.ts";

// 外觀要和 App.css 的卡片樣式保持一致，進出編輯時畫面才不會跳動。
const DEFAULT_COLOR = "#ffffff";
const CARD_BORDER = "#e2e0db";
const PLACEHOLDER_COLOR = "#f1f0ed";
const CODE_NOTE_COLOR = "#f6f8fa";
const CODE_LABEL_COLOR = "#57606a";
const CODE_LABEL_FONT = '400 11px "Segoe UI", "Microsoft JhengHei", sans-serif';
/** 語言名稱的基線相對於內文頂端，落在標題列中間，避開左右的按鈕。 */
const CODE_LABEL_Y = -12;
const WHITEBOARD_COLOR = "#eef0fc";
const WHITEBOARD_BORDER = "#d3d8f5";
const SHADOW_COLOR = "rgba(0, 0, 0, 0.08)";
const SHADOW_BLUR = 8;
const SHADOW_OFFSET_Y = 2;
const CARD_RADIUS = 8;
export const SELECTED_COLOR = "#4f5bd5";
const LAYOUT_CACHE_LIMIT = 500;
const PLAY_BADGE_RADIUS = 24;
const PLAY_BADGE_COLOR = "rgba(0, 0, 0, 0.55)";
export const NOTE_PADDING = 16;
/** 卡片上方額外留給按鈕的空間，內文不會被按鈕蓋住。編輯器的上內距要跟著一樣。 */
export const CARD_HEADER_HEIGHT = 16;
/** 摺疊後留下標題列和第一行。 */
export const COLLAPSED_CARD_HEIGHT = 72;

// 重畫（平移、縮放）時內容沒變，不必重新解析與量測文字。
const layoutCache = new Map<string, { commands: DrawCommand[]; height: number }>();

const cardImages = new Map<string, HTMLImageElement>();
let cardImageLoaded = () => {};

/** 卡片裡的圖片載入後要重畫白板。 */
export function onCardImageLoaded(redraw: () => void) {
    cardImageLoaded = redraw;
}

function cardImage(file: string): HTMLImageElement | null {
    let image = cardImages.get(file);
    if (!image) {
        image = new Image();
        image.onload = () => cardImageLoaded();
        image.src = mediaUrl(file);
        cardImages.set(file, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
}

function layoutFor(ctx: CanvasRenderingContext2D, text: string, width: number) {
    const key = `${width}\n${text}`;
    const cached = layoutCache.get(key);
    if (cached) return cached;

    if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear();
    const layout = layoutBlocks(ctx, parseMarkdown(text), width);
    layoutCache.set(key, layout);
    return layout;
}

function codeLayoutFor(ctx: CanvasRenderingContext2D, note: Note, width: number) {
    const language = noteLanguage(note);
    const key = `code\n${width}\n${language}\n${note.content}`;
    const cached = layoutCache.get(key);
    if (cached) return cached;

    if (layoutCache.size >= LAYOUT_CACHE_LIMIT) layoutCache.clear();
    const { commands, height } = layoutCode(ctx, paintRuns(note.content, language), width);
    const label: DrawCommand = {
        kind: "text",
        x: width / 2,
        y: CODE_LABEL_Y,
        text: languageLabel(language),
        font: CODE_LABEL_FONT,
        color: CODE_LABEL_COLOR,
        align: "center",
    };
    const layout = { commands: [label, ...commands], height };
    layoutCache.set(key, layout);
    return layout;
}

const fullHeight = (contentHeight: number, minHeight: number) =>
    Math.max(minHeight, Math.ceil(contentHeight) + NOTE_PADDING * 2 + CARD_HEADER_HEIGHT);

/** 這個寬度下放得下完整內容的卡片高度。 */
export function cardHeight(ctx: CanvasRenderingContext2D, text: string, width: number, minHeight: number) {
    return fullHeight(layoutFor(ctx, text, width - NOTE_PADDING * 2).height, minHeight);
}

/** 同上，內容是 Code Block。 */
export function codeHeight(ctx: CanvasRenderingContext2D, note: Note, width: number, minHeight: number) {
    return fullHeight(codeLayoutFor(ctx, note, width - NOTE_PADDING * 2).height, minHeight);
}

function cardPath(ctx: CanvasRenderingContext2D, placed: PlacedNote) {
    ctx.beginPath();
    ctx.roundRect(placed.x, placed.y, placed.w, placed.h, CARD_RADIUS);
}

function drawBox(
    ctx: CanvasRenderingContext2D,
    placed: PlacedNote,
    color: string,
    border: string,
    commands: DrawCommand[],
    headerHeight = 0,
) {
    ctx.save();
    // 陰影不受畫布變換影響，要自己乘上目前的縮放，縮放時才維持比例。
    const scale = ctx.getTransform().a;
    ctx.shadowColor = SHADOW_COLOR;
    ctx.shadowBlur = SHADOW_BLUR * scale;
    ctx.shadowOffsetY = SHADOW_OFFSET_Y * scale;
    ctx.fillStyle = color;
    cardPath(ctx, placed);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    cardPath(ctx, placed);
    ctx.stroke();

    ctx.save();
    cardPath(ctx, placed);
    ctx.clip();
    ctx.textBaseline = "alphabetic";

    const left = placed.x + NOTE_PADDING;
    const top = placed.y + NOTE_PADDING + headerHeight;
    for (const command of commands) {
        if (command.y > placed.h) continue;
        ctx.fillStyle = command.color;
        if (command.kind === "rect") {
            ctx.fillRect(left + command.x, top + command.y, command.w, command.h);
        } else if (command.kind === "image") {
            const image = cardImage(command.file);
            if (image) ctx.drawImage(image, left + command.x, top + command.y, command.w, command.h);
            else ctx.fillRect(left + command.x, top + command.y, command.w, command.h);
        } else {
            ctx.font = command.font;
            ctx.textAlign = command.align ?? "left";
            ctx.fillText(command.text, left + command.x, top + command.y);
        }
    }
    ctx.restore();
}

/** 依比例縮放，完整放進卡片內距以內並置中。 */
function drawPreview(ctx: CanvasRenderingContext2D, placed: PlacedNote, image: PreviewImage, padding = NOTE_PADDING) {
    const areaW = Math.max(placed.w - padding * 2, 1);
    const areaH = Math.max(placed.h - padding * 2, 1);
    const scale = Math.min(areaW / image.width, areaH / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    // 預覽通常縮小很多倍，預設品質會讓細線和中文糊掉。
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, placed.x + (placed.w - w) / 2, placed.y + (placed.h - h) / 2, w, h);
}

/** 圖片填滿整個框。框的比例和圖片不同時（例如摺疊）裁切上下左右，不留白也不變形。 */
function drawCover(ctx: CanvasRenderingContext2D, placed: PlacedNote, image: PreviewImage) {
    const scale = Math.max(placed.w / image.width, placed.h / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.save();
    cardPath(ctx, placed);
    ctx.clip();
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, placed.x + (placed.w - w) / 2, placed.y + (placed.h - h) / 2, w, h);
    ctx.restore();
}

/** 影片封面中央的播放符號，看得出這不是一般圖片。 */
function drawPlayBadge(ctx: CanvasRenderingContext2D, placed: PlacedNote) {
    const radius = Math.min(PLAY_BADGE_RADIUS, Math.min(placed.w, placed.h) / 4);
    const x = placed.x + placed.w / 2;
    const y = placed.y + placed.h / 2;
    ctx.fillStyle = PLAY_BADGE_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.35, y - radius * 0.5);
    ctx.lineTo(x + radius * 0.55, y);
    ctx.lineTo(x - radius * 0.35, y + radius * 0.5);
    ctx.closePath();
    ctx.fill();
}

const markdownCommands = (ctx: CanvasRenderingContext2D, text: string, placed: PlacedNote) =>
    layoutFor(ctx, text, placed.w - NOTE_PADDING * 2).commands;

/** 名稱是純文字，要跳脫後才不會被當成 Markdown 語法。 */
const headingOf = (text: string) => serializeMarkdown([{ type: "heading", level: 3, runs: [{ text }] }]);

/** `note` 為 null 表示資料已遺失；`preview` 是非卡片內容已經產生好的圖。 */
export function drawNote(
    ctx: CanvasRenderingContext2D,
    placed: PlacedNote,
    note: Note | null,
    selected: boolean,
    preview: PreviewImage | null = null,
) {
    if (note === null) {
        drawBox(ctx, placed, PLACEHOLDER_COLOR, CARD_BORDER, markdownCommands(ctx, "（筆記已遺失）", placed));
    } else if (note.type === "card") {
        const commands = markdownCommands(ctx, note.content, placed);
        drawBox(ctx, placed, placed.style.color ?? DEFAULT_COLOR, CARD_BORDER, commands, CARD_HEADER_HEIGHT);
    } else if (note.type === "code") {
        const { commands } = codeLayoutFor(ctx, note, placed.w - NOTE_PADDING * 2);
        drawBox(ctx, placed, CODE_NOTE_COLOR, CARD_BORDER, commands, CARD_HEADER_HEIGHT);
    } else if (note.type === "whiteboard") {
        drawBox(ctx, placed, WHITEBOARD_COLOR, WHITEBOARD_BORDER, markdownCommands(ctx, headingOf(note.content), placed));
    } else if (preview) {
        // 圖表直接畫在白板上，沒有卡片的底色與邊框。
        const bare = note.type === "mermaid" || note.type === "mindmap";
        if (!bare) drawBox(ctx, placed, DEFAULT_COLOR, CARD_BORDER, []);
        if (note.type === "image" || note.type === "video") drawCover(ctx, placed, preview);
        // 心智圖的版面自己有留白，就地編輯時節點才會和圖對齊。
        else drawPreview(ctx, placed, preview, note.type === "mindmap" ? 0 : NOTE_PADDING);
        if (note.type === "video") drawPlayBadge(ctx, placed);
    } else {
        drawBox(ctx, placed, PLACEHOLDER_COLOR, CARD_BORDER, markdownCommands(ctx, headingOf(noteTypeLabel(note.type)), placed));
    }

    if (selected) {
        ctx.strokeStyle = SELECTED_COLOR;
        ctx.lineWidth = 2;
        cardPath(ctx, placed);
        ctx.stroke();
    }
}
