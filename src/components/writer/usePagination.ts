import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { PageBox } from "./pageFormat.ts";
import { bandPolygon, groupLines, paginate, type FlowBand, type FlowLine, type FlowRow } from "./paginate.ts";

/** 標題後面至少要放得下一行，否則標題會單獨留在頁尾。 */
const KEEP_AFTER_HEADING = 28;
const HEADINGS = ["h1", "h2", "h3"];

const textOf = (row: HTMLElement) => row.querySelector<HTMLElement>(".writer-text");
/** 表格的列、目錄的項目和放進來的 Note 的每個區塊都是一列一列分頁的。 */
const tableRowsOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>(".writer-table-row, .writer-toc-row, .writer-card .writer-row")];

function clearBreaks(list: Element) {
    for (const row of list.querySelectorAll<HTMLElement>(".writer-row")) {
        row.style.removeProperty("--writer-break");
        textOf(row)?.removeAttribute("data-split");
        for (const tableRow of tableRowsOf(row)) tableRow.style.removeProperty("--writer-row-break");
    }
    for (const group of list.querySelectorAll<HTMLElement>(".writer-columns")) group.style.removeProperty("--writer-group-break");
}

/** 文字的每一行相對於區塊頂端的位置。表格以列為單位。 */
function measureLines(row: HTMLElement, scale: number): FlowLine[] {
    const top = row.getBoundingClientRect().top;
    const relative = (rect: DOMRect) => ({ top: (rect.top - top) / scale, bottom: (rect.bottom - top) / scale });
    const tableRows = tableRowsOf(row);
    if (tableRows.length > 0) return tableRows.map((tableRow) => relative(tableRow.getBoundingClientRect()));
    const text = textOf(row);
    if (!text) return [];
    const range = document.createRange();
    range.selectNodeContents(text);
    return groupLines([...range.getClientRects()].map(relative), parseFloat(getComputedStyle(text).lineHeight) || 24);
}

/** 表格是把那一列往下推；留白一次多一段，所以只處理最後一段。 */
function pushTableRow(row: HTMLElement, tableRows: HTMLElement[], band: FlowBand, scale: number) {
    const top = row.getBoundingClientRect().top;
    const distance = (tableRow: HTMLElement) => Math.abs((tableRow.getBoundingClientRect().top - top) / scale - band.top);
    const target = tableRows.reduce((best, tableRow) => (distance(tableRow) < distance(best) ? tableRow : best));
    target.style.setProperty("--writer-row-break", `${band.height}px`);
}

function applyBands(row: HTMLElement, bands: FlowBand[], scale: number) {
    if (bands.length === 0) return;
    const tableRows = tableRowsOf(row);
    if (tableRows.length > 0) return pushTableRow(row, tableRows, bands[bands.length - 1], scale);
    const text = textOf(row);
    if (!text) return;
    const style = getComputedStyle(text);
    const inset = (text.getBoundingClientRect().top - row.getBoundingClientRect().top) / scale + parseFloat(style.paddingTop);
    // 往下多留 1 像素，留白的上緣才會壓在要換頁的那一行上，而不是碰到上一行。
    const local = bands.map(({ top, height }) => ({ top: top - inset + 1, height: height - 1 }));
    const last = local[local.length - 1];
    text.style.setProperty("--writer-split-height", `${last.top + last.height}px`);
    text.style.setProperty("--writer-split-shape", bandPolygon(local));
    text.setAttribute("data-split", "true");
}

/**
 * 把區塊排到一頁一頁的紙上，回傳總頁數。
 * 每次都先拿掉分頁再量，所以和上一次的結果無關。全部在畫面更新前做完，看不到中間狀態。
 */
export function usePagination(
    sheet: RefObject<HTMLElement | null>,
    box: PageBox | null,
    scale: number,
    content: unknown[],
    /** 每次排完呼叫，目錄的頁碼要跟著更新。 */
    onLayout: () => void,
) {
    const [pages, setPages] = useState(1);

    const layout = useCallback(() => {
        const host = sheet.current;
        const list = host?.querySelector(".writer-blocks");
        if (!host || !list || !box) return;
        clearBreaks(list);
        const origin = host.getBoundingClientRect().top + box.margin * scale;
        const byID = new Map<string, HTMLElement>();

        const flowRow = (row: HTMLElement, last: boolean): FlowRow => {
            const rect = row.getBoundingClientRect();
            const id = row.dataset.id ?? "";
            byID.set(id, row);
            const heading = HEADINGS.includes(row.dataset.kind ?? "");
            return {
                id,
                top: (rect.top - origin) / scale,
                height: rect.height / scale,
                splittable: textOf(row) !== null || tableRowsOf(row).length > 0,
                keepAfter: heading && !last ? KEEP_AFTER_HEADING : 0,
                pageBreak: row.dataset.kind === "pagebreak",
            };
        };
        const flowRows = (rows: HTMLElement[]) => rows.map((row, index) => flowRow(row, index === rows.length - 1));

        const flow = ([...list.children] as HTMLElement[]).map((child, index, children) => {
            const row = flowRow(child, index === children.length - 1);
            if (!child.classList.contains("writer-columns")) return row;
            const columns = ([...child.children] as HTMLElement[]).map((column) => flowRows([...column.children] as HTMLElement[]));
            return { ...row, splittable: false, columns };
        });

        const measured = paginate(flow, box, (id, bands) => {
            const row = byID.get(id);
            if (!row) return { lines: [], height: 0 };
            applyBands(row, bands, scale);
            return { lines: measureLines(row, scale), height: row.getBoundingClientRect().height / scale };
        });
        for (const { id, push } of measured.breaks) {
            const row = byID.get(id);
            if (push <= 0 || !row) continue;
            const name = row.classList.contains("writer-columns") ? "--writer-group-break" : "--writer-break";
            row.style.setProperty(name, `${push}px`);
        }
        setPages(measured.pages);
        onLayout();
    }, [sheet, box, scale, onLayout]);

    useLayoutEffect(layout, [layout, ...content]);

    // 圖片載入、引入的表格讀完、打字換行都會改變高度。
    const ready = box !== null;
    useEffect(() => {
        const list = sheet.current?.querySelector(".writer-blocks");
        if (!list) return;
        const observer = new ResizeObserver(layout);
        observer.observe(list);
        return () => observer.disconnect();
    }, [sheet, layout, ready, ...content]);

    return pages;
}
