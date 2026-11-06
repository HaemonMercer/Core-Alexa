import type { CellRange } from "../../types.ts";

// 從 Excels 複製時，HTML 表格帶著來源範圍，貼進 Writer 才知道要連回哪裡。
// 貼到別的程式時它就是一般的表格。

const ATTRIBUTE = "data-alexa-cells";

const escapeHtml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function cellsToHtml(source: CellRange, rows: string[][]): string {
    const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("");
    return `<table ${ATTRIBUTE}="${encodeURIComponent(JSON.stringify(source))}">${body}</table>`;
}

const isIDs = (value: unknown): value is string[] =>
    Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string");

/** 網頁的 HTML 也可能帶這個屬性，形狀不對就當成沒有。 */
export function cellsFromHtml(html: string): CellRange | null {
    const match = new RegExp(`${ATTRIBUTE}="([^"]*)"`).exec(html);
    if (!match) return null;
    try {
        const value: unknown = JSON.parse(decodeURIComponent(match[1]));
        const { noteId, tableId, rows, cols } = value as CellRange;
        if (typeof noteId !== "string" || typeof tableId !== "string" || !isIDs(rows) || !isIDs(cols)) return null;
        return { noteId, tableId, rows, cols };
    } catch {
        return null;
    }
}

/** 只有一格時是在貼一個值，不是貼表格。 */
export const isSingleCell = (source: CellRange) => source.rows.length * source.cols.length < 2;
