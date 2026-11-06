import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { WriterBlock } from "../../types.ts";
import ContextMenu from "../common/ContextMenu.tsx";
import { caretOnEdgeLine, markEmpty, readText, renderText, setCaret } from "./inline.ts";
import { clipboardTable, columnTemplate, deleteColumn, deleteRow, insertColumn, insertRow, overlayTable, type TableRows } from "./table.ts";

interface TableBlockProps {
    block: WriterBlock;
    revision: number;
    /** 第一格，讓編輯器能把游標放進來。 */
    register: (id: string, element: HTMLElement | null) => void;
    onType: (id: string, rows: TableRows) => void;
    onChange: (id: string, rows: TableRows) => void;
    onDelete: (id: string) => void;
    /** Ctrl+Z 這類按鍵，處理了就回傳 true。 */
    onHistory: (evt: KeyboardEvent<HTMLDivElement>) => boolean;
}

interface CellProps {
    text: string;
    revision: number;
    row: number;
    col: number;
    first: (element: HTMLElement | null) => void;
    onInput: (row: number, col: number, element: HTMLElement) => void;
    onKeyDown: (evt: KeyboardEvent<HTMLDivElement>, row: number, col: number) => void;
    onPaste: (evt: ClipboardEvent<HTMLDivElement>, row: number, col: number) => void;
    onContextMenu: (x: number, y: number, row: number, col: number) => void;
}

function Cell({ text, revision, row, col, first, onInput, onKeyDown, onPaste, onContextMenu }: CellProps) {
    const ref = useRef<HTMLDivElement>(null);

    // 打字時 DOM 才是最新的，只有結構改變才用資料重畫。
    useLayoutEffect(() => {
        const element = ref.current;
        if (element && readText(element, false) !== text) renderText(element, text, false);
        else if (element) markEmpty(element);
    }, [revision, text]);

    useLayoutEffect(() => {
        if (row === 0 && col === 0) first(ref.current);
    }, [row, col, first]);

    return (
        <div
            ref={ref}
            className="writer-text writer-cell"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            data-row={row}
            data-col={col}
            onInput={(evt) => onInput(row, col, evt.currentTarget)}
            onKeyDown={(evt) => onKeyDown(evt, row, col)}
            onPaste={(evt) => onPaste(evt, row, col)}
            onContextMenu={(evt) => {
                evt.preventDefault();
                onContextMenu(evt.clientX, evt.clientY, row, col);
            }}
        />
    );
}

/** 可以直接編輯的表格。每列是一個 `.writer-table-row`，分頁時才能在列與列之間換頁。 */
function TableBlock({ block, revision, register, onType, onChange, onDelete, onHistory }: TableBlockProps) {
    const host = useRef<HTMLDivElement>(null);
    const rows = useRef<TableRows>(block.table ?? []);
    const focusAfter = useRef<{ row: number; col: number } | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null);
    const table = block.table ?? [];

    useLayoutEffect(() => {
        rows.current = block.table ?? [];
        const target = focusAfter.current;
        if (target) focusAfter.current = null;
        if (target) focusCell(target.row, target.col);
    }, [revision, block.table]);

    useLayoutEffect(() => () => register(block.id, null), [block.id, register]);

    const focusCell = (row: number, col: number, end = false) => {
        const cell = host.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
        if (cell) setCaret(cell, end ? "end" : 0);
        return Boolean(cell);
    };

    const change = (next: TableRows, focus?: { row: number; col: number }) => {
        focusAfter.current = focus ?? null;
        rows.current = next;
        onChange(block.id, next);
    };

    const onInput = (row: number, col: number, element: HTMLElement) => {
        markEmpty(element);
        rows.current = rows.current.map((cells) => [...cells]);
        rows.current[row][col] = readText(element, false);
        onType(block.id, rows.current);
    };

    const onKeyDown = (evt: KeyboardEvent<HTMLDivElement>, row: number, col: number) => {
        if (evt.nativeEvent.isComposing || onHistory(evt)) return;
        const height = rows.current.length;
        const width = rows.current[0].length;
        const ctrl = evt.ctrlKey || evt.metaKey;
        const key = evt.key.toLowerCase();
        if (ctrl && (key === "b" || key === "i")) {
            evt.preventDefault();
            document.execCommand(key === "b" ? "bold" : "italic");
            return;
        }
        if (evt.key === "Tab") {
            evt.preventDefault();
            const index = row * width + col + (evt.shiftKey ? -1 : 1);
            if (index >= height * width) change(insertRow(rows.current, height), { row: height, col: 0 });
            else if (index >= 0) focusCell(Math.floor(index / width), index % width);
            return;
        }
        if (evt.key === "Enter") {
            // 格子裡不換行，和試算表一樣往下一格。
            evt.preventDefault();
            focusCell(row + 1, col);
            return;
        }
        if (evt.key === "ArrowUp" && caretOnEdgeLine(evt.currentTarget, "top") && focusCell(row - 1, col, true)) evt.preventDefault();
        if (evt.key === "ArrowDown" && caretOnEdgeLine(evt.currentTarget, "bottom") && focusCell(row + 1, col)) evt.preventDefault();
    };

    const onPaste = (evt: ClipboardEvent<HTMLDivElement>, row: number, col: number) => {
        evt.preventDefault();
        const pasted = clipboardTable(evt.clipboardData);
        if (pasted) change(overlayTable(rows.current, row, col, pasted), { row, col });
        else document.execCommand("insertText", false, evt.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
    };

    const items = menu ? (() => {
        const { row, col } = menu;
        const remove = (next: TableRows | null) => (next ? change(next) : onDelete(block.id));
        return [
            { label: "在上方插入列", onSelect: () => change(insertRow(rows.current, row), { row, col }) },
            { label: "在下方插入列", onSelect: () => change(insertRow(rows.current, row + 1), { row: row + 1, col }) },
            { label: "在左側插入欄", onSelect: () => change(insertColumn(rows.current, col), { row, col }) },
            { label: "在右側插入欄", onSelect: () => change(insertColumn(rows.current, col + 1), { row, col: col + 1 }) },
            { label: "刪除這一列", onSelect: () => remove(deleteRow(rows.current, row)) },
            { label: "刪除這一欄", onSelect: () => remove(deleteColumn(rows.current, col)) },
            { label: "刪除表格", onSelect: () => onDelete(block.id) },
        ];
    })() : [];

    const first = (element: HTMLElement | null) => register(block.id, element);
    const template = columnTemplate(table);

    return (
        <div ref={host} className="writer-table">
            {table.map((cells, row) => (
                <div key={row} className="writer-table-row" style={{ gridTemplateColumns: template }}>
                    {cells.map((text, col) => (
                        <Cell
                            key={col}
                            text={text}
                            revision={revision}
                            row={row}
                            col={col}
                            first={first}
                            onInput={onInput}
                            onKeyDown={onKeyDown}
                            onPaste={onPaste}
                            onContextMenu={(x, y, atRow, atCol) => setMenu({ x, y, row: atRow, col: atCol })}
                        />
                    ))}
                </div>
            ))}
            {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
        </div>
    );
}

export default TableBlock;
