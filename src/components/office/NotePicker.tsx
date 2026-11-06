import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import { noteTitle, noteTypeLabel } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";
import NoteSummary from "../cards/NoteSummary.tsx";

interface NotePickerProps {
    type: "image" | "chart";
    onPick: (note: Note) => void;
    onCancel: () => void;
    onError: (error: unknown) => void;
}

const EMPTY_HINT = {
    image: "Library 裡還沒有圖片。先在白板上新增一張圖片。",
    chart: "還沒有圖表。先在 Excels 選取資料，再按「圖表」建立。",
};

/** 從 Library 挑一筆圖片或圖表。內容只有一份，引入的地方都會同步。 */
function NotePicker({ type, onPick, onCancel, onError }: NotePickerProps) {
    const [notes, setNotes] = useState<Note[] | null>(null);

    useEffect(() => {
        api.getNoteLibrary()
            .then((all) => setNotes(all.filter((note) => note.type === type)))
            .catch(onError);
    }, [type, onError]);

    return (
        <div className="confirm-backdrop">
            <div className="range-picker" role="dialog" aria-label={`選擇${noteTypeLabel(type)}`}>
                <h2>選擇{noteTypeLabel(type)}</h2>
                {notes?.length === 0 && <p className="library-empty">{EMPTY_HINT[type]}</p>}
                <ul className="note-picker-list">
                    {notes?.map((note) => (
                        <li key={note.id}>
                            <button title={noteTitle(note)} onClick={() => onPick(note)}>
                                <NoteSummary note={note} />
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="confirm-actions">
                    <button className="open-button" onClick={onCancel}>取消</button>
                </div>
            </div>
        </div>
    );
}

export default NotePicker;
