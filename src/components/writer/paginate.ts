// 分頁：輸入沒有分頁時每個區塊的位置，算出每個區塊要往下推多少。
// 座標都以第一頁內容區的頂端為 0。第 n 頁的內容區是 [n × pitch, n × pitch + contentHeight)。

export interface FlowRow {
    id: string;
    top: number;
    height: number;
    /** 文字可以一行一行分到兩頁；圖片、圖表這類不行。 */
    splittable: boolean;
    /** 下面至少要再放得下這個高度，否則整塊換頁。標題不留在頁尾就是靠它。 */
    keepAfter: number;
    /** 分欄：每一欄各自排，整組的高度是最長的那一欄。 */
    columns?: FlowRow[][];
    /** 換頁記號：它自己留在原地，下一個區塊從下一頁開始。 */
    pageBreak?: boolean;
}

/** 一行文字在區塊裡的位置。 */
export interface FlowLine {
    top: number;
    bottom: number;
}

/** 文字裡要空出來的一段，下一行會排到它下面。`top` 已經算進前面幾段留白。 */
export interface FlowBand {
    top: number;
    height: number;
}

export interface RowBreak {
    id: string;
    /** 整塊往下推的距離。 */
    push: number;
    bands: FlowBand[];
}

export interface Pagination {
    pages: number;
    /** 只列出需要調整的區塊。 */
    breaks: RowBreak[];
}

export interface PageMetrics {
    contentHeight: number;
    pitch: number;
}

/** 區塊加上這些留白之後實際排出來的樣子。 */
export interface RowLayout {
    lines: FlowLine[];
    height: number;
}

/** 文字排到新的一頁時，瀏覽器可能比要求的位置差一兩個像素。 */
const SNAP = 2;

/** 找 `from` 之後第一個放不下的行。 */
function firstOverflow(lines: FlowLine[], y: number, { contentHeight, pitch }: PageMetrics, from: number) {
    for (let index = from; index < lines.length; index += 1) {
        const line = lines[index];
        const top = y + line.top;
        const page = Math.floor((top + SNAP) / pitch);
        const atPageTop = top - page * pitch <= SNAP;
        if (y + line.bottom > page * pitch + contentHeight && !atPageTop) return { index, line, page };
    }
    return null;
}

/** 分欄至少要放得下每一欄開頭的這個高度，否則整組換頁，兩欄才會從同一頁開始。 */
const MIN_COLUMN_START = 28;

const columnStart = ([first]: FlowRow[]) =>
    (first ? (first.splittable ? Math.min(first.height, MIN_COLUMN_START) : first.height) : 0);

/**
 * 量文字的行很慢，所以 `layoutRow` 只在區塊真的跨頁時才呼叫。
 * 瀏覽器排版有捨入誤差，每頁差一點累積下來，最後一行就會被頁界蓋住。
 * 所以每加一段留白都重新量實際位置，後面的區塊也接在量到的高度後面。
 */
export function paginate(
    rows: FlowRow[],
    metrics: PageMetrics,
    layoutRow: (id: string, bands: FlowBand[]) => RowLayout,
): Pagination {
    const { breaks, bottom } = flowRows(rows, metrics, layoutRow);
    return { pages: Math.max(1, Math.floor(Math.max(bottom - 1, 0) / metrics.pitch) + 1), breaks };
}

function flowRows(rows: FlowRow[], metrics: PageMetrics, layoutRow: (id: string, bands: FlowBand[]) => RowLayout) {
    const { contentHeight, pitch } = metrics;
    const breaks: RowBreak[] = [];
    let shift = 0;
    let bottom = 0;
    /** 換頁記號所在的頁，下一個區塊要排在它之後。 */
    let breakPage: number | null = null;
    for (const row of rows) {
        let y = row.top + shift;
        let page = Math.floor(y / pitch);
        let push = 0;
        const moveToNextPage = () => {
            page += 1;
            push += page * pitch - y;
            y = page * pitch;
        };
        if (row.pageBreak) {
            // 記號落在頁尾留白裡也不用換頁，否則會多出一張空白頁。
            breakPage = page;
            bottom = y + row.height;
            shift = bottom - (row.top + row.height);
            continue;
        }
        // 上一塊的尾巴（例如內距）可能落在頁與頁之間。
        if (y - page * pitch >= contentHeight) moveToNextPage();
        if (breakPage !== null && page <= breakPage) moveToNextPage();
        breakPage = null;

        const limit = () => page * pitch + contentHeight;
        const atTop = () => y - page * pitch < 1;
        const bands: FlowBand[] = [];
        let height = row.height;
        if (row.columns) {
            const start = Math.max(...row.columns.map(columnStart));
            if (y + start > limit() && !atTop()) moveToNextPage();
            const offset = y - row.top;
            let end = y;
            for (const column of row.columns) {
                const placed = flowRows(column.map((item) => ({ ...item, top: item.top + offset })), metrics, layoutRow);
                breaks.push(...placed.breaks);
                end = Math.max(end, placed.bottom);
            }
            height = end - y;
        } else if (y + height + row.keepAfter > limit()) {
            if (row.splittable && !row.keepAfter) {
                let layout = layoutRow(row.id, bands);
                // 第一行放不下時沒有東西留在這一頁；比一整頁還高的區塊只能從頁首開始。
                const first = layout.lines[0];
                if ((layout.lines.length < 2 || y + first.bottom > limit()) && !atTop()) moveToNextPage();
                // 第一行留在原地，所以從第二行找起。空行寬度是 0，留白推不動它，
                // 所以每行只處理一次；它留在頁尾也沒有內容會被蓋住。
                let overflow = firstOverflow(layout.lines, y, metrics, 1);
                while (overflow) {
                    const { index, line, page: at } = overflow;
                    bands.push({ top: line.top, height: (at + 1) * pitch - (y + line.top) });
                    layout = layoutRow(row.id, bands);
                    overflow = firstOverflow(layout.lines, y, metrics, index + 1);
                }
                height = layout.height;
            } else if (!atTop()) {
                moveToNextPage();
            }
        }
        bottom = y + height;
        shift = bottom - (row.top + row.height);
        if (push > 0 || bands.length > 0) breaks.push({ id: row.id, push, bands });
    }
    return { breaks, bottom };
}

/** 一段留白的形狀：`shape-outside` 的多邊形，頂點沿著左邊走，所以留白可以有好幾段。 */
export function bandPolygon(bands: FlowBand[]) {
    return bands
        .flatMap(({ top, height }) => {
            const end = top + height;
            return [`0 ${top}px`, `100% ${top}px`, `100% ${end}px`, `0 ${end}px`];
        })
        .join(", ");
}

/** 把一個區塊裡的文字方框併成一行一行。方框是視覺大小，行高要用 `lineHeight` 補回來。 */
export function groupLines(rects: FlowLine[], lineHeight: number): FlowLine[] {
    const sorted = rects.filter((rect) => rect.bottom > rect.top).sort((a, b) => a.top - b.top);
    const lines: FlowLine[] = [];
    let centre = -Infinity;
    for (const rect of sorted) {
        const middle = (rect.top + rect.bottom) / 2;
        if (middle < centre + lineHeight / 2) continue;
        centre = middle;
        lines.push({ top: middle - lineHeight / 2, bottom: middle + lineHeight / 2 });
    }
    return lines;
}
