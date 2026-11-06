import { useEffect, useMemo, useState } from "react";
import * as api from "../../api.ts";
import { noteTitle } from "../../noteTypes.ts";
import type { CellRange, Note, SheetState } from "../../types.ts";

interface SheetRangePickerProps {
    onPick: (source: CellRange) => void;
    onCancel: () => void;
    onError: (error: unknown) => void;
}

interface Corner {
    x: number;
    y: number;
}

/** 選一份試算表、一個表格，再拖曳選出要引入的格子。 */
function SheetRangePicker({ onPick, onCancel, onError }: SheetRangePickerProps) {
    const [sheets, setSheets] = useState<Note[] | null>(null);
    const [noteID, setNoteID] = useState<string | null>(null);
    const [state, setState] = useState<SheetState | null>(null);
    const [tableID, setTableID] = useState<string | null>(null);
    const [anchor, setAnchor] = useState<Corner | null>(null);
    const [focus, setFocus] = useState<Corner | null>(null);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        api.getNoteLibrary()
            .then((notes) => {
                const found = notes.filter((note) => note.type === "sheet");
                setSheets(found);
                setNoteID(found[0]?.id ?? null);
            })
            .catch(onError);
    }, [onError]);

    useEffect(() => {
        if (!noteID) return;
        let cancelled = false;
        api.getSheet(noteID)
            .then((next) => {
                if (cancelled) return;
                setState(next);
                setTableID(next.tables[0]?.id ?? null);
                setAnchor(null);
                setFocus(null);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, onError]);

    const table = useMemo(() => state?.tables.find((item) => item.id === tableID) ?? null, [state, tableID]);

    const box = anchor && focus && {
        left: Math.min(anchor.x, focus.x),
        right: Math.max(anchor.x, focus.x),
        top: Math.min(anchor.y, focus.y),
        bottom: Math.max(anchor.y, focus.y),
    };

    const confirm = () => {
        if (!noteID || !table || !box) return;
        onPick({
            noteId: noteID,
            tableId: table.id,
            rows: table.rows.slice(box.top, box.bottom + 1).map((row) => row.id),
            cols: table.cols.slice(box.left, box.right + 1).map((col) => col.id),
        });
    };

    return (
        <div className="confirm-backdrop" onPointerUp={() => setDragging(false)}>
            <div className="range-picker" role="dialog" aria-label="引入試算表的格子">
                <h2>引入試算表的格子</h2>
                {sheets?.length === 0 && <p className="library-empty">還沒有試算表。先到 Office Library 新增一份 Excels。</p>}
                {sheets && sheets.length > 0 && (
                    <div className="range-picker-sources">
                        <select aria-label="試算表" value={noteID ?? ""} onChange={(evt) => setNoteID(evt.target.value)}>
                            {sheets.map((note) => <option key={note.id} value={note.id}>{noteTitle(note)}</option>)}
                        </select>
                        <select
                            aria-label="表格"
                            value={tableID ?? ""}
                            onChange={(evt) => {
                                setTableID(evt.target.value);
                                setAnchor(null);
                                setFocus(null);
                            }}
                        >
                            {state?.tables.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                    </div>
                )}
                {table && (
                    <div className="range-picker-grid">
                        <table className="cells-view">
                            <tbody>
                                {table.rows.map((row, y) => (
                                    <tr key={row.id}>
                                        {table.cols.map((col, x) => (
                                            <td
                                                key={col.id}
                                                data-picked={box !== null && box !== undefined
                                                    && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom}
                                                onPointerDown={(evt) => {
                                                    evt.preventDefault();
                                                    setAnchor({ x, y });
                                                    setFocus({ x, y });
                                                    setDragging(true);
                                                }}
                                                onPointerEnter={() => {
                                                    if (dragging) setFocus({ x, y });
                                                }}
                                            >
                                                {table.cells[`${row.id}:${col.id}`]?.display ?? ""}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                <p className="library-empty">拖曳選取格子。來源改動時，引入的內容會跟著更新。</p>
                <div className="confirm-actions">
                    <button className="open-button" onClick={onCancel}>取消</button>
                    <button className="open-button" disabled={!box} onClick={confirm}>引入</button>
                </div>
            </div>
        </div>
    );
}

export default SheetRangePicker;
