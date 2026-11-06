import type { Block, ImageBlock, Run } from "../../markdown/ast.ts";
import { paintRuns } from "../code/highlight.ts";
import { fenceToLanguage } from "../code/languages.ts";

// 把 Markdown 排版成畫布的繪製指令。
// 字級、行高與間距要和 App.css 的 .note-editor 保持一致，進出編輯時畫面才不會跳動。

const SANS = '"Segoe UI", "Microsoft JhengHei", sans-serif';
const MONO = '"Cascadia Code", Consolas, "Microsoft JhengHei", monospace';

const INK = "#1f2328";
const MUTED = "#57606a";
const LINK = "#4f5bd5";
const CODE_BACKGROUND = "rgba(0, 0, 0, 0.07)";
const RULE_COLOR = "rgba(0, 0, 0, 0.25)";
const QUOTE_BAR = "rgba(0, 0, 0, 0.2)";

const BODY = { size: 14, lineHeight: 20, weight: 400 };
const HEADINGS = [
    { size: 22, lineHeight: 30, weight: 700 },
    { size: 19, lineHeight: 26, weight: 700 },
    { size: 16, lineHeight: 22, weight: 700 },
    { size: 14, lineHeight: 20, weight: 700 },
    { size: 14, lineHeight: 20, weight: 700 },
    { size: 14, lineHeight: 20, weight: 700 },
];
const CODE_SIZE = 13;
const CODE_LINE_HEIGHT = 18;
const CODE_PADDING_X = 8;
const CODE_PADDING_Y = 6;
const BLOCK_GAP = 6;
const ITEM_GAP = 2;
const LIST_INDENT = 22;
const QUOTE_BAR_WIDTH = 3;
const QUOTE_INDENT = 13;
const BULLETS = ["•", "◦", "▪"];
const CELL_PADDING_X = 8;
const CELL_PADDING_Y = 4;
const CELL_LINE = "rgba(0, 0, 0, 0.15)";
const HEADER_BACKGROUND = "rgba(0, 0, 0, 0.04)";
const IMAGE_PLACEHOLDER = "rgba(0, 0, 0, 0.05)";
/** 和 `.writer-image` 的 max-height 相同。 */
const MAX_IMAGE_HEIGHT = 420;
const CHECKED_MARKER = "☑";

export type DrawCommand =
    | { kind: "text"; x: number; y: number; text: string; font: string; color: string; align?: CanvasTextAlign }
    | { kind: "rect"; x: number; y: number; w: number; h: number; color: string }
    /** 圖片載入前先畫 `color` 的方塊。 */
    | { kind: "image"; x: number; y: number; w: number; h: number; color: string; file: string };

interface TextStyle {
    size: number;
    lineHeight: number;
    weight: number;
    color?: string;
    /** 程式碼區塊已有整塊底色，不畫行內程式碼的底色。 */
    plainCode?: boolean;
}

/** 程式碼的每段文字有自己的顏色。 */
export type PaintRun = Run & { color?: string };

interface Fragment {
    run: PaintRun;
    text: string;
    font: string;
    width: number;
}

/** 圖片在卡片裡的大小，規則和 `.writer-image` 相同：不放大，太高時等比例縮小。 */
export function imageBox(block: ImageBlock, available: number) {
    const ratio = block.width > 0 && block.height > 0 ? block.height / block.width : 1;
    const wanted = block.percent === null ? Math.min(block.width || available, available) : available * block.percent / 100;
    const h = Math.min(wanted * ratio, MAX_IMAGE_HEIGHT);
    return { w: h / ratio, h };
}

const fontFor = (run: Run, style: TextStyle) => {
    const weight = run.bold ? 700 : style.weight;
    const italic = run.italic ? "italic " : "";
    return run.code
        ? `${italic}${weight} ${style.size - 1}px ${MONO}`
        : `${italic}${weight} ${style.size}px ${SANS}`;
};

// 英數連在一起不換行，其他字元（如中文）可在任何字之間換行。
const tokenize = (text: string) => text.match(/\n|[ \t]+|[!-ɏ]+|[^]/gu) ?? [];

