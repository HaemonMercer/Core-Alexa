import { useEffect, useMemo, useState } from "react";
import type { CellInput, SheetTable } from "../../types.ts";
import { findCells, replaceText, type Found } from "./grid.ts";

interface FindBarProps {
    /** 目前工作表上的表格。 */
    tables: SheetTable[];
    onGo: (found: Found) => void;
    onReplace: (cells: CellInput[]) => void;
    onClose: () => void;
}

/** 尋找與取代。公式算出來的內容找得到，但不會被取代，公式本身要自己改。 */
function FindBar({ tables, onGo, onReplace, onClose }: FindBarProps) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [index, setIndex] = useState(0);

    const matches = useMemo(() => findCells(tables, query), [tables, query]);
    const current = matches.length > 0 ? matches[Math.min(index, matches.length - 1)] : null;

    useEffect(() => {
        if (current) onGo(current);
        // 只在換到別格時才移動，其他內容改變時不要把選取搶走。
    }, [current?.tableID, current?.row, current?.col]);

    // 按鈕變成停用時焦點會離開這裡，所以 Esc 要在視窗上接，不然會關掉全螢幕。
    useEffect(() => {
        const onEscape = (evt: KeyboardEvent) => {
            if (evt.key !== "Escape" || evt.isComposing) return;
            evt.preventDefault();
            evt.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", onEscape, true);
        return () => window.removeEventListener("keydown", onEscape, true);
    }, [onClose]);

    const step = (by: number) => {
        if (matches.length > 0) setIndex((value) => (Math.min(value, matches.length - 1) + by + matches.length) % matches.length);
    };

    const inputOf = (found: Found): CellInput | null => {
        const table = tables.find((item) => item.id === found.tableID);
        const row = table?.rows[found.row]?.id;
        const col = table?.cols[found.col]?.id;
        const raw = row && col ? table?.cells[`${row}:${col}`]?.raw : undefined;
        if (!row || !col || raw === undefined || raw.startsWith("=")) return null;
        const next = replaceText(raw, query, replacement);
        return next === raw ? null : { row, col, raw: next };
    };

    const replaceOne = () => {
        const cell = current && inputOf(current);
        if (cell) onReplace([cell]);
        else step(1);
    };

    const replaceAll = () => {
        const cells = matches.map(inputOf).filter((cell) => cell !== null);
        if (cells.length > 0) onReplace(cells);
    };

    const onKeyDown = (evt: React.KeyboardEvent) => {
        if (evt.nativeEvent.isComposing) return;
        if (evt.key === "Enter") {
            evt.preventDefault();
            step(evt.shiftKey ? -1 : 1);
        }
    };

    return (
        <div className="sheet-find" role="search" onKeyDown={onKeyDown}>
            <input autoFocus placeholder="尋找" aria-label="尋找" value={query} onChange={(evt) => { setQuery(evt.target.value); setIndex(0); }} />
            <span className="sheet-find-count">{query ? `${matches.length > 0 ? Math.min(index, matches.length - 1) + 1 : 0} / ${matches.length}` : ""}</span>
            <button title="上一個 (Shift+Enter)" disabled={matches.length === 0} onClick={() => step(-1)}>▲</button>
            <button title="下一個 (Enter)" disabled={matches.length === 0} onClick={() => step(1)}>▼</button>
            <input placeholder="取代為" aria-label="取代為" value={replacement} onChange={(evt) => setReplacement(evt.target.value)} />
            <button disabled={!current} onClick={replaceOne}>取代</button>
            <button disabled={!current} onClick={replaceAll}>全部取代</button>
            <button title="關閉 (Esc)" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
    );
}

export default FindBar;
