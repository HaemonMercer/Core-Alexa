import { useMemo, useState } from "react";
import type { Note } from "../../types.ts";
import { tagStyle } from "./tagColors.ts";
import { filterByTags, tagsIn } from "./tagRules.ts";

/** 接在類型篩選之後。清單裡沒有 Tag 時不顯示。回傳的 `bar` 要放進畫面裡。 */
export function useTagFilter(notes: Note[] | null) {
    const [chosen, setChosen] = useState<readonly string[]>([]);
    const tags = useMemo(() => tagsIn(notes ?? []), [notes]);

    // 選到的 Tag 從清單消失時就不算，清單才不會空著又找不到原因。
    const active = useMemo(
        () => chosen.filter((id) => tags.some((tag) => tag.id === id)),
        [chosen, tags],
    );
    const visible = useMemo(
        () => (active.length === 0 ? notes : notes && filterByTags(notes, active)),
        [notes, active],
    );

    const toggle = (id: string) => {
        setChosen(active.includes(id) ? active.filter((other) => other !== id) : [...active, id]);
    };

    const bar = tags.length > 0 && (
        <div className="type-filter" role="group" aria-label="依 Tag 篩選">
            {tags.map((tag) => (
                <button key={tag.id} aria-pressed={active.includes(tag.id)} onClick={() => toggle(tag.id)}>
                    <span className="tag-dot" style={tagStyle(tag.color)} />
                    {tag.name}
                </button>
            ))}
        </div>
    );
    return { visible, bar };
}