class Layout {
    readonly commands: DrawCommand[] = [];
    private readonly ctx: CanvasRenderingContext2D;

    constructor(ctx: CanvasRenderingContext2D) {
        this.ctx = ctx;
    }

    private measure(text: string, font: string) {
        this.ctx.font = font;
        return this.ctx.measureText(text).width;
    }

    private flushLine(line: Fragment[], x: number, y: number, style: TextStyle) {
        let cursor = x;
        const baseline = y + style.lineHeight / 2 + style.size * 0.35;

        for (let i = 0; i < line.length; ) {
            const { run, font } = line[i];
            let text = "";
            for (; i < line.length && line[i].run === run; i += 1) text += line[i].text;
            const width = this.measure(text, font);
            const color = run.href !== undefined ? LINK : run.color ?? style.color ?? INK;

            if (run.code && !style.plainCode) {
                this.commands.push({
                    kind: "rect", x: cursor, y: y + 1, w: width, h: style.lineHeight - 2, color: CODE_BACKGROUND,
                });
            }
            this.commands.push({ kind: "text", x: cursor, y: baseline, text, font, color });
            if (run.href !== undefined) {
                this.commands.push({ kind: "rect", x: cursor, y: baseline + 2, w: width, h: 1, color });
            }
            if (run.strike) {
                const middle = baseline - style.size * 0.3;
                this.commands.push({ kind: "rect", x: cursor, y: middle, w: width, h: 1, color });
            }
            cursor += width;
        }
    }

    inline(runs: PaintRun[], x: number, y: number, width: number, style: TextStyle): number {
        let line: Fragment[] = [];
        let lineWidth = 0;
        let top = y;

        const endLine = () => {
            this.flushLine(line, x, top, style);
            top += style.lineHeight;
            line = [];
            lineWidth = 0;
        };

        const place = (run: PaintRun, text: string, font: string) => {
            const tokenWidth = this.measure(text, font);
            // 行尾的空白和 pre-wrap 一樣懸在外面，不另外換行。
            if (line.length > 0 && lineWidth + tokenWidth > width && text.trim()) endLine();
            line.push({ run, text, font, width: tokenWidth });
            lineWidth += tokenWidth;
        };

        for (const run of runs) {
            const font = fontFor(run, style);
            for (const token of tokenize(run.text)) {
                if (token === "\n") {
                    endLine();
                } else if (token.trim() && this.measure(token, font) > width) {
                    for (const char of token) place(run, char, font);
                } else {
                    place(run, token, font);
                }
            }
        }
        endLine();
        return top;
    }

    private code(text: string, language: string, x: number, y: number, width: number): number {
        const background: DrawCommand = { kind: "rect", x, y, w: width, h: 0, color: CODE_BACKGROUND };
        this.commands.push(background);
        const bottom = this.inline(
            paintRuns(text, fenceToLanguage(language)),
            x + CODE_PADDING_X,
            y + CODE_PADDING_Y,
            width - CODE_PADDING_X * 2,
            { size: CODE_SIZE + 1, lineHeight: CODE_LINE_HEIGHT, weight: 400, plainCode: true },
        );
        background.h = bottom + CODE_PADDING_Y - y;
        return y + background.h;
    }

    private list(block: Extract<Block, { type: "list" }>, x: number, y: number, width: number, depth: number): number {
        let top = y;
        block.items.forEach((item, index) => {
            if (index > 0) top += ITEM_GAP;
            const baseline = top + BODY.lineHeight / 2 + BODY.size * 0.35;
            const font = `400 ${BODY.size}px ${SANS}`;
            const marker = block.markers?.[index];
            const label = block.ordered
                ? `${block.start + index}.`
                : marker ?? BULLETS[Math.min(depth, BULLETS.length - 1)];
            this.commands.push({
                kind: "text", x: x + LIST_INDENT - 6, y: baseline, text: label, font, color: INK, align: "right",
            });
            const color = marker === CHECKED_MARKER ? MUTED : undefined;
            top = this.blocks(item, x + LIST_INDENT, top, width - LIST_INDENT, ITEM_GAP, depth + 1, color);
        });
        return top;
    }

