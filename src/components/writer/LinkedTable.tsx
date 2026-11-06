import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../../api.ts";
import type { CellRange, CellView, RangeView } from "../../types.ts";
import { bumpSheetRevision } from "../office/officePreview.ts";
import { cellStyle } from "../sheet/cellStyle.ts";
import { setCaret } from "./inline.ts";
import { columnTemplate } from "./table.ts";

interface LinkedTableProps {
    source: CellRange;
    /** 來源可能改過時遞增，就會重新讀取。 */
    revision: number;
    /** 寫回 Excels 之後呼叫。 */
    onEdited: () => void;
    onError: (error: unknown) => void;
}

interface LinkedCellProps {
    cell: CellView;
    header: boolean;
    row: number;
    col: number;
    /** 每次讀取都不同，格子才會換成新的內容。 */
    stamp: RangeView;
    onCommit: (row: number, col: number, raw: string) => void;
    onMove: (row: number, col: number, step: "down" | "next" | "previous") => void;
    onHistory: (redo: boolean) => void;
}

function LinkedCell({ cell, header, row, col, stamp, onCommit, onMove, onHistory }: LinkedCellProps) {
    const ref = useRef<HTMLDivElement>(null);
    const editing = useRef(false);

    useLayoutEffect(() => {
        if (ref.current) ref.current.textContent = editing.current ? cell.raw : cell.display;
    }, [stamp, cell.raw, cell.display]);

    const onKeyDown = (evt: KeyboardEvent<HTMLDivElement>) => {
        if (evt.nativeEvent.isComposing) return;
        const element = evt.currentTarget;
        const key = evt.key.toLowerCase();
        if ((evt.ctrlKey || evt.metaKey) && (key === "z" || key === "y") && element.textContent === cell.raw) {
            evt.preventDefault();
            onHistory(key === "y" || evt.shiftKey);
            return;
        }
        if (evt.key === "Escape") {
            // 不然 Esc 會連全螢幕一起關掉。
            evt.preventDefault();
            element.textContent = cell.raw;
            element.blur();
            return;
        }
        if (evt.key === "Enter" || evt.key === "Tab") {
            evt.preventDefault();
            onMove(row, col, evt.key === "Enter" ? "down" : evt.shiftKey ? "previous" : "next");
        }
    };

    return (
        <div
            ref={ref}
            className="writer-cell"
            contentEditable="plaintext-only"
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            data-row={row}
            data-col={col}
            data-header={header}
            style={cellStyle(cell)}
            onFocus={(evt) => {
                // 編輯時看到的是公式本身，不是計算結果。
                editing.current = true;
                evt.currentTarget.textContent = cell.raw;
            }}
            onBlur={(evt) => {
                editing.current = false;
                const next = evt.currentTarget.textContent ?? "";
                if (next === cell.raw) evt.currentTarget.textContent = cell.display;
                else onCommit(row, col, next);
            }}
            onKeyDown={onKeyDown}
            onPaste={(evt) => {
                evt.preventDefault();
                document.execCommand("insertText", false, evt.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
            }}
        />
    );
}

/** 連到 Excels 的表格：內容每次從試算表讀取，在這裡改就是改 Excels。 */
function LinkedTable({ source, revision, onEdited, onError }: LinkedTableProps) {
    const [view, setView] = useState<RangeView | null>(null);
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        api.getCellRange(source)
            .then((next) => {
                if (!cancelled) setView(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [source, revision, onError]);

    if (!view) return null;
    if (view.error) return <p className="cells-error">{view.error}</p>;

    const changed = () => {
        bumpSheetRevision();
        onEdited();
    };

    const onCommit = (row: number, col: number, raw: string) => {
        const cells = [{ row: view.rowIds[row], col: view.colIds[col], raw }];
        api.editSheet(source.noteId, { op: "setCells", cells }).then(changed).catch(onError);
    };

    const onHistory = (redo: boolean) => {
        (redo ? api.redoNote(source.noteId) : api.undoNote(source.noteId))
            .then((done) => {
                if (done) changed();
            })
            .catch(onError);
    };

    const onMove = (row: number, col: number, step: "down" | "next" | "previous") => {
        const width = view.colIds.length;
        const index = step === "down" ? (row + 1) * width + col : row * width + col + (step === "next" ? 1 : -1);
        const target = host.current?.querySelector<HTMLElement>(`[data-row="${Math.floor(index / width)}"][data-col="${index % width}"]`);
        if (target && index >= 0) {
            target.focus();
            setCaret(target, "end");
        } else if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    };

    const template = columnTemplate(view.rows.map((row) => row.map((cell) => cell.display)));

    return (
        <div className="writer-linked">
            <p className="writer-linked-source" title="在這裡修改會同步到 Excels">
                連結 {[view.title || "未命名 Excels", view.tableName].filter(Boolean).join(" ▸ ")}
            </p>
            <div ref={host} className="writer-table" data-linked="true">
                {view.rows.map((cells, y) => (
                    <div key={view.rowIds[y]} className="writer-table-row" style={{ gridTemplateColumns: template }}>
                        {cells.map((cell, x) => (
                            <LinkedCell
                                key={view.colIds[x]}
                                cell={cell}
                                header={y < view.headerRows || x < view.headerCols}
                                row={y}
                                col={x}
                                stamp={view}
                                onCommit={onCommit}
                                onMove={onMove}
                                onHistory={onHistory}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

export default LinkedTable;
