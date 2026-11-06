// 清單的多選規則：一般點選、Ctrl 加選、Shift 選範圍，和檔案總管一樣。只處理 id，不認識畫面。

export interface ListSelection {
    selected: ReadonlySet<string>;
    /** Shift 選範圍的起點。 */
    anchor: string | null;
}

export interface ClickModifiers {
    toggle: boolean;
    range: boolean;
}

export const NO_SELECTION: ListSelection = { selected: new Set(), anchor: null };

export function clickSelection(
    current: ListSelection,
    ordered: string[],
    id: string,
    { toggle, range }: ClickModifiers,
): ListSelection {
    const from = current.anchor === null ? -1 : ordered.indexOf(current.anchor);
    const to = ordered.indexOf(id);
    if (range && from >= 0 && to >= 0) {
        const span = ordered.slice(Math.min(from, to), Math.max(from, to) + 1);
        return { selected: new Set(toggle ? [...current.selected, ...span] : span), anchor: current.anchor };
    }
    if (toggle) {
        const selected = new Set(current.selected);
        if (!selected.delete(id)) selected.add(id);
        return { selected, anchor: id };
    }
    return { selected: new Set([id]), anchor: id };
}

/** 依清單順序回傳還存在的選取項目。 */
export const selectedInOrder = ({ selected }: ListSelection, ordered: string[]) =>
    ordered.filter((id) => selected.has(id));

/** 按右鍵時選單作用的項目：按在選取範圍內是整組，否則只有按到的那一個。 */
export function contextSelection(current: ListSelection, id: string): ListSelection {
    return current.selected.has(id) ? current : { selected: new Set([id]), anchor: id };
}
