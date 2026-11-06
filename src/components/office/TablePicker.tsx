import { useEffect } from "react";
import { noteTitle } from "../../noteTypes.ts";
import type { Note, SheetState, SheetTable } from "../../types.ts";

const SAMPLE_COLS = 4;

interface TablePickerProps {
    note: Note;
    sheet: SheetState;
    /** 已經在這個白板上的表格。 */
    taken: ReadonlySet<string>;
    /** 換表格時，別的卡片顯示中的表格不能選；放置時選了會跳到原本那張。 */
    lockTaken: boolean;
    current?: string;
    onPick: (tableID: string) => void;
    onCancel: () => void;
}

/** 第一列的內容，表格名稱還是預設的「表格1」時靠它分辨。 */
function sample(table: SheetTable): string {
    const row = table.rows[0];
    if (!row) return "";
    return table.cols
        .slice(0, SAMPLE_COLS)
        .map((col) => table.cells[`${row.id}:${col.id}`]?.display ?? "")
        .filter(Boolean)
        .join(" · ");
}

/** 把 Excels 放到白板時，選要顯示哪一個表格。 */
function TablePicker({ note, sheet, taken, lockTaken, current, onPick, onCancel }: TablePickerProps) {
    useEffect(() => {
        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key !== "Escape") return;
            evt.preventDefault();
            evt.stopPropagation();
            onCancel();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [onCancel]);

    const tabs = sheet.tabs
        .map((tab) => ({ ...tab, tables: sheet.tables.filter((table) => table.tabId === tab.id) }))
        .filter((tab) => tab.tables.length > 0);

    return (
        <div className="confirm-backdrop">
            <div className="range-picker table-picker" role="dialog" aria-label="選擇表格">
                <h2>選擇要放到白板的表格</h2>
                <p className="library-empty">{noteTitle(note)}</p>
                <div className="table-picker-list">
                    {tabs.map((tab) => (
                        <section key={tab.id}>
                            {sheet.tabs.length > 1 && <h3>{tab.name}</h3>}
                            {tab.tables.map((table) => {
                                const isCurrent = table.id === current;
                                const isTaken = taken.has(table.id);
                                const status = isCurrent ? "目前顯示" : isTaken ? "已在白板上" : "";
                                return (
                                    <button
                                        key={table.id}
                                        disabled={isCurrent || (lockTaken && isTaken)}
                                        onClick={() => onPick(table.id)}
                                    >
                                        <span className="table-picker-name">
                                            <strong>{table.name}</strong>
                                            <span>{table.rows.length} 列 × {table.cols.length} 欄</span>
                                            {status && <span className="table-picker-status">{status}</span>}
                                        </span>
                                        <span className="table-picker-sample">{sample(table) || "空白表格"}</span>
                                    </button>
                                );
                            })}
                        </section>
                    ))}
                </div>
                <div className="confirm-actions">
                    <button className="open-button" onClick={onCancel}>取消</button>
                </div>
            </div>
        </div>
    );
}

export default TablePicker;