    private table(block: Extract<Block, { type: "table" }>, x: number, y: number, width: number): number {
        const columns = block.rows[0]?.length || 1;
        const cellWidth = width / columns;
        let top = y;
        block.rows.forEach((row, index) => {
            const background: DrawCommand = { kind: "rect", x, y: top, w: width, h: 0, color: index === 0 ? HEADER_BACKGROUND : "transparent" };
            this.commands.push(background, { kind: "rect", x, y: top, w: width, h: 1, color: CELL_LINE });
            const style = { ...BODY, weight: index === 0 ? 700 : BODY.weight };
            const bottoms = row.map((cell, column) => this.inline(
                cell,
                x + column * cellWidth + CELL_PADDING_X,
                top + CELL_PADDING_Y,
                cellWidth - CELL_PADDING_X * 2,
                style,
            ));
            const bottom = Math.max(...bottoms) + CELL_PADDING_Y;
            background.h = bottom - top;
            top = bottom;
        });
        this.commands.push({ kind: "rect", x, y: top, w: width, h: 1, color: CELL_LINE });
        for (let column = 0; column <= columns; column += 1) {
            this.commands.push({ kind: "rect", x: x + Math.min(column * cellWidth, width - 1), y, w: 1, h: top - y, color: CELL_LINE });
        }
        return top + 1;
    }

    blocks(blocks: Block[], x: number, y: number, width: number, gap: number, depth: number, color?: string): number {
        let top = y;
        blocks.forEach((block, index) => {
            if (index > 0) top += gap;
            switch (block.type) {
                case "paragraph":
                    top = this.inline(block.runs, x, top, width, { ...BODY, color });
                    break;
                case "heading":
                    top = this.inline(block.runs, x, top, width, { ...HEADINGS[block.level - 1], color });
                    break;
                case "code":
                    top = this.code(block.text, block.language, x, top, width);
                    break;
                case "rule":
                    this.commands.push({ kind: "rect", x, y: top, w: width, h: 1, color: RULE_COLOR });
                    top += 1;
                    break;
                case "quote": {
                    const start = top;
                    top = this.blocks(block.blocks, x + QUOTE_INDENT, top, width - QUOTE_INDENT, BLOCK_GAP, depth, MUTED);
                    this.commands.push({
                        kind: "rect", x, y: start, w: QUOTE_BAR_WIDTH, h: top - start, color: QUOTE_BAR,
                    });
                    break;
                }
                case "list":
                    top = this.list(block, x, top, width, depth);
                    break;
                case "table":
                    top = this.table(block, x, top, width);
                    break;
                case "image": {
                    const { w, h } = imageBox(block, width);
                    this.commands.push({ kind: "image", x, y: top, w, h, color: IMAGE_PLACEHOLDER, file: block.file });
                    top += h;
                    break;
                }
            }
        });
        return top;
    }
}

/** `height` 是整份內容的高度；空白內容也算一行，編輯時才放得下游標。 */
export function layoutBlocks(
    ctx: CanvasRenderingContext2D,
    blocks: Block[],
    width: number,
): { commands: DrawCommand[]; height: number } {
    const layout = new Layout(ctx);
    const bottom = layout.blocks(blocks, 0, 0, width, BLOCK_GAP, 0);
    return { commands: layout.commands, height: Math.max(bottom, BODY.lineHeight) };
}

/** Code Block 的內容，字級和行高與 Markdown 的程式碼區塊相同。 */
export function layoutCode(
    ctx: CanvasRenderingContext2D,
    runs: PaintRun[],
    width: number,
): { commands: DrawCommand[]; height: number } {
    const layout = new Layout(ctx);
    const style = { size: CODE_SIZE + 1, lineHeight: CODE_LINE_HEIGHT, weight: 400, plainCode: true };
    return { commands: layout.commands, height: layout.inline(runs, 0, 0, width, style) };
}
