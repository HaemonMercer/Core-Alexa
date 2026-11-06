import type { CellMerge, SheetTable } from "../../types.ts";

// 表格選取與剪貼簿的計算。座標都是當下的列、欄索引，存檔時才換成穩定的 id。

export interface Cell {
    row: number;
    col: number;
}

export interface Selection {
    tableID: string;
    anchor: Cell;
    focus: Cell;
}

export interface Box {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

export function boxOf({ anchor, focus }: Selection): Box {
    return {
        top: Math.min(anchor.row, focus.row),
        bottom: Math.max(anchor.row, focus.row),
        left: Math.min(anchor.col, focus.col),
        right: Math.max(anchor.col, focus.col),
    };
}

export const mergeAt = (merges: CellMerge[], { row, col }: Cell) =>
    merges.find((merge) => row >= merge.top && row < merge.top + merge.rows && col >= merge.left && col < merge.left + merge.cols);

/** 合併的格子永遠用左上角代表。 */
export function mergeAnchor(merges: CellMerge[], cell: Cell): Cell {
    const merge = mergeAt(merges, cell);
    return merge ? { row: merge.top, col: merge.left } : cell;
}

const touches = (box: Box, merge: CellMerge) =>
    merge.top <= box.bottom && merge.top + merge.rows - 1 >= box.top && merge.left <= box.right && merge.left + merge.cols - 1 >= box.left;

/** 選取碰到合併的格子時要整塊包進來。長大後可能又碰到別塊，要重複到不再變大。 */
export function expandBox(box: Box, merges: CellMerge[]): Box {
    let next = box;
    for (;;) {
        const grown = merges.filter((merge) => touches(next, merge)).reduce((area, merge) => ({
            top: Math.min(area.top, merge.top),
            bottom: Math.max(area.bottom, merge.top + merge.rows - 1),
            left: Math.min(area.left, merge.left),
            right: Math.max(area.right, merge.left + merge.cols - 1),
        }), next);
        if (grown.top === next.top && grown.bottom === next.bottom && grown.left === next.left && grown.right === next.right) return next;
        next = grown;
    }
}

export const boxHasMerge = (box: Box, merges: CellMerge[]) => merges.some((merge) => touches(box, merge));

/** 畫表格用：被合併蓋住的格子不畫，左上角的格子跨列跨欄。鍵是 `列:欄`。 */
export function mergeMaps(merges: CellMerge[]) {
    const covered = new Set<string>();
    const spans = new Map<string, CellMerge>();
    for (const merge of merges) {
        spans.set(`${merge.top}:${merge.left}`, merge);
        for (let row = merge.top; row < merge.top + merge.rows; row += 1) {
            for (let col = merge.left; col < merge.left + merge.cols; col += 1) {
                if (row !== merge.top || col !== merge.left) covered.add(`${row}:${col}`);
            }
        }
    }
    return { covered, spans };
}

interface StepLimits {
    rows: number;
    cols: number;
    merges: CellMerge[];
    /** 被篩選掉的列，方向鍵要跳過。 */
    hidden: Set<number>;
}

/** 方向鍵的下一格：走出合併的格子、跳過隱藏的列。到邊界就留在原地。 */
export function stepCell(from: Cell, rowStep: number, colStep: number, { rows, cols, merges, hidden }: StepLimits): Cell {
    const merge = mergeAt(merges, from);
    let row = rowStep > 0 && merge ? merge.top + merge.rows - 1 : from.row;
    let col = colStep > 0 && merge ? merge.left + merge.cols - 1 : from.col;
    do {
        row += rowStep;
        col += colStep;
    } while (rowStep !== 0 && hidden.has(row));
    if (row < 0 || row >= rows || col < 0 || col >= cols) return from;
    return mergeAnchor(merges, { row, col });
}

/** 拖曳填充控制點時要填的範圍。只往一個方向延伸，選較遠的那個方向。 */
export function fillTarget(box: Box, cell: Cell): Box | null {
    const down = cell.row - box.bottom;
    const up = box.top - cell.row;
    const right = cell.col - box.right;
    const left = box.left - cell.col;
    const vertical = Math.max(down, up);
    const horizontal = Math.max(right, left);
    if (vertical <= 0 && horizontal <= 0) return null;
    if (vertical >= horizontal) {
        return down > 0
            ? { top: box.bottom + 1, bottom: cell.row, left: box.left, right: box.right }
            : { top: cell.row, bottom: box.top - 1, left: box.left, right: box.right };
    }
    return right > 0
        ? { top: box.top, bottom: box.bottom, left: box.right + 1, right: cell.col }
        : { top: box.top, bottom: box.bottom, left: cell.col, right: box.left - 1 };
}

export interface Found extends Cell {
    tableID: string;
}

/** 找看得見的格子，不分大小寫。 */
export function findCells(tables: SheetTable[], query: string): Found[] {
    const wanted = query.toLowerCase();
    if (!wanted) return [];
    return tables.flatMap((table) => {
        const hidden = new Set(table.hiddenRows);
        const { covered } = mergeMaps(table.merges);
        return table.rows.flatMap((row, y) => (hidden.has(row.id) ? [] : table.cols.flatMap((col, x) => {
            const display = table.cells[`${row.id}:${col.id}`]?.display ?? "";
            return !covered.has(`${y}:${x}`) && display.toLowerCase().includes(wanted) ? [{ tableID: table.id, row: y, col: x }] : [];
        })));
    });
}

/** 取代全部出現的地方，不分大小寫。 */
export function replaceText(text: string, query: string, replacement: string): string {
    if (!query) return text;
    const lower = text.toLowerCase();
    const wanted = query.toLowerCase();
    let result = "";
    let cursor = 0;
    for (let at = lower.indexOf(wanted); at !== -1; at = lower.indexOf(wanted, cursor)) {
        result += text.slice(cursor, at) + replacement;
        cursor = at + wanted.length;
    }
    return result + text.slice(cursor);
}

export const clampCell = (cell: Cell, rows: number, cols: number): Cell => ({
    row: Math.max(0, Math.min(rows - 1, cell.row)),
    col: Math.max(0, Math.min(cols - 1, cell.col)),
});

export function colLabel(index: number): string {
    let rest = index + 1;
    let label = "";
    while (rest > 0) {
        const digit = (rest - 1) % 26;
        label = String.fromCharCode(65 + digit) + label;
        rest = Math.floor((rest - 1) / 26);
    }
    return label;
}

export const cellLabel = ({ row, col }: Cell) => `${colLabel(col)}${row + 1}`;

/** 從起點往後累加，`offsets[n]` 是第 n 列或欄的起始位置，最後一格是總長。 */
export function offsetsOf(sizes: number[]): number[] {
    const offsets = [0];
    for (const size of sizes) offsets.push(offsets[offsets.length - 1] + size);
    return offsets;
}

/** 表格之間的參照要加名稱，和公式的寫法相同。 */
export function tablePrefix(name: string): string {
    if ([...name].every((char) => /[\p{L}\p{N}_.$]/u.test(char))) return `${name}::`;
    return `'${name.replace(/'/g, "''")}'::`;
}

/** 從剪貼簿讀 Excel、Numbers 複製出來的 TSV，引號裡可以有換行與 Tab。 */
export function parseClipboard(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;
    const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
            if (char !== '"') cell += char;
            else if (source[index + 1] === '"') {
                cell += '"';
                index += 1;
            } else quoted = false;
        } else if (char === '"' && cell === "") {
            quoted = true;
        } else if (char === "\t") {
            row.push(cell);
            cell = "";
        } else if (char === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        } else {
            cell += char;
        }
    }
    row.push(cell);
    rows.push(row);
    return rows;
}

export function toClipboard(rows: string[][]): string {
    const escape = (cell: string) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell);
    return rows.map((row) => row.map(escape).join("\t")).join("\n");
}
