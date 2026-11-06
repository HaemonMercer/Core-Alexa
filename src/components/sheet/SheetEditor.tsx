import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as api from "../../api.ts";
import type { CellInput, CellRange, SheetObject, SheetOp, SheetState, SheetTable, StylePatch } from "../../types.ts";
import { useCardSurface, type CardSurface } from "../cards/cardSurface.ts";
import PlacedCard from "../cards/PlacedCard.tsx";
import ChartView from "../chart/ChartView.tsx";
import EmbeddedNote from "../writer/EmbeddedNote.tsx";
import { CHART_KINDS, type ChartKind } from "../chart/layout.ts";
import ConfirmDialog from "../common/ConfirmDialog.tsx";
import ContextMenu, { type MenuItem } from "../common/ContextMenu.tsx";
import DocumentTitle from "../office/DocumentTitle.tsx";
import { cellsFromHtml, cellsToHtml } from "../office/cellClipboard.ts";
import { bumpSheetRevision } from "../office/officePreview.ts";
import { useEditorHistory } from "../office/useEditorHistory.ts";
import { cellStyle } from "./cellStyle.ts";
import FilterMenu from "./FilterMenu.tsx";
import FindBar from "./FindBar.tsx";
import {
    boxHasMerge, boxOf, cellLabel, clampCell, colLabel, expandBox, fillTarget, mergeAnchor, mergeAt, mergeMaps, offsetsOf, parseClipboard,
    stepCell, tablePrefix, toClipboard, type Box, type Cell, type Found, type Selection,
} from "./grid.ts";

const PAGE_PADDING = 120;
const DEFAULT_TABLE_GAP = 60;
const FILLS = ["", "#fde8e8", "#fdf1dc", "#fbf7d0", "#e2f5e6", "#e1eefb", "#ece6fb", "#f0efeb"];
const COLORS = ["", "#c0332b", "#b86e00", "#1a7f43", "#1f66c2", "#6b3fc7", "#57606a"];
const FORMATS: { id: string; label: string }[] = [
    { id: "", label: "一般" },
    { id: "number", label: "數字" },
    { id: "integer", label: "整數" },
    { id: "percent", label: "百分比" },
    { id: "currency", label: "貨幣" },
];

interface SheetEditorProps {
    noteID: string;
    /** 放在頁面上的卡片要跟著更新。 */
    cardRevision: number;
    /** 工作表像白板一樣可以放卡片。 */
    onSurface: (surface: CardSurface | null) => void;
    /** 雙擊頁面上的卡片。Note 就地編輯，其他類型開啟右側面板。 */
    onPeekCard: (id: string) => void;
    /** 就地編輯的 Note 改了內容。 */
    onCardChanged: (id: string) => void;
    onCardCreated: () => void;
    onOpenLink: (href: string) => void;
    onChanged: () => void;
    onOpenChart: (id: string) => void;
    onError: (error: unknown) => void;
}

interface Editing {
    tableID: string;
    cell: Cell;
    value: string;
    /** 用打字開始的編輯，方向鍵會結束編輯並移動。 */
    typed: boolean;
}

type Menu = { x: number; y: number; items: MenuItem[] };

const cellID = (table: SheetTable, { row, col }: Cell) => `${table.rows[row]?.id}:${table.cols[col]?.id}`;

