import { useEffect, useRef, useState } from "react";
import * as api from "../../api.ts";
import type { Note } from "../../types.ts";

const SAVE_DELAY_MS = 300;

interface DocumentTitleProps {
    noteID: string;
    placeholder: string;
    className?: string;
    onChanged: () => void;
    onError: (error: unknown) => void;
}

const nameOf = (note: Note | null) => (typeof note?.context.name === "string" ? note.context.name : "");

/** 文件名稱，打完稍等一下才存。 */
function DocumentTitle({ noteID, placeholder, className, onChanged, onError }: DocumentTitleProps) {
    const [name, setName] = useState<string | null>(null);
    const timer = useRef<number | undefined>(undefined);
    const pending = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.getNote(noteID)
            .then((note) => {
                if (!cancelled) setName(nameOf(note));
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, onError]);

    const flush = () => {
        window.clearTimeout(timer.current);
        if (pending.current === null) return;
        const next = pending.current;
        pending.current = null;
        api.renameNote(noteID, next).then(onChanged).catch(onError);
    };

    // 關閉時還沒存的名稱也要寫回去。
    useEffect(() => flush, []);

    return (
        <input
            className={className ?? "document-title"}
            aria-label="文件名稱"
            placeholder={placeholder}
            value={name ?? ""}
            disabled={name === null}
            onChange={(evt) => {
                setName(evt.target.value);
                pending.current = evt.target.value;
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
            }}
            onBlur={flush}
        />
    );
}

export default DocumentTitle;
