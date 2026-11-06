import { noteTitle, noteTypeLabel } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";

/** Library 清單裡的一份文件：`content` 是 Rust 產生的純文字摘要。 */
function OfficeSummary({ note }: { note: Note }) {
    return (
        <div className="office-summary">
            <span className="note-type-badge" data-type={note.type}>{noteTypeLabel(note.type)}</span>
            <strong>{noteTitle(note)}</strong>
            {note.content && <p>{note.content}</p>}
        </div>
    );
}

export default OfficeSummary;
