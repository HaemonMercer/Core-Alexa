import { useEffect, useState, type ReactNode } from "react";
import * as api from "../../api.ts";
import type { Note } from "../../types.ts";
import NoteSummary from "./NoteSummary.tsx";

interface PlacedCardProps {
    noteID: string;
    /** 別處改了筆記時遞增。讀回來之前舊內容留著，畫面才不會閃。 */
    revision?: number;
    /** 文件裡的 Note 可以直接編輯，由放置的地方提供編輯器。 */
    renderNote?: (noteID: string) => ReactNode;
    onError: (error: unknown) => void;
}

/** 放在 Writer、Slides、Excels 裡的卡片。內容只有一份。沒有 `renderNote` 時只顯示，要編輯就雙擊，由放置的地方開啟右側面板。 */
function PlacedCard({ noteID, revision = 0, renderNote, onError }: PlacedCardProps) {
    const [note, setNote] = useState<Note | null | undefined>(undefined);

    useEffect(() => {
        let cancelled = false;
        api.getNote(noteID)
            .then((next) => {
                if (!cancelled) setNote(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, revision, onError]);

    if (note === null) return <p className="cells-error">卡片已被刪除</p>;
    if (note?.type === "card" && renderNote) return <div className="placed-card" data-type="card">{renderNote(note.id)}</div>;
    return (
        <div
            className="placed-card"
            data-type={note?.type}
            // 預覽裡的連結不能把整個 App 帶離開。
            onClick={(evt) => {
                if ((evt.target as Element).closest("a")) evt.preventDefault();
            }}
        >
            {note && <NoteSummary note={note} />}
        </div>
    );
}

export default PlacedCard;
