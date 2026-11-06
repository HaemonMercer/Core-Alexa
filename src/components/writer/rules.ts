import type { BlockSide, WriterBlock } from "../../types.ts";

// Writer 編輯時的判斷，不碰 DOM，可以直接測試。

export type TextKind = "paragraph" | "h1" | "h2" | "h3" | "bullet" | "number" | "todo" | "toggle" | "quote" | "callout" | "code";

export interface SlashCommand {
    id: string;
    label: string;
    hint: string;
    /** 比對時用的別名，中英文都能找到。 */
    keywords: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
    { id: "paragraph", label: "文字", hint: "一般段落", keywords: "text paragraph 段落 內文" },
    { id: "h1", label: "標題 1", hint: "最大的標題", keywords: "h1 heading title 大標" },
    { id: "h2", label: "標題 2", hint: "中型標題", keywords: "h2 heading" },
    { id: "h3", label: "標題 3", hint: "小型標題", keywords: "h3 heading" },
    { id: "bullet", label: "項目符號清單", hint: "簡單的清單", keywords: "bullet list ul 清單" },
    { id: "number", label: "編號清單", hint: "有順序的清單", keywords: "number ordered list ol 清單" },
    { id: "todo", label: "待辦清單", hint: "可以打勾的項目", keywords: "todo check task 待辦 核取" },
    { id: "toggle", label: "折疊清單", hint: "可以收合內容", keywords: "toggle collapse 折疊 收合" },
    { id: "quote", label: "引言", hint: "引用一段文字", keywords: "quote 引用" },
    { id: "callout", label: "標註", hint: "醒目的提示框", keywords: "callout info 提示 重點" },
    { id: "code", label: "程式碼", hint: "等寬字體的區塊", keywords: "code pre 程式" },
    { id: "divider", label: "分隔線", hint: "分開不同段落", keywords: "divider line hr 分隔" },
    { id: "pagebreak", label: "換頁", hint: "後面的內容從下一頁開始 (Ctrl+Enter)", keywords: "page break 分頁 換頁 下一頁" },
    { id: "toc", label: "目錄", hint: "依標題自動產生，含頁碼", keywords: "toc contents 目錄 大綱" },
    { id: "table", label: "表格", hint: "可以直接編輯的表格", keywords: "table grid 表格" },
    { id: "cells", label: "引入格子", hint: "連結 Excels 的格子，改了會同步", keywords: "sheet excel cells 試算表 引入 連結" },
    { id: "chart", label: "圖表", hint: "引入試算表產生的圖表", keywords: "chart graph 圖表" },
    { id: "image", label: "圖片", hint: "引入 Library 裡的圖片", keywords: "image picture 圖片" },
];

/** 卡片沒有紙，也畫不出引入 Excels 的內容。 */
const NOT_ON_CARDS = ["pagebreak", "toc", "cells", "chart"];

export function filterCommands(query: string, card = false): SlashCommand[] {
    const wanted = query.trim().toLowerCase();
    const commands = card ? SLASH_COMMANDS.filter(({ id }) => !NOT_ON_CARDS.includes(id)) : SLASH_COMMANDS;
    if (!wanted) return commands;
    return commands.filter(({ label, keywords, id }) =>
        id.includes(wanted) || label.toLowerCase().includes(wanted) || keywords.toLowerCase().includes(wanted));
}

const SHORTCUTS: [string, TextKind][] = [
    ["#", "h1"],
    ["##", "h2"],
    ["###", "h3"],
    ["-", "bullet"],
    ["*", "bullet"],
    ["1.", "number"],
    ["[]", "todo"],
    ["[ ]", "todo"],
    [">", "quote"],
    ["```", "code"],
];

/** 行首打 `# ` 這類標記時要變成的區塊類型。瀏覽器輸入的空白可能是不換行空白。 */
export function shortcutKind(text: string): TextKind | null {
    const normalized = text.replace(/\u00a0/g, " ");
    if (!normalized.endsWith(" ")) return null;
    const marker = normalized.slice(0, -1);
    return SHORTCUTS.find(([mark]) => mark === marker)?.[1] ?? null;
}

export const isDividerMarker = (text: string) => /^(---|\*\*\*)$/.test(text);

export type Trigger =
    | { type: "slash"; from: number; query: string }
    | { type: "link"; from: number; query: string };

