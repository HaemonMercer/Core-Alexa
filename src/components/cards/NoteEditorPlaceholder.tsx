import { noteTypeLabel } from "../../noteTypes.ts";

/** 這個類型還沒有編輯器。不能交給 Markdown 編輯器，否則內容會被改寫。 */
function NoteEditorPlaceholder({ type }: { type: string }) {
    return <p className="library-empty right-panel-hint">{noteTypeLabel(type)}的編輯器尚未完成。</p>;
}

export default NoteEditorPlaceholder;
