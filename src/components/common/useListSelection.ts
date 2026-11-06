import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
    clickSelection,
    contextSelection,
    NO_SELECTION,
    selectedInOrder,
    type ListSelection,
} from "./listSelection.ts";

const startingWith = (id: string | null): ListSelection =>
    id ? { selected: new Set([id]), anchor: id } : NO_SELECTION;

/** Library 共用的多選：滑鼠點選，加上 Delete、Ctrl+A、Esc。 */
export function useListSelection(
    ordered: string[],
    initial: string | null,
    onDelete: (ids: string[]) => void,
) {
    const [selection, setSelection] = useState<ListSelection>(() => startingWith(initial));
    const latest = useRef({ ordered, selection, onDelete });
    latest.current = { ordered, selection, onDelete };

    useEffect(() => {
        const onKeyDown = (evt: KeyboardEvent) => {
            const target = evt.target as HTMLElement;
            // 打字時的 Delete 是刪字，不能變成刪卡片。
            if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
            // 確認框或右鍵選單開著、卡片全螢幕時，按鍵不是給清單的。
            if (document.querySelector(".confirm-backdrop, .context-menu, .card-fullscreen")) return;

            const { ordered: ids, selection: current, onDelete: remove } = latest.current;
            const chosen = selectedInOrder(current, ids);
            if ((evt.key === "Delete" || evt.key === "Backspace") && chosen.length > 0) {
                evt.preventDefault();
                remove(chosen);
            } else if (evt.key === "a" && (evt.ctrlKey || evt.metaKey)) {
                evt.preventDefault();
                setSelection({ selected: new Set(ids), anchor: ids[0] ?? null });
            } else if (evt.key === "Escape") {
                setSelection(NO_SELECTION);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return {
        selected: selection.selected,
        count: selectedInOrder(selection, ordered).length,
        click: (id: string, evt: MouseEvent) => {
            setSelection(clickSelection(selection, ordered, id, {
                toggle: evt.ctrlKey || evt.metaKey,
                range: evt.shiftKey,
            }));
        },
        /** 回傳右鍵選單要作用的項目。 */
        forContextMenu: (id: string) => {
            const next = contextSelection(selection, id);
            setSelection(next);
            return selectedInOrder(next, ordered);
        },
        selectOnly: (id: string | null) => setSelection(startingWith(id)),
    };
}
