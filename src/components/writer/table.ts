// Writer 表格的純邏輯：解析貼上的內容、增刪列與欄。內容是字串的二維陣列。

export type TableRows = string[][];

const MIN_COLUMN_WEIGHT = 4;
const MAX_COLUMN_WEIGHT = 30;
/** 短內容不換行要保留的寬度：字數上限、每格的像素、左右內距加框線。 */
const MIN_COLUMN_UNITS = 8;
const UNIT_WIDTH = 8;
const CELL_INSET = 18;

/** 字數換算成欄寬比例，中文字佔兩格。 */
const textWidth = (text: string) => [...text].reduce((width, char) => width + (char.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);

/**
 * 表格永遠填滿可用的寬度，各欄依內容分配。設上下限，一欄長文字才不會把別欄擠到看不見。
 * 每欄先保留放得下短內容的寬度，「30」才不會被拆成兩行；放不下時最多各佔平均寬度，
 * 所以不會撐破版面，長字串會換行。
 */
export function columnTemplate(rows: TableRows): string {
    const width = rows[0]?.length ?? 0;
    return Array.from({ length: width }, (_, col) => {
        const longest = Math.max(...rows.map((row) => textWidth(row[col] ?? "")));
        const keep = Math.min(longest, MIN_COLUMN_UNITS) * UNIT_WIDTH + CELL_INSET;
        const weight = Math.min(MAX_COLUMN_WEIGHT, Math.max(MIN_COLUMN_WEIGHT, longest));
        return `minmax(min(${keep}px, ${100 / width}%), ${weight}fr)`;
    }).join(" ");
}

export const emptyTable = (rows: number, cols: number): TableRows =>
    Array.from({ length: rows }, () => Array.from({ length: cols }, () => ""));

const isTable = (rows: TableRows) => rows.length * (rows[0]?.length ?? 0) >= 2;

const pad = (rows: TableRows): TableRows => {
    const width = Math.max(...rows.map((row) => row.length));
    return rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
};

const MARKDOWN_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** `| a | b |` 這種一列。`\|` 是格子裡的直線。 */
function markdownRow(line: string): string[] {
    const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
    return body.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

/** Markdown 表格或 Excel 複製的 Tab 分隔文字。看起來不是表格時回傳 null。 */
export function tableFromText(text: string): TableRows | null {
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
    if (lines.length >= 2 && lines[0].includes("|") && MARKDOWN_RULE.test(lines[1]) && lines[1].includes("-")) {
        const rows = lines.filter((_, index) => index !== 1).map(markdownRow);
        return isTable(rows) ? pad(rows) : null;
    }
    // 一行裡剛好有 Tab 的文字太常見，至少要兩行才當成表格。
    if (lines.length < 2 || !lines.every((line) => line.includes("\t"))) return null;
    return pad(lines.map((line) => line.split("\t").map((cell) => cell.trim())));
}

/** Excel、Word、網頁複製的表格。只取文字，內容不會當成 HTML 使用。 */
export function tableFromHtml(html: string): TableRows | null {
    if (!/<table[\s>]/i.test(html)) return null;
    const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
    if (!table) return null;
    const rows = [...table.rows].map((row) => [...row.cells].flatMap((cell) => [
        (cell.textContent ?? "").replace(/\s+/g, " ").trim(),
        ...Array.from({ length: cell.colSpan - 1 }, () => ""),
    ]));
    const filled = rows.filter((row) => row.length > 0);
    return filled.length > 0 && isTable(pad(filled)) ? pad(filled) : null;
}

/** 剪貼簿裡的表格。Excel 同時放了表格的圖片，所以要比圖片先看。 */
export const clipboardTable = (data: DataTransfer): TableRows | null =>
    tableFromHtml(data.getData("text/html")) ?? tableFromText(data.getData("text/plain"));

/** 貼到某一格：從那格開始蓋過去，超出範圍時表格長大。 */
export function overlayTable(rows: TableRows, row: number, col: number, pasted: TableRows): TableRows {
    const height = Math.max(rows.length, row + pasted.length);
    const width = Math.max(rows[0].length, col + pasted[0].length);
    return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) =>
        pasted[y - row]?.[x - col] ?? rows[y]?.[x] ?? ""));
}

export const insertRow = (rows: TableRows, at: number): TableRows => [
    ...rows.slice(0, at),
    rows[0].map(() => ""),
    ...rows.slice(at),
];

export const insertColumn = (rows: TableRows, at: number): TableRows =>
    rows.map((row) => [...row.slice(0, at), "", ...row.slice(at)]);

/** 刪掉最後一列或一欄時回傳 null，整個表格一起刪。 */
export function deleteRow(rows: TableRows, at: number): TableRows | null {
    return rows.length > 1 ? rows.filter((_, index) => index !== at) : null;
}

export function deleteColumn(rows: TableRows, at: number): TableRows | null {
    return rows[0].length > 1 ? rows.map((row) => row.filter((_, index) => index !== at)) : null;
}
