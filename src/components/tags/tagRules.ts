import type { Note, NoteTag } from "../../types.ts";

// 輸入框與篩選列的畫面邏輯。Tag 的規則（名稱、重複、顏色）在 model/tags.rs。

const SUGGESTION_LIMIT = 8;

const normalize = (text: string) => text.trim().replace(/^#+/, "").trim().toLowerCase();

/** 輸入框的建議：還沒貼上的 Tag 裡，名稱包含輸入文字的。 */
export function tagSuggestions<Tag extends NoteTag>(all: Tag[], attached: NoteTag[], query: string): Tag[] {
    const wanted = normalize(query);
    return all
        .filter((tag) => !attached.some((other) => other.id === tag.id))
        .filter((tag) => tag.name.toLowerCase().includes(wanted))
        .slice(0, SUGGESTION_LIMIT);
}

/** 打的是新名稱時才提供「建立」。 */
export function canCreateTag(all: NoteTag[], query: string): boolean {
    const wanted = normalize(query);
    return wanted !== "" && !all.some((tag) => tag.name.toLowerCase() === wanted);
}

/** 清單裡用到的 Tag，每個一次，依名稱排序。 */
export function tagsIn(notes: Note[]): NoteTag[] {
    const tags = new Map(notes.flatMap((note) => note.tags).map((tag) => [tag.id, tag]));
    return [...tags.values()].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** 選了多個 Tag 時，要全部都有才留下。 */
export function filterByTags(notes: Note[], tagIDs: string[]): Note[] {
    return notes.filter((note) => tagIDs.every((id) => note.tags.some((tag) => tag.id === id)));
}
