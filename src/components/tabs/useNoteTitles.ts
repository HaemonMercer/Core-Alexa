import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import { noteTitle } from "../../noteTypes.ts";

/** 打字時不必每個字都重新讀取。 */
const REFRESH_DELAY_MS = 300;

/** 分頁標題用的筆記名稱。`revision` 在內容改變時遞增。 */
export function useNoteTitles(ids: string[], revision: number, onError: (error: unknown) => void) {
    const [titles, setTitles] = useState<Record<string, string>>({});
    const key = ids.join(",");

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            const wanted = key ? key.split(",") : [];
            Promise.all(wanted.map((id) => api.getNote(id)))
                .then((notes) => {
                    if (cancelled) return;
                    setTitles(Object.fromEntries(notes.flatMap((note) => (note ? [[note.id, noteTitle(note)]] : []))));
                })
                .catch(onError);
        }, REFRESH_DELAY_MS);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [key, revision, onError]);

    return titles;
}
