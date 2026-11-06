import { useCallback } from "react";
import * as api from "../../api.ts";

/** Ctrl+Z、Ctrl+Y 交給 Rust，內容全在那裡。`reload` 把改動後的內容讀回來。 */
export function useEditorHistory(
    noteID: string,
    reload: () => void,
    flush: () => void,
    onError: (error: unknown) => void,
) {
    return useCallback((evt: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string; preventDefault: () => void }) => {
        if (!evt.ctrlKey && !evt.metaKey) return false;
        const key = evt.key.toLowerCase();
        const undo = key === "z" && !evt.shiftKey;
        const redo = key === "y" || (key === "z" && evt.shiftKey);
        if (!undo && !redo) return false;
        evt.preventDefault();
        flush();
        (undo ? api.undoNote(noteID) : api.redoNote(noteID))
            .then((changed) => {
                if (changed) reload();
            })
            .catch(onError);
        return true;
    }, [noteID, reload, flush, onError]);
}
