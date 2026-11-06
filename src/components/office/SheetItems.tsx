import { noteTitle } from "../../noteTypes.ts";
import type { Note, SheetContents, SheetTableInfo } from "../../types.ts";
import { CHART_KINDS } from "../chart/layout.ts";

// Excels 裡的表格與圖表，Office Library 與白板右側共用同一種外觀。

const chartKind = (note: Note) => CHART_KINDS.find(({ id }) => id === note.context.kind)?.label ?? "圖表";

export function TableLabel({ table }: { table: SheetTableInfo }) {
    return (
        <>
            <span className="note-type-badge" data-type="sheet">表格</span>
            <strong>{table.name}</strong>
            <span className="sheet-item-detail">{table.rows} 列 × {table.cols} 欄</span>
        </>
    );
}

export function ChartLabel({ note }: { note: Note }) {
    return (
        <>
            <span className="note-type-badge" data-type="chart">圖表</span>
            <strong>{noteTitle(note)}</strong>
            <span className="sheet-item-detail">{chartKind(note)}</span>
        </>
    );
}

interface SheetToggleProps {
    contents: SheetContents;
    open: boolean;
    onToggle: () => void;
}

/** 疊在 Excels 卡片上；事件不往外傳，按它不算點選或拖曳卡片。 */
export function SheetToggle({ contents, open, onToggle }: SheetToggleProps) {
    const parts = [`${contents.tables.length} 個表格`];
    if (contents.charts.length > 0) parts.push(`${contents.charts.length} 張圖表`);
    return (
        <button
            className="sheet-toggle"
            aria-expanded={open}
            onPointerDown={(evt) => evt.stopPropagation()}
            onDoubleClick={(evt) => evt.stopPropagation()}
            onKeyDown={(evt) => evt.stopPropagation()}
            onClick={(evt) => {
                evt.stopPropagation();
                onToggle();
            }}
        >
            {open ? "▾" : "▸"} {parts.join("、")}
        </button>
    );
}
