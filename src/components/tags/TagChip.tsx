import type { ReactNode } from "react";
import type { Note, NoteTag } from "../../types.ts";
import { tagStyle } from "./tagColors.ts";

/** 一個 Tag 的外觀。`children` 放移除按鈕這類附加內容。 */
export function TagChip({ tag, children }: { tag: NoteTag; children?: ReactNode }) {
    return (
        <span className="tag-chip" style={tagStyle(tag.color)} title={tag.name}>
            <span className="tag-chip-name">{tag.name}</span>
            {children}
        </span>
    );
}

/** Library 清單卡片上的 Tag，疊在預覽下方，不影響清單的固定高度。 */
export function NoteTags({ note }: { note: Note }) {
    if (note.tags.length === 0) return null;
    return (
        <div className="note-tags">
            {note.tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}
        </div>
    );
}
