// Markdown 的文件模型。行內內容是「一串帶格式的文字」，不是巢狀樹：
// 跨越粗體、斜體邊界的選取才能直接用字元位置處理。

export interface Marks {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
    href?: string;
}

/** `text` 裡的 "\n" 代表換行。 */
export interface Run extends Marks {
    text: string;
}

export interface ParagraphBlock {
    type: "paragraph";
    runs: Run[];
}

export interface HeadingBlock {
    type: "heading";
    level: number;
    runs: Run[];
}

export interface CodeBlock {
    type: "code";
    language: string;
    text: string;
}

export interface RuleBlock {
    type: "rule";
}

export interface QuoteBlock {
    type: "quote";
    blocks: Block[];
}

export interface ListBlock {
    type: "list";
    ordered: boolean;
    start: number;
    items: Block[][];
    /** 待辦和折疊項目用這個符號取代項目符號，跟 `items` 一一對應。 */
    markers?: (string | null)[];
}

/** 第一列是表頭。 */
export interface TableBlock {
    type: "table";
    rows: Run[][][];
}

/** 卡片裡的圖片，放在媒體庫。 */
export interface ImageBlock {
    type: "image";
    file: string;
    width: number;
    height: number;
    /** 佔可用寬度的百分比，沒有就是原本大小。 */
    percent: number | null;
}

export type Block = ParagraphBlock | HeadingBlock | CodeBlock | RuleBlock | QuoteBlock | ListBlock | TableBlock | ImageBlock;

export const paragraph = (runs: Run[] = []): ParagraphBlock => ({ type: "paragraph", runs });

export function marksOf({ bold, italic, strike, code, href }: Run): Marks {
    const marks: Marks = {};
    if (bold) marks.bold = true;
    if (italic) marks.italic = true;
    if (strike) marks.strike = true;
    if (code) marks.code = true;
    if (href !== undefined) marks.href = href;
    return marks;
}

export function sameMarks(a: Marks, b: Marks): boolean {
    return !!a.bold === !!b.bold
        && !!a.italic === !!b.italic
        && !!a.strike === !!b.strike
        && !!a.code === !!b.code
        && a.href === b.href;
}

/** 合併相鄰且格式相同的片段，並移除空片段。 */
export function normalizeRuns(runs: Run[]): Run[] {
    const merged: Run[] = [];
    for (const run of runs) {
        if (!run.text) continue;
        const last = merged[merged.length - 1];
        if (last && sameMarks(last, run)) last.text += run.text;
        else merged.push({ ...run });
    }
    return merged;
}

export const runsText = (runs: Run[]): string => runs.map((run) => run.text).join("");
