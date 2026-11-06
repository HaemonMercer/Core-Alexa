import { useEffect, useMemo, useRef, useState } from "react";

const MENU_WIDTH = 240;
const MENU_HEIGHT = 380;
const MARGIN = 8;
const BLANK_LABEL = "（空白）";

interface FilterMenuProps {
    /** 按鈕的位置，選單開在它下面。 */
    left: number;
    top: number;
    /** 這一欄所有不重複的內容，包含被篩選掉的。 */
    values: string[];
    /** 目前留下的內容，null 是沒有篩選。 */
    kept: string[] | null;
    onSort: (descending: boolean) => void;
    onApply: (values: string[] | null) => void;
    onClose: () => void;
}

/** 欄標題上的下拉選單：排序，以及勾選要留下哪些內容。 */
function FilterMenu({ left, top, values, kept, onSort, onApply, onClose }: FilterMenuProps) {
    const [query, setQuery] = useState("");
    const [checked, setChecked] = useState(() => new Set(kept ?? values));
    const host = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (evt: PointerEvent) => {
            if (!host.current?.contains(evt.target as Node)) onClose();
        };
        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key !== "Escape") return;
            // 這次 Esc 是關選單，不能連全螢幕一起關掉。
            evt.preventDefault();
            evt.stopPropagation();
            onClose();
        };
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [onClose]);

    const visible = useMemo(() => {
        const wanted = query.trim().toLowerCase();
        return wanted ? values.filter((value) => value.toLowerCase().includes(wanted)) : values;
    }, [values, query]);

    const allVisible = visible.length > 0 && visible.every((value) => checked.has(value));

    const toggle = (value: string) => {
        const next = new Set(checked);
        if (!next.delete(value)) next.add(value);
        setChecked(next);
    };

    const toggleVisible = () => {
        const next = new Set(checked);
        for (const value of visible) {
            if (allVisible) next.delete(value);
            else next.add(value);
        }
        setChecked(next);
    };

    const apply = () => {
        // 有搜尋時只留下搜尋到的，和 Excel 一樣。
        const picked = values.filter((value) => checked.has(value) && visible.includes(value));
        onApply(picked.length === values.length ? null : picked);
    };

    return (
        <div
            ref={host}
            className="sheet-filter-menu"
            role="dialog"
            aria-label="排序與篩選"
            style={{
                left: Math.max(MARGIN, Math.min(left, window.innerWidth - MENU_WIDTH - MARGIN)),
                top: Math.max(MARGIN, Math.min(top, window.innerHeight - MENU_HEIGHT - MARGIN)),
            }}
        >
            <button className="sheet-filter-action" onClick={() => onSort(false)}>由小到大排序</button>
            <button className="sheet-filter-action" onClick={() => onSort(true)}>由大到小排序</button>
            <input
                autoFocus
                placeholder="搜尋"
                aria-label="搜尋內容"
                value={query}
                onChange={(evt) => setQuery(evt.target.value)}
                onKeyDown={(evt) => {
                    if (evt.key === "Enter" && !evt.nativeEvent.isComposing) apply();
                }}
            />
            <div className="sheet-filter-list">
                <label>
                    <input type="checkbox" checked={allVisible} onChange={toggleVisible} />
                    全選
                </label>
                {visible.map((value) => (
                    <label key={value} title={value}>
                        <input type="checkbox" checked={checked.has(value)} onChange={() => toggle(value)} />
                        <span>{value || BLANK_LABEL}</span>
                    </label>
                ))}
            </div>
            <div className="sheet-filter-buttons">
                <button onClick={() => onApply(null)} disabled={kept === null}>清除篩選</button>
                <button className="sheet-filter-apply" onClick={apply}>確定</button>
            </div>
        </div>
    );
}

export default FilterMenu;
