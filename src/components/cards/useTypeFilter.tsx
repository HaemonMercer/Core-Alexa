import { useMemo, useState } from "react";
import { noteTypeLabel } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";

/** 只有一種類型時不需要篩選，不顯示。回傳的 `bar` 要放進畫面裡。 */
export function useTypeFilter(notes: Note[] | null) {
    const [chosen, setChosen] = useState<string | null>(null);
    const types = useMemo(() => [...new Set(notes?.map((note) => note.type))].sort(), [notes]);

    // 選到的類型全被刪除時回到全部，清單才不會空著又找不到原因。
    const active = chosen !== null && types.includes(chosen) ? chosen : null;
    const visible = useMemo(
        () => (active === null ? notes : notes?.filter((note) => note.type === active) ?? null),
        [notes, active],
    );

    const option = (type: string | null, label: string) => (
        <button key={type ?? ""} aria-pressed={active === type} onClick={() => setChosen(type)}>
            {label}
        </button>
    );
    const bar = types.length > 1 && (
        <div className="type-filter" role="group" aria-label="依類型篩選">
            {option(null, "全部")}
            {types.map((type) => option(type, noteTypeLabel(type)))}
        </div>
    );
    return { visible, bar };
}