/** 游標前面的文字有沒有正在打 `/指令` 或 `[[連結`。`from` 是標記的開頭。 */
export function findTrigger(before: string): Trigger | null {
    const link = /\[\[([^\]\n]*)$/.exec(before);
    if (link) return { type: "link", from: link.index, query: link[1] };
    const slash = /(^|[\s　])\/([^\s/]*)$/.exec(before);
    if (slash) return { type: "slash", from: slash.index + slash[1].length, query: slash[2] };
    return null;
}

/** 收合的折疊區塊，底下縮排更深的區塊都不顯示。 */
export function visibleBlocks(blocks: WriterBlock[]): WriterBlock[] {
    const visible: WriterBlock[] = [];
    let hiddenBelow: number | null = null;
    for (const block of blocks) {
        if (hiddenBelow !== null && block.indent > hiddenBelow) continue;
        hiddenBelow = block.kind === "toggle" && block.collapsed ? block.indent : null;
        visible.push(block);
    }
    return visible;
}

/** 編號清單的號碼：同一層連續的項目往上數，被別的區塊隔開就重新開始。 */
export function listNumbers(blocks: WriterBlock[]): Map<string, number> {
    const numbers = new Map<string, number>();
    const counters: number[] = [];
    for (const block of blocks) {
        counters.length = Math.min(counters.length, block.indent + 1);
        if (block.kind === "number") {
            counters[block.indent] = (counters[block.indent] ?? 0) + 1;
            numbers.set(block.id, counters[block.indent]);
        } else {
            counters[block.indent] = 0;
        }
    }
    return numbers;
}

/** 拖曳一個區塊時，縮排在它底下的區塊要一起走。 */
export function blockGroup(blocks: WriterBlock[], id: string): string[] {
    const start = blocks.findIndex((block) => block.id === id);
    if (start === -1) return [];
    const group = [id];
    for (let index = start + 1; index < blocks.length; index += 1) {
        if (blocks[index].indent <= blocks[start].indent) break;
        group.push(blocks[index].id);
    }
    return group;
}

/** Tab 縮排最多比上一個區塊深一層。 */
export function indentLimit(blocks: WriterBlock[], id: string): number {
    const index = blocks.findIndex((block) => block.id === id);
    return index > 0 ? blocks[index - 1].indent + 1 : 0;
}

export const hasText = (kind: string) => !["divider", "cells", "chart", "image", "table", "pagebreak", "toc", "card"].includes(kind);

/** 版面上的一列：一個區塊或一整組分欄。 */
export interface DropRow {
    first: string;
    last: string;
    top: number;
    bottom: number;
    /** 空的文字段落，放上去就取代它。 */
    empty: boolean;
    columns: boolean;
}

export interface CardDrop {
    after: string | null;
    replace: boolean;
    /** 接在分欄後面時留在分欄外。 */
    leaveColumns: boolean;
    /** 提示線的位置。 */
    line: number;
}

/** 從 Library 拖來的卡片放在哪裡：區塊之間，碰到空段落就取代它。 */
export function cardDropAt(rows: DropRow[], y: number): CardDrop {
    const last = rows[rows.length - 1];
    const hovered = rows.find((row) => y >= row.top && y <= row.bottom) ?? (last && y > last.bottom ? last : undefined);
    if (hovered?.empty) return { after: hovered.first, replace: true, leaveColumns: false, line: hovered.top };
    const next = rows.findIndex((row) => y < (row.top + row.bottom) / 2);
    const index = next === -1 ? rows.length : next;
    const previous = rows[index - 1];
    return {
        after: previous?.last ?? null,
        replace: false,
        leaveColumns: previous?.columns ?? false,
        line: rows[index]?.top ?? last?.bottom ?? 0,
    };
}

const WIDE_LETTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/** 字數的算法和 Word 相同：中日韓文字一字算一個，英文和數字一個詞算一個，標點不算。 */
export function wordCount(text: string): number {
    const wide = text.match(WIDE_LETTER)?.length ?? 0;
    const narrow = text.replace(WIDE_LETTER, " ").match(/[\p{L}\p{N}][\p{L}\p{N}'’_.-]*/gu)?.length ?? 0;
    return wide + narrow;
}

/** 文字裡所有符合的位置，不分大小寫。 */
export function findRanges(text: string, query: string): { from: number; to: number }[] {
    if (!query) return [];
    const haystack = text.toLowerCase();
    const wanted = query.toLowerCase();
    const found: { from: number; to: number }[] = [];
    for (let at = haystack.indexOf(wanted); at !== -1; at = haystack.indexOf(wanted, at + wanted.length)) {
        found.push({ from: at, to: at + wanted.length });
    }
    return found;
}

export type BlockRun =
    | { type: "block"; block: WriterBlock }
    | { type: "columns"; group: string; columns: WriterBlock[][] };

/** 把連續的同一組分欄包在一起，其他區塊照原本的順序。 */
export function blockRuns(blocks: WriterBlock[]): BlockRun[] {
    const runs: BlockRun[] = [];
    for (const block of blocks) {
        const last = runs[runs.length - 1];
        if (!block.group) {
            runs.push({ type: "block", block });
            continue;
        }
        const run = last?.type === "columns" && last.group === block.group ? last : { type: "columns" as const, group: block.group, columns: [] };
        if (run !== last) runs.push(run);
        while (run.columns.length <= block.column) run.columns.push([]);
        run.columns[block.column].push(block);
    }
    return runs;
}

export const MAX_COLUMNS = 6;

/** 把手在區塊左邊，直直往下拖時游標會經過這裡，不能算成要放到左邊。 */
const HANDLE_WIDTH = 24;

/** 拖到區塊的左右四分之一就是要並排，中間一半永遠是放到上面或下面，窄的欄也一樣。 */
export function dropSide(x: number, left: number, right: number): BlockSide | null {
    const zone = (right - left) / 4;
    if (x >= right - zone) return "right";
    if (x >= left + Math.min(HANDLE_WIDTH, zone / 2) && x <= left + zone) return "left";
    return null;
}

interface Span {
    left: number;
    right: number;
}

/** 游標在第幾欄。欄與欄的間隙是右邊那欄的把手，算右邊那欄，`inGap` 時不判斷左右。 */
export function columnAt(x: number, columns: Span[]) {
    const found = columns.findIndex((column) => x <= column.right);
    const index = found === -1 ? columns.length - 1 : found;
    return { index, inGap: x < columns[index].left };
}

/** 貼上多行文字時，每行一個區塊。 */
export function pastedLines(text: string): string[] {
    return text.replace(/\r\n?/g, "\n").split("\n");
}