/** 只在內容改變時重畫；選取框是獨立的一層，移動游標不用重畫整張表。 */
const TableGrid = memo(function TableGrid({ table }: { table: SheetTable }) {
    const bodyEnd = table.rows.length - table.footerRows;
    const hidden = new Set(table.hiddenRows);
    const { covered, spans } = mergeMaps(table.merges);
    return (
        <table className="sheet-grid" style={{ width: table.cols.reduce((sum, col) => sum + col.size, 0) }}>
            <colgroup>{table.cols.map((col) => <col key={col.id} style={{ width: col.size }} />)}</colgroup>
            <tbody>
                {table.rows.map((row, y) => (
                    <tr
                        key={row.id}
                        style={{ height: row.size }}
                        data-part={y < table.headerRows ? "header" : y >= bodyEnd ? "footer" : undefined}
                        data-hidden={hidden.has(row.id) || undefined}
                    >
                        {table.cols.map((col, x) => {
                            if (covered.has(`${y}:${x}`)) return null;
                            const cell = table.cells[`${row.id}:${col.id}`];
                            const span = spans.get(`${y}:${x}`);
                            return (
                                <td
                                    key={col.id}
                                    rowSpan={span?.rows}
                                    colSpan={span?.cols}
                                    data-row={y}
                                    data-col={x}
                                    data-side={x < table.headerCols ? "header" : undefined}
                                    data-kind={cell?.kind}
                                    data-merged={span ? true : undefined}
                                    style={cellStyle(cell)}
                                >
                                    {cell?.display}
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
});

function NameInput({ value, onSubmit, onCancel, className }: { value: string; onSubmit: (name: string) => void; onCancel: () => void; className: string }) {
    const [name, setName] = useState(value);
    return (
        <input
            className={className}
            autoFocus
            value={name}
            onChange={(evt) => setName(evt.target.value)}
            onFocus={(evt) => evt.target.select()}
            onBlur={() => onSubmit(name)}
            onPointerDown={(evt) => evt.stopPropagation()}
            onKeyDown={(evt) => {
                evt.stopPropagation();
                if (evt.key === "Enter") onSubmit(name);
                if (evt.key === "Escape") {
                    evt.preventDefault();
                    onCancel();
                }
            }}
        />
    );
}

/** 參考 Numbers：頁面上放表格，選到表格才出現欄名、列號與控制點。 */
function SheetEditor({ noteID, cardRevision, onSurface, onPeekCard, onCardChanged, onCardCreated, onOpenLink, onChanged, onOpenChart, onError }: SheetEditorProps) {
    const [state, setState] = useState<SheetState | null>(null);
    const [tabID, setTabID] = useState<string | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [objectID, setObjectID] = useState<string | null>(null);
    const [noteEditID, setNoteEditID] = useState<string | null>(null);
    const stopNoteEdit = useCallback(() => setNoteEditID(null), []);
    const pageRef = useRef<HTMLDivElement>(null);
    const [menu, setMenu] = useState<Menu | null>(null);
    const [renaming, setRenaming] = useState<{ kind: "tab" | "table"; id: string } | null>(null);
    const [confirm, setConfirm] = useState<{ title: string; detail: string; run: () => void } | null>(null);
    const [charts, setCharts] = useState(false);
    const [revision, setRevision] = useState(0);
    const [ghost, setGhost] = useState<{ id: string; x: number; y: number; w?: number; h?: number } | null>(null);
    const [filterMenu, setFilterMenu] = useState<{ tableID: string; colID: string; left: number; top: number } | null>(null);
    const [finding, setFinding] = useState(false);
    /** 拖曳填充控制點時要填的範圍。 */
    const [fillPreview, setFillPreview] = useState<Box | null>(null);

    const input = useRef<HTMLTextAreaElement>(null);
    const dragging = useRef(false);
    const composing = useRef(false);
    const formulaAnchor = useRef<{ cell: Cell; start: number; end: number; tableID: string } | null>(null);

    const load = useCallback(() => {
        api.getSheet(noteID)
            .then((next) => {
                setState(next);
                setRevision((value) => value + 1);
                setTabID((current) => (next.tabs.some((tab) => tab.id === current) ? current : next.tabs[0]?.id ?? null));
            })
            .catch(onError);
    }, [noteID, onError]);

    useEffect(load, [load]);

    const apply = useCallback((op: SheetOp) => {
        return api.editSheet(noteID, op)
            .then((next) => {
                setState(next);
                setRevision((value) => value + 1);
                bumpSheetRevision();
                onChanged();
                return next;
            })
            .catch((error: unknown) => {
                onError(error);
                return null;
            });
    }, [noteID, onChanged, onError]);

    const history = useEditorHistory(noteID, () => {
        bumpSheetRevision();
        load();
        onChanged();
    }, () => undefined, onError);

    const tables = useMemo(() => state?.tables.filter((table) => table.tabId === tabID) ?? [], [state, tabID]);
    const objects = useMemo(() => state?.objects.filter((object) => object.tabId === tabID) ?? [], [state, tabID]);
    const table = useMemo(() => state?.tables.find((item) => item.id === selection?.tableID) ?? null, [state, selection]);
    const box: Box | null = selection && table ? expandBox(boxOf(selection), table.merges) : null;

    // 列或欄被刪除、復原之後，選取可能超出範圍。
    useEffect(() => {
        if (!selection) return;
        if (!table) {
            setSelection(null);
            return;
        }
        const anchor = clampCell(selection.anchor, table.rows.length, table.cols.length);
        const focus = clampCell(selection.focus, table.rows.length, table.cols.length);
        if (anchor.row !== selection.anchor.row || anchor.col !== selection.anchor.col || focus.row !== selection.focus.row || focus.col !== selection.focus.col) {
            setSelection({ ...selection, anchor, focus });
        }
    }, [table, selection]);

    const focusInput = useCallback(() => input.current?.focus({ preventScroll: true }), []);

    const select = useCallback((tableID: string, anchor: Cell, focus = anchor) => {
        setSelection({ tableID, anchor, focus });
        setObjectID(null);
        window.setTimeout(focusInput);
    }, [focusInput]);

    // 整欄選取時焦點可能落在被合併蓋住的格子，一律用左上角。
    const focusCell = table && selection ? mergeAnchor(table.merges, selection.focus) : null;
    const activeCell = table && focusCell ? table.cells[cellID(table, focusCell)] : undefined;
    const value = editing?.value ?? activeCell?.raw ?? "";

    const commit = useCallback(() => {
        if (!editing || !state) return;
        const target = state.tables.find((item) => item.id === editing.tableID);
        setEditing(null);
        formulaAnchor.current = null;
        if (!target) return;
        const row = target.rows[editing.cell.row]?.id;
        const col = target.cols[editing.cell.col]?.id;
        if (!row || !col) return;
        const before = target.cells[`${row}:${col}`]?.raw ?? "";
        if (before !== editing.value) void apply({ op: "setCells", cells: [{ row, col, raw: editing.value }] });
    }, [editing, state, apply]);

    // 關閉編輯器時，還在編輯的格子也要存。
    const commitOnClose = useRef(commit);
    commitOnClose.current = commit;
    useEffect(() => () => commitOnClose.current(), []);

    const startEditing = useCallback((initial: string | null) => {
        if (!table || !focusCell) return;
        setEditing({
            tableID: table.id,
            cell: focusCell,
            value: initial ?? activeCell?.raw ?? "",
            typed: initial !== null,
        });
        window.setTimeout(focusInput);
    }, [table, focusCell, activeCell, focusInput]);

    const moveBy = useCallback((rowStep: number, colStep: number, extend: boolean) => {
        if (!table || !selection) return;
        const hidden = new Set(table.rows.flatMap((row, index) => (table.hiddenRows.includes(row.id) ? [index] : [])));
        const next = stepCell(selection.focus, rowStep, colStep, { rows: table.rows.length, cols: table.cols.length, merges: table.merges, hidden });
        setSelection({ tableID: table.id, anchor: extend ? selection.anchor : next, focus: next });
    }, [table, selection]);

    /** 被篩選掉的列不動，和 Excel 一樣只處理看得見的。 */
    const rowIDs = (target: SheetTable, area: Box) =>
        target.rows.slice(area.top, area.bottom + 1).map((row) => row.id).filter((id) => !target.hiddenRows.includes(id));
    const colIDs = (target: SheetTable, area: Box) => target.cols.slice(area.left, area.right + 1).map((col) => col.id);

    const style = (patch: StylePatch) => {
        if (!table || !box) return;
        void apply({ op: "setStyle", rows: rowIDs(table, box), cols: colIDs(table, box), style: patch });
    };

    const clear = () => {
        if (!table || !box) return;
        void apply({ op: "clear", rows: rowIDs(table, box), cols: colIDs(table, box) });
    };

    /**
     * 文字給一般程式，HTML 帶著來源範圍：貼進 Writer 時連得回來，貼回同一個表格時公式跟著移動。
     * 剪下之後來源就空了，所以不帶範圍。
     */
    const copyCells = (data: DataTransfer, linked: boolean) => {
        if (!table || !box) return;
        const ids = rowIDs(table, box);
        const rows = ids.map((row) => table.cols.slice(box.left, box.right + 1).map((col) => table.cells[`${row}:${col.id}`]?.display ?? ""));
        data.setData("text/plain", toClipboard(rows));
        if (linked) data.setData("text/html", cellsToHtml({ noteId: noteID, tableId: table.id, rows: ids, cols: colIDs(table, box) }, rows));
    };

    /** 同一個表格裡貼上：連公式與樣式一起搬，參照跟著移動。選取比來源大時重複鋪滿。 */
    const pasteInternal = (data: DataTransfer) => {
        if (!table || !box) return false;
        const source = cellsFromHtml(data.getData("text/html"));
        if (!source || source.noteId !== noteID || source.tableId !== table.id) return false;
        const single = box.top === box.bottom && box.left === box.right;
        const area = single
            ? { top: box.top, left: box.left, bottom: box.top + source.rows.length - 1, right: box.left + source.cols.length - 1 }
            : box;
        if (area.bottom >= table.rows.length || area.right >= table.cols.length) return false;
        void apply({
            op: "fill",
            tableId: table.id,
            sourceRows: source.rows,
            sourceCols: source.cols,
            targetRows: rowIDs(table, area),
            targetCols: colIDs(table, area),
            series: false,
        });
        return true;
    };

    /** Ctrl+D、Ctrl+R：把選取的第一列或第一欄填到其餘的格子。 */
    const fillAcross = (down: boolean) => {
        if (!table || !box) return;
        const rows = rowIDs(table, box);
        const cols = colIDs(table, box);
        const [sourceRows, sourceCols, targetRows, targetCols] = down
            ? [rows.slice(0, 1), cols, rows.slice(1), cols]
            : [rows, cols.slice(0, 1), rows, cols.slice(1)];
        if (targetRows.length === 0 || targetCols.length === 0) return;
        void apply({ op: "fill", tableId: table.id, sourceRows, sourceCols, targetRows, targetCols, series: false });
    };

    const runFill = (target: SheetTable, from: Box, to: Box) => {
        void apply({
            op: "fill",
            tableId: target.id,
            sourceRows: rowIDs(target, from),
            sourceCols: colIDs(target, from),
            targetRows: rowIDs(target, to),
            targetCols: colIDs(target, to),
            series: true,
        });
        // 填好後選取包含新的格子。
        const anchor = { row: Math.min(from.top, to.top), col: Math.min(from.left, to.left) };
        const focus = { row: Math.max(from.bottom, to.bottom), col: Math.max(from.right, to.right) };
        select(target.id, anchor, focus);
    };

    /** 拖曳右下角的控制點，放開才填。 */
    const startFill = (evt: ReactPointerEvent, target: SheetTable, area: Box) => {
        if (evt.button !== 0) return;
        evt.preventDefault();
        evt.stopPropagation();
        commit();
        const host = (evt.currentTarget as Element).closest(".sheet-table");
        let latest: Box | null = null;
        const onMove = (move: PointerEvent) => {
            const under = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>("td[data-row]");
            if (!under || under.closest(".sheet-table") !== host) return;
            latest = fillTarget(area, { row: Number(under.dataset.row), col: Number(under.dataset.col) });
            setFillPreview(latest);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setFillPreview(null);
            if (latest) runFill(target, area, latest);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    /** 雙擊控制點：往下填到旁邊那欄資料的最後一列。 */
    const fillToEnd = (target: SheetTable, area: Box) => {
        const neighbour = area.left > 0 ? area.left - 1 : area.right + 1;
        const col = target.cols[neighbour]?.id;
        if (!col) return;
        let bottom = area.bottom;
        while (bottom + 1 < target.rows.length && target.cells[`${target.rows[bottom + 1].id}:${col}`]?.display) bottom += 1;
        if (bottom > area.bottom) runFill(target, area, { ...area, top: area.bottom + 1, bottom });
    };

    /** 內容列的不重複內容，篩選選單用。 */
    const columnValues = (target: SheetTable, colID: string) => {
        const body = target.rows.slice(target.headerRows, target.rows.length - target.footerRows);
        const values = new Set(body.map((row) => target.cells[`${row.id}:${colID}`]?.display ?? ""));
        return [...values].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { numeric: true })));
    };

    const toggleMerge = () => {
        if (!table || !box) return;
        const rows = table.rows.slice(box.top, box.bottom + 1).map((row) => row.id);
        const cols = colIDs(table, box);
        if (boxHasMerge(box, table.merges)) {
            void apply({ op: "unmergeCells", tableId: table.id, rows, cols });
            return;
        }
        const filled = rows.flatMap((row) => cols.map((col) => table.cells[`${row}:${col}`]?.display)).filter(Boolean);
        const merge = () => void apply({ op: "mergeCells", tableId: table.id, rows, cols });
        if (filled.length > 1) setConfirm({ title: "合併這些格子？", detail: "只會留下第一格的內容，其他內容會清除。可以用 Ctrl+Z 復原。", run: merge });
        else merge();
        setSelection({ tableID: table.id, anchor: { row: box.top, col: box.left }, focus: { row: box.top, col: box.left } });
    };

    const goToFound = (found: Found) => {
        setSelection({ tableID: found.tableID, anchor: found, focus: found });
        setObjectID(null);
        window.requestAnimationFrame(() => {
            document.querySelector(`.sheet-table[data-id="${found.tableID}"] td[data-row="${found.row}"][data-col="${found.col}"]`)
                ?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    };

    const replaceCells = (cells: CellInput[]) => void apply({ op: "setCells", cells });

    const insertReference = (target: SheetTable, from: Cell, to: Cell) => {
        const anchor = formulaAnchor.current;
        if (!anchor || !editing) return;
        const prefix = target.id === editing.tableID ? "" : tablePrefix(target.name);
        const first = { row: Math.min(from.row, to.row), col: Math.min(from.col, to.col) };
        const last = { row: Math.max(from.row, to.row), col: Math.max(from.col, to.col) };
        const label = first.row === last.row && first.col === last.col ? cellLabel(first) : `${cellLabel(first)}:${cellLabel(last)}`;
        const reference = `${prefix}${label}`;
        const next = editing.value.slice(0, anchor.start) + reference + editing.value.slice(anchor.end);
        formulaAnchor.current = { ...anchor, end: anchor.start + reference.length };
        setEditing({ ...editing, value: next });
    };

    const cellFromEvent = (evt: { target: EventTarget }): Cell | null => {
        const cell = (evt.target as Element).closest?.("td[data-row]") as HTMLElement | null;
        if (!cell) return null;
        return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
    };

    const onTablePointerDown = (evt: ReactPointerEvent, target: SheetTable) => {
        const cell = cellFromEvent(evt);
        if (!cell) return;
        if (evt.button === 2) {
            const inside = table?.id === target.id && box
                && cell.row >= box.top && cell.row <= box.bottom && cell.col >= box.left && cell.col <= box.right;
            if (!inside) select(target.id, cell);
            return;
        }
        evt.preventDefault();
        // 公式編輯中點別的格子是插入參照。
        if (editing && editing.value.startsWith("=") && !(editing.tableID === target.id && editing.cell.row === cell.row && editing.cell.col === cell.col)) {
            const at = input.current?.selectionStart ?? editing.value.length;
            formulaAnchor.current ??= { cell, start: at, end: at, tableID: target.id };
            formulaAnchor.current.cell = cell;
            insertReference(target, cell, cell);
            dragging.current = true;
            return;
        }
        commit();
        if (evt.shiftKey && selection?.tableID === target.id) {
            setSelection({ ...selection, focus: cell });
            window.setTimeout(focusInput);
            return;
        }
        select(target.id, cell);
        dragging.current = true;
    };

    const onTablePointerOver = (evt: ReactPointerEvent, target: SheetTable) => {
        if (!dragging.current) return;
        const cell = cellFromEvent(evt);
        if (!cell) return;
        if (formulaAnchor.current) {
            if (formulaAnchor.current.tableID === target.id) insertReference(target, formulaAnchor.current.cell, cell);
            return;
        }
        setSelection((current) => (current?.tableID === target.id ? { ...current, focus: cell } : current));
    };

    useEffect(() => {
        const stop = () => {
            dragging.current = false;
            if (formulaAnchor.current) window.setTimeout(focusInput);
        };
        window.addEventListener("pointerup", stop);
        return () => window.removeEventListener("pointerup", stop);
    }, [focusInput]);

    const onKeyDown = (evt: KeyboardEvent<HTMLTextAreaElement>) => {
        if (evt.nativeEvent.isComposing || composing.current) return;
        if (!editing && history(evt)) return;
        const ctrl = evt.ctrlKey || evt.metaKey;
        if (editing) {
            if (evt.key === "Escape") {
                evt.preventDefault();
                setEditing(null);
                formulaAnchor.current = null;
            } else if (evt.key === "Enter" && !evt.altKey) {
                evt.preventDefault();
                commit();
                moveBy(evt.shiftKey ? -1 : 1, 0, false);
            } else if (evt.key === "Tab") {
                evt.preventDefault();
                commit();
                moveBy(0, evt.shiftKey ? -1 : 1, false);
            } else if (editing.typed && evt.key.startsWith("Arrow") && !editing.value.startsWith("=")) {
                evt.preventDefault();
                commit();
                moveBy(evt.key === "ArrowDown" ? 1 : evt.key === "ArrowUp" ? -1 : 0, evt.key === "ArrowRight" ? 1 : evt.key === "ArrowLeft" ? -1 : 0, false);
            }
            return;
        }
        if (!selection || !table) return;
        const steps: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
        if (evt.key in steps) {
            evt.preventDefault();
            moveBy(steps[evt.key][0], steps[evt.key][1], evt.shiftKey);
        } else if (evt.key === "Enter") {
            evt.preventDefault();
            moveBy(evt.shiftKey ? -1 : 1, 0, false);
        } else if (evt.key === "Tab") {
            evt.preventDefault();
            moveBy(0, evt.shiftKey ? -1 : 1, false);
        } else if (evt.key === "F2") {
            evt.preventDefault();
            startEditing(null);
        } else if (evt.key === "Delete" || evt.key === "Backspace") {
            evt.preventDefault();
            clear();
        } else if (evt.key === "Escape") {
            // 交給全螢幕處理。
        } else if (ctrl && evt.key.toLowerCase() === "b") {
            evt.preventDefault();
            style({ bold: !activeCell?.bold });
        } else if (ctrl && evt.key.toLowerCase() === "i") {
            evt.preventDefault();
            style({ italic: !activeCell?.italic });
        } else if (ctrl && evt.key.toLowerCase() === "u") {
            evt.preventDefault();
            style({ underline: !activeCell?.underline });
        } else if (ctrl && evt.key.toLowerCase() === "f") {
            evt.preventDefault();
            setFinding(true);
        } else if (ctrl && evt.key.toLowerCase() === "d") {
            evt.preventDefault();
            fillAcross(true);
        } else if (ctrl && evt.key.toLowerCase() === "r") {
            evt.preventDefault();
            fillAcross(false);
        } else if (ctrl && evt.key.toLowerCase() === "a") {
            evt.preventDefault();
            setSelection({ tableID: table.id, anchor: { row: 0, col: 0 }, focus: { row: table.rows.length - 1, col: table.cols.length - 1 } });
        }
    };

    const addTable = () => {
        if (!tabID) return;
        const bottom = tables.reduce((most, item) => Math.max(most, item.y + item.rows.reduce((sum, row) => sum + row.size, 0)), 0);
        void apply({ op: "addTable", tabId: tabID, x: 40, y: tables.length ? bottom + DEFAULT_TABLE_GAP : 40 });
    };

    const createChart = (kind: ChartKind) => {
        setCharts(false);
        if (!table || !box || !tabID) return;
        const source: CellRange = { noteId: noteID, tableId: table.id, rows: rowIDs(table, box), cols: colIDs(table, box) };
        api.createChart(source, tabID, kind)
            .then((created) => {
                setState(created.sheet);
                setRevision((next) => next + 1);
                onChanged();
                const object = created.sheet.objects.find((item) => item.noteId === created.note.id);
                if (object) setObjectID(object.id);
            })
            .catch(onError);
    };

    const openCellMenu = (evt: { clientX: number; clientY: number }, target: SheetTable) => {
        if (!box) return;
        const rows = rowIDs(target, box);
        const cols = colIDs(target, box);
        const rowCount = rows.length;
        const colCount = cols.length;
        const items: MenuItem[] = [
            { label: "上方插入列", onSelect: () => void apply({ op: "insertRows", tableId: target.id, before: rows[0], count: rowCount }) },
            { label: "下方插入列", onSelect: () => void apply({ op: "insertRows", tableId: target.id, after: rows[rows.length - 1], count: rowCount }) },
            { label: "左側插入欄", onSelect: () => void apply({ op: "insertCols", tableId: target.id, before: cols[0], count: colCount }) },
            { label: "右側插入欄", onSelect: () => void apply({ op: "insertCols", tableId: target.id, after: cols[cols.length - 1], count: colCount }) },
            {
                label: `刪除 ${rowCount} 列`,
                disabledReason: rowCount >= target.rows.length ? "表格至少要留一列" : undefined,
                onSelect: () => void apply({ op: "deleteRows", tableId: target.id, ids: rows }),
            },
            {
                label: `刪除 ${colCount} 欄`,
                disabledReason: colCount >= target.cols.length ? "表格至少要留一欄" : undefined,
                onSelect: () => void apply({ op: "deleteCols", tableId: target.id, ids: cols }),
            },
            { label: boxHasMerge(box, target.merges) ? "取消合併" : "合併儲存格", onSelect: toggleMerge },
            { label: "向下填滿 (Ctrl+D)", onSelect: () => fillAcross(true) },
            { label: "向右填滿 (Ctrl+R)", onSelect: () => fillAcross(false) },
            { label: "由小到大排序", onSelect: () => void apply({ op: "sort", tableId: target.id, colId: cols[0], descending: false }) },
            { label: "由大到小排序", onSelect: () => void apply({ op: "sort", tableId: target.id, colId: cols[0], descending: true }) },
        ];
        setMenu({ x: evt.clientX, y: evt.clientY, items });
    };

    const openTableMenu = (evt: { clientX: number; clientY: number }, target: SheetTable) => {
        const toggle = (label: string, on: boolean, patch: object) => ({
            label: on ? `✓ ${label}` : label,
            onSelect: () => void apply({ op: "patchTable", id: target.id, ...patch }),
        });
        setMenu({
            x: evt.clientX,
            y: evt.clientY,
            items: [
                { label: "重新命名表格", onSelect: () => setRenaming({ kind: "table", id: target.id }) },
                toggle("標題列", target.headerRows > 0, { headerRows: target.headerRows > 0 ? 0 : 1 }),
                toggle("標題欄", target.headerCols > 0, { headerCols: target.headerCols > 0 ? 0 : 1 }),
                toggle("總計列", target.footerRows > 0, { footerRows: target.footerRows > 0 ? 0 : 1 }),
                {
                    label: "刪除表格",
                    onSelect: () => setConfirm({
                        title: `刪除「${target.name}」？`,
                        detail: "公式、引入內容與圖表裡指向這個表格的地方都會失效。",
                        run: () => void apply({ op: "deleteTable", id: target.id }),
                    }),
                },
            ],
        });
    };

    /** 拖曳移動表格或圖表，放開才寫回去。 */
    const dragItem = (evt: ReactPointerEvent, start: { id: string; x: number; y: number }, commitMove: (x: number, y: number) => void) => {
        evt.preventDefault();
        evt.stopPropagation();
        const origin = { x: evt.clientX, y: evt.clientY };
        let latest = { x: start.x, y: start.y };
        const onMove = (move: PointerEvent) => {
            latest = {
                x: Math.max(0, start.x + move.clientX - origin.x),
                y: Math.max(0, start.y + move.clientY - origin.y),
            };
            setGhost({ id: start.id, ...latest });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            if (latest.x !== start.x || latest.y !== start.y) {
                commitMove(latest.x, latest.y);
                window.setTimeout(() => setGhost(null), 60);
            } else {
                setGhost(null);
            }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const resizeObject = (evt: ReactPointerEvent, object: SheetObject) => {
        evt.preventDefault();
        evt.stopPropagation();
        const origin = { x: evt.clientX, y: evt.clientY };
        let size = { w: object.w, h: object.h };
        const onMove = (move: PointerEvent) => {
            size = {
                w: Math.max(200, object.w + move.clientX - origin.x),
                h: Math.max(140, object.h + move.clientY - origin.y),
            };
            setGhost({ id: object.id, x: object.x, y: object.y, ...size });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            void apply({ op: "moveObject", id: object.id, x: object.x, y: object.y, ...size });
            window.setTimeout(() => setGhost(null), 60);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const resizeAxis = (evt: ReactPointerEvent, kind: "row" | "col", id: string, size: number) => {
        evt.preventDefault();
        evt.stopPropagation();
        const origin = kind === "row" ? evt.clientY : evt.clientX;
        let latest = size;
        const onMove = (move: PointerEvent) => {
            latest = Math.max(20, size + (kind === "row" ? move.clientY : move.clientX) - origin);
            setState((current) => current && {
                ...current,
                tables: current.tables.map((item) => ({
                    ...item,
                    [kind === "row" ? "rows" : "cols"]: item[kind === "row" ? "rows" : "cols"].map((axis) => (axis.id === id ? { ...axis, size: latest } : axis)),
                })),
            });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            void apply(kind === "row" ? { op: "setRowHeight", id, size: latest } : { op: "setColWidth", id, size: latest });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const placedCards = useMemo(
        () => new Set(objects.filter((item) => item.noteType !== "chart").map((item) => item.noteId)),
        [objects],
    );

    /** `x`、`y` 是頁面上的座標。放好就選取，和白板一樣。 */
    const placeCard = (target: string, x: number, y: number) => {
        if (!tabID) return;
        void apply({ op: "placeCard", tabId: tabID, target, x, y }).then((next) => {
            const placed = next?.objects.find((item) => item.tabId === tabID && item.noteId === target);
            if (placed) setObjectID(placed.id);
        });
    };

    useCardSurface(onSurface, "工作表", placedCards, {
        placeAt: (target, clientX, clientY) => {
            const scroller = document.elementFromPoint(clientX, clientY)?.closest(".sheet-page");
            const canvas = scroller?.querySelector(".sheet-canvas")?.getBoundingClientRect();
            if (canvas) placeCard(target, clientX - canvas.left, clientY - canvas.top);
        },
        placeAtCenter: (target) => {
            const scroller = pageRef.current;
            if (scroller) placeCard(target, scroller.scrollLeft + scroller.clientWidth / 2, scroller.scrollTop + scroller.clientHeight / 2);
        },
    });

    if (!state) return <div className="sheet-editor" />;

    const merged = box !== null && table !== null && boxHasMerge(box, table.merges);
    const filterTable = filterMenu ? state.tables.find((item) => item.id === filterMenu.tableID) : undefined;

    const contentWidth = Math.max(
        ...tables.map((item) => item.x + item.cols.reduce((sum, col) => sum + col.size, 0)),
        ...objects.map((item) => item.x + item.w),
        0,
    ) + PAGE_PADDING;
    const contentHeight = Math.max(
        ...tables.map((item) => item.y + item.rows.reduce((sum, row) => sum + row.size, 0)),
        ...objects.map((item) => item.y + item.h),
        0,
    ) + PAGE_PADDING;
    const object = objects.find((item) => item.id === objectID) ?? null;

    return (
        <div className="sheet-editor">
            <div className="sheet-header">
                <DocumentTitle noteID={noteID} placeholder="未命名試算表" className="sheet-title" onChanged={onChanged} onError={onError} />
                <div className="sheet-tabs" role="tablist">
                    {state.tabs.map((tab) => (
                        renaming?.kind === "tab" && renaming.id === tab.id ? (
                            <NameInput
                                key={tab.id}
                                className="sheet-tab-input"
                                value={tab.name}
                                onCancel={() => setRenaming(null)}
                                onSubmit={(name) => {
                                    setRenaming(null);
                                    if (name.trim() && name !== tab.name) void apply({ op: "renameTab", id: tab.id, name });
                                }}
                            />
                        ) : (
                            <button
                                key={tab.id}
                                role="tab"
                                aria-selected={tab.id === tabID}
                                onClick={() => {
                                    commit();
                                    setSelection(null);
                                    setObjectID(null);
                                    setTabID(tab.id);
                                }}
                                onDoubleClick={() => setRenaming({ kind: "tab", id: tab.id })}
                                onContextMenu={(evt) => {
                                    evt.preventDefault();
                                    setMenu({
                                        x: evt.clientX,
                                        y: evt.clientY,
                                        items: [
                                            { label: "重新命名", onSelect: () => setRenaming({ kind: "tab", id: tab.id }) },
                                            {
                                                label: "刪除工作表",
                                                disabledReason: state.tabs.length < 2 ? "至少要留一個工作表" : undefined,
                                                onSelect: () => setConfirm({
                                                    title: `刪除「${tab.name}」？`,
                                                    detail: "上面的表格與圖表位置都會移除。",
                                                    run: () => void apply({ op: "deleteTab", id: tab.id }),
                                                }),
                                            },
                                        ],
                                    });
                                }}
                            >
                                {tab.name}
                            </button>
                        )
                    ))}
                    <button title="新增工作表" onClick={() => void apply({ op: "addTab" }).then((next) => {
                        if (next) setTabID(next.tabs[next.tabs.length - 1].id);
                    })}>+</button>
                </div>
            </div>
            <div className="sheet-toolbar note-format-bar">
                <button onClick={addTable}>新增表格</button>
                <div className="sheet-popover-host">
                    <button aria-expanded={charts} disabled={!selection} title={selection ? "用選取的格子建立圖表" : "先選取資料"} onClick={() => setCharts(!charts)}>
                        圖表 ▾
                    </button>
                    {charts && (
                        <div className="sheet-popover">
                            {CHART_KINDS.map(({ id, label }) => <button key={id} onClick={() => createChart(id)}>{label}</button>)}
                        </div>
                    )}
                </div>
                <span className="note-format-divider" />
                <button disabled={!selection} aria-pressed={activeCell?.bold ?? false} title="粗體 (Ctrl+B)" onClick={() => style({ bold: !activeCell?.bold })}><b>B</b></button>
                <button disabled={!selection} aria-pressed={activeCell?.italic ?? false} title="斜體 (Ctrl+I)" onClick={() => style({ italic: !activeCell?.italic })}><i>I</i></button>
                <button disabled={!selection} aria-pressed={activeCell?.underline ?? false} title="底線 (Ctrl+U)" onClick={() => style({ underline: !activeCell?.underline })}><u>U</u></button>
                <button disabled={!selection} aria-pressed={activeCell?.strike ?? false} title="刪除線" onClick={() => style({ strike: !activeCell?.strike })}><s>S</s></button>
                <span className="note-format-divider" />
                {(["left", "center", "right"] as const).map((align, index) => (
                    <button key={align} disabled={!selection} aria-pressed={activeCell?.align === align} title={["靠左", "置中", "靠右"][index]} onClick={() => style({ align: activeCell?.align === align ? "" : align })}>
                        {["⇤", "↔", "⇥"][index]}
                    </button>
                ))}
                <span className="note-format-divider" />
                <select aria-label="數字格式" disabled={!selection} value={activeCell?.format ?? ""} onChange={(evt) => style({ format: evt.target.value })}>
                    {FORMATS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
                <select aria-label="底色" disabled={!selection} value={activeCell?.fill ?? ""} onChange={(evt) => style({ fill: evt.target.value })}>
                    {FILLS.map((fill, index) => <option key={fill} value={fill}>{index === 0 ? "底色" : `底色 ${index}`}</option>)}
                </select>
                <select aria-label="文字顏色" disabled={!selection} value={activeCell?.color ?? ""} onChange={(evt) => style({ color: evt.target.value })}>
                    {COLORS.map((color, index) => <option key={color} value={color}>{index === 0 ? "文字色" : `文字色 ${index}`}</option>)}
                </select>
                <span className="note-format-divider" />
                <button
                    disabled={!box || (box.top === box.bottom && box.left === box.right)}
                    aria-pressed={merged}
                    title={merged ? "取消合併" : "合併選取的格子"}
                    onClick={toggleMerge}
                >
                    {merged ? "取消合併" : "合併"}
                </button>
                <button
                    disabled={!table}
                    aria-pressed={table?.filterOn ?? false}
                    title="在欄標題上開關排序與篩選"
                    onClick={() => {
                        if (table) void apply({ op: "patchTable", id: table.id, filter: !table.filterOn });
                    }}
                >
                    篩選
                </button>
                <button title="尋找與取代 (Ctrl+F)" onClick={() => setFinding(true)}>尋找</button>
            </div>
            {finding && <FindBar tables={tables} onGo={goToFound} onReplace={replaceCells} onClose={() => { setFinding(false); focusInput(); }} />}
            <div className="sheet-formula">
                <span className="sheet-formula-label">{focusCell ? cellLabel(focusCell) : ""}</span>
                <span className="sheet-formula-fx">fx</span>
                <input
                    aria-label="公式列"
                    disabled={!selection}
                    value={value}
                    onChange={(evt) => {
                        if (!table || !selection) return;
                        setEditing({ tableID: table.id, cell: focusCell ?? selection.focus, value: evt.target.value, typed: false });
                    }}
                    onKeyDown={(evt) => {
                        if (evt.nativeEvent.isComposing) return;
                        if (evt.key === "Enter") {
                            evt.preventDefault();
                            commit();
                            focusInput();
                        }
                        if (evt.key === "Escape") {
                            evt.preventDefault();
                            setEditing(null);
                            focusInput();
                        }
                    }}
                />
            </div>
            <div
                ref={pageRef}
                className="sheet-page"
                onPointerDown={(evt) => {
                    if (evt.target !== evt.currentTarget && !(evt.target as Element).classList.contains("sheet-canvas")) return;
                    commit();
                    setSelection(null);
                    setObjectID(null);
                }}
            >
                <div className="sheet-canvas" style={{ width: contentWidth, height: contentHeight }}>
                    {tables.map((item) => {
                        const moved = ghost?.id === item.id ? ghost : null;
                        const active = selection?.tableID === item.id;
                        const rowOffsets = offsetsOf(item.rows.map((row) => (item.hiddenRows.includes(row.id) ? 0 : row.size)));
                        const colOffsets = offsetsOf(item.cols.map((col) => col.size));
                        const area = active && box ? box : null;
                        const editingHere = editing?.tableID === item.id ? editing : null;
                        const caret = editingHere?.cell ?? (active ? focusCell : null);
                        const caretMerge = caret ? mergeAt(item.merges, caret) : undefined;
                        const caretRight = caret ? caret.col + (caretMerge?.cols ?? 1) : 0;
                        const caretBottom = caret ? caret.row + (caretMerge?.rows ?? 1) : 0;
                        return (
                            <div key={item.id} className="sheet-table" data-id={item.id} data-active={active} style={{ left: moved?.x ?? item.x, top: moved?.y ?? item.y }}>
                                <div
                                    className="sheet-table-title"
                                    onDoubleClick={() => setRenaming({ kind: "table", id: item.id })}
                                    onContextMenu={(evt) => {
                                        evt.preventDefault();
                                        openTableMenu(evt, item);
                                    }}
                                >
                                    {renaming?.kind === "table" && renaming.id === item.id ? (
                                        <NameInput
                                            className="sheet-table-name-input"
                                            value={item.name}
                                            onCancel={() => setRenaming(null)}
                                            onSubmit={(name) => {
                                                setRenaming(null);
                                                if (name !== item.name) void apply({ op: "patchTable", id: item.id, name });
                                            }}
                                        />
                                    ) : item.name}
                                </div>
                                <button
                                    className="sheet-move"
                                    title="拖曳移動表格，右鍵開啟選單"
                                    onPointerDown={(evt) => dragItem(evt, item, (x, y) => void apply({ op: "patchTable", id: item.id, x, y }))}
                                    onContextMenu={(evt) => {
                                        evt.preventDefault();
                                        openTableMenu(evt, item);
                                    }}
                                />
                                {active && (
                                    <>
                                        <div className="sheet-cols" style={{ width: colOffsets[colOffsets.length - 1] }}>
                                            {item.cols.map((col, index) => (
                                                <button
                                                    key={col.id}
                                                    style={{ left: colOffsets[index], width: col.size }}
                                                    data-picked={area !== null && index >= area.left && index <= area.right}
                                                    onPointerDown={(evt) => {
                                                        evt.preventDefault();
                                                        if (evt.button !== 0) return;
                                                        commit();
                                                        select(item.id, { row: 0, col: index }, { row: item.rows.length - 1, col: index });
                                                    }}
                                                    onContextMenu={(evt) => {
                                                        evt.preventDefault();
                                                        openCellMenu(evt, item);
                                                    }}
                                                >
                                                    {colLabel(index)}
                                                    <span className="sheet-resize" onPointerDown={(evt) => resizeAxis(evt, "col", col.id, col.size)} />
                                                </button>
                                            ))}
                                        </div>
                                        <div className="sheet-rows" style={{ height: rowOffsets[rowOffsets.length - 1] }}>
                                            {item.rows.map((row, index) => (item.hiddenRows.includes(row.id) ? null : (
                                                <button
                                                    key={row.id}
                                                    style={{ top: rowOffsets[index], height: row.size }}
                                                    data-picked={area !== null && index >= area.top && index <= area.bottom}
                                                    onPointerDown={(evt) => {
                                                        evt.preventDefault();
                                                        if (evt.button !== 0) return;
                                                        commit();
                                                        select(item.id, { row: index, col: 0 }, { row: index, col: item.cols.length - 1 });
                                                    }}
                                                    onContextMenu={(evt) => {
                                                        evt.preventDefault();
                                                        openCellMenu(evt, item);
                                                    }}
                                                >
                                                    {index + 1}
                                                    <span className="sheet-resize" onPointerDown={(evt) => resizeAxis(evt, "row", row.id, row.size)} />
                                                </button>
                                            )))}
                                        </div>
                                    </>
                                )}
                                <div
                                    className="sheet-body"
                                    onPointerDown={(evt) => onTablePointerDown(evt, item)}
                                    onPointerOver={(evt) => onTablePointerOver(evt, item)}
                                    onDoubleClick={(evt) => {
                                        if (cellFromEvent(evt)) startEditing(null);
                                    }}
                                    onContextMenu={(evt) => {
                                        evt.preventDefault();
                                        if (cellFromEvent(evt)) openCellMenu(evt, item);
                                    }}
                                >
                                    <TableGrid table={item} />
                                    {area && (
                                        <div
                                            className="sheet-selection"
                                            style={{
                                                left: colOffsets[area.left],
                                                top: rowOffsets[area.top],
                                                width: colOffsets[area.right + 1] - colOffsets[area.left],
                                                height: rowOffsets[area.bottom + 1] - rowOffsets[area.top],
                                            }}
                                        />
                                    )}
                                    {area && fillPreview && (
                                        <div
                                            className="sheet-fill-preview"
                                            style={{
                                                left: colOffsets[fillPreview.left],
                                                top: rowOffsets[fillPreview.top],
                                                width: colOffsets[fillPreview.right + 1] - colOffsets[fillPreview.left],
                                                height: rowOffsets[fillPreview.bottom + 1] - rowOffsets[fillPreview.top],
                                            }}
                                        />
                                    )}
                                    {area && !editingHere && (
                                        <span
                                            className="sheet-fill-handle"
                                            title="拖曳自動填充，雙擊填到底"
                                            style={{ left: colOffsets[area.right + 1], top: rowOffsets[area.bottom + 1] }}
                                            onPointerDown={(evt) => startFill(evt, item, area)}
                                            onDoubleClick={(evt) => {
                                                evt.stopPropagation();
                                                fillToEnd(item, area);
                                            }}
                                        />
                                    )}
                                    {item.filterOn && item.headerRows > 0 && item.cols.map((col, index) => {
                                        const on = col.id in item.filters;
                                        return (
                                            <button
                                                key={col.id}
                                                className="sheet-filter-button"
                                                data-on={on}
                                                title={on ? "已篩選" : "排序與篩選"}
                                                aria-label={`${colLabel(index)} 欄的排序與篩選`}
                                                style={{ left: colOffsets[index + 1] - 20, top: rowOffsets[item.headerRows] - 22 }}
                                                onPointerDown={(evt) => evt.stopPropagation()}
                                                onClick={(evt) => {
                                                    const rect = evt.currentTarget.getBoundingClientRect();
                                                    setFilterMenu({ tableID: item.id, colID: col.id, left: rect.left, top: rect.bottom + 4 });
                                                }}
                                            >
                                                {on ? "▼" : "▾"}
                                            </button>
                                        );
                                    })}
                                    {caret && (
                                        <textarea
                                            ref={input}
                                            className="sheet-input"
                                            data-editing={editingHere !== null}
                                            aria-label="儲存格"
                                            spellCheck={false}
                                            value={editingHere?.value ?? ""}
                                            style={{
                                                left: colOffsets[caret.col],
                                                top: rowOffsets[caret.row],
                                                width: Math.max(colOffsets[caretRight] - colOffsets[caret.col], editingHere ? 160 : 0),
                                                height: Math.max(rowOffsets[caretBottom] - rowOffsets[caret.row], item.rows[caret.row].size),
                                            }}
                                            onChange={(evt) => {
                                                if (editingHere) setEditing({ ...editingHere, value: evt.target.value });
                                                else startEditing(evt.target.value);
                                            }}
                                            onCompositionStart={() => {
                                                composing.current = true;
                                                if (!editingHere) startEditing("");
                                            }}
                                            onCompositionEnd={() => {
                                                composing.current = false;
                                            }}
                                            onKeyDown={onKeyDown}
                                            onCopy={(evt) => {
                                                if (editingHere) return;
                                                evt.preventDefault();
                                                copyCells(evt.clipboardData, true);
                                            }}
                                            onCut={(evt) => {
                                                if (editingHere) return;
                                                evt.preventDefault();
                                                copyCells(evt.clipboardData, false);
                                                clear();
                                            }}
                                            onPaste={(evt) => {
                                                if (editingHere || !selection || !table || !box) return;
                                                evt.preventDefault();
                                                if (pasteInternal(evt.clipboardData)) return;
                                                const values = parseClipboard(evt.clipboardData.getData("text/plain"));
                                                void apply({ op: "paste", tableId: table.id, row: table.rows[box.top].id, col: table.cols[box.left].id, values });
                                            }}
                                        />
                                    )}
                                </div>
                                {active && (
                                    <>
                                        <button className="sheet-grow sheet-grow-row" title="新增一列" onClick={() => void apply({ op: "insertRows", tableId: item.id, count: 1 })}>+</button>
                                        <button className="sheet-grow sheet-grow-col" title="新增一欄" onClick={() => void apply({ op: "insertCols", tableId: item.id, count: 1 })}>+</button>
                                    </>
                                )}
                            </div>
                        );
                    })}
                    {objects.map((item) => {
                        const moved = ghost?.id === item.id ? ghost : null;
                        return (
                            <div
                                key={item.id}
                                className="sheet-object"
                                data-selected={item.id === objectID}
                                style={{ left: moved?.x ?? item.x, top: moved?.y ?? item.y, width: moved?.w ?? item.w, height: moved?.h ?? item.h }}
                                data-editing={item.id === noteEditID}
                                onPointerDown={(evt) => {
                                    // Note 正在編輯時，按下去是選字，不是搬移。
                                    if (evt.button !== 0 || item.id === noteEditID) return;
                                    commit();
                                    setSelection(null);
                                    setObjectID(item.id);
                                    dragItem(evt, item, (x, y) => void apply({ op: "moveObject", id: item.id, x, y, w: item.w, h: item.h }));
                                }}
                                onDoubleClick={() => {
                                    if (item.noteType === "chart") onOpenChart(item.noteId);
                                    else if (item.noteType === "card") setNoteEditID(item.id);
                                    else onPeekCard(item.noteId);
                                }}
                                onContextMenu={(evt) => {
                                    evt.preventDefault();
                                    setObjectID(item.id);
                                    setMenu({
                                        x: evt.clientX,
                                        y: evt.clientY,
                                        items: [
                                            item.noteType === "chart"
                                                ? { label: "開啟圖表", onSelect: () => onOpenChart(item.noteId) }
                                                : item.noteType === "card"
                                                    ? { label: "編輯卡片", onSelect: () => setNoteEditID(item.id) }
                                                    : { label: "開啟卡片", onSelect: () => onPeekCard(item.noteId) },
                                            { label: "從頁面移除", onSelect: () => void apply({ op: "removeObject", id: item.id }) },
                                        ],
                                    });
                                }}
                            >
                                {item.noteType === "chart"
                                    ? <ChartView noteID={item.noteId} revision={revision} onError={onError} />
                                    : (
                                        <PlacedCard
                                            noteID={item.noteId}
                                            revision={cardRevision}
                                            renderNote={item.id === noteEditID ? (id) => (
                                                <EmbeddedNote
                                                    noteID={id}
                                                    revision={cardRevision}
                                                    onChanged={onCardChanged}
                                                    onOpenLink={onOpenLink}
                                                    onCardCreated={onCardCreated}
                                                    onClose={stopNoteEdit}
                                                    onError={onError}
                                                />
                                            ) : undefined}
                                            onError={onError}
                                        />
                                    )}
                                {item.id === objectID && <span className="sheet-object-resize" onPointerDown={(evt) => resizeObject(evt, item)} />}
                            </div>
                        );
                    })}
                    {tables.length === 0 && objects.length === 0 && <p className="library-empty sheet-empty">這個工作表是空的。按「新增表格」開始。</p>}
                </div>
            </div>
            {object?.noteType === "chart" && (
                <p className="sheet-object-hint">雙擊圖表可以更換種類。圖表會跟著選取的格子更新。</p>
            )}
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
            {filterMenu && filterTable && (
                <FilterMenu
                    key={`${filterMenu.tableID}:${filterMenu.colID}`}
                    left={filterMenu.left}
                    top={filterMenu.top}
                    values={columnValues(filterTable, filterMenu.colID)}
                    kept={filterTable.filters[filterMenu.colID] ?? null}
                    onSort={(descending) => {
                        setFilterMenu(null);
                        void apply({ op: "sort", tableId: filterMenu.tableID, colId: filterMenu.colID, descending });
                    }}
                    onApply={(values) => {
                        setFilterMenu(null);
                        void apply({ op: "setFilter", tableId: filterMenu.tableID, colId: filterMenu.colID, values });
                    }}
                    onClose={() => setFilterMenu(null)}
                />
            )}
            {confirm && (
                <ConfirmDialog
                    title={confirm.title}
                    detail={confirm.detail}
                    onConfirm={() => {
                        confirm.run();
                        setConfirm(null);
                    }}
                    onCancel={() => setConfirm(null)}
                />
            )}
        </div>
    );
}

export default SheetEditor;
