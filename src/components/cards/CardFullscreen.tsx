import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../api.ts";
import type { Note } from "../../types.ts";
import CardLinks from "./CardLinks.tsx";
import { noteTypeLabel } from "../../noteTypes.ts";
import CodeEditor from "../code/CodeEditor.tsx";
import { noteLanguage } from "../code/languages.ts";
import DrawioEditor, { type DrawioHandle } from "../drawio/DrawioEditor.tsx";
import ChartEditor from "../chart/ChartEditor.tsx";
import ImageViewer from "../media/ImageViewer.tsx";
import VideoViewer from "../media/VideoViewer.tsx";
import MermaidEditor from "../mermaid/MermaidEditor.tsx";
import MindmapEditor from "../mindmap/MindmapEditor.tsx";
import SheetEditor from "../sheet/SheetEditor.tsx";
import SlidesEditor from "../slides/SlidesEditor.tsx";
import WriterEditor from "../writer/WriterEditor.tsx";
import NoteEditorPlaceholder from "./NoteEditorPlaceholder.tsx";


interface CardFullscreenProps {
    noteID: string;
    /** 內容或箭頭改變時遞增，連結清單要重新計算。 */
    linksRevision: number;
    onChange: (id: string, content: string) => void;
    onNoteChanged: () => void;
    /** 卡片的內容在 Rust，改完要讀回來。 */
    onCardChanged: (id: string) => void;
    onCodeLanguageChange: (id: string, language: string) => void;
    onOpenLink: (href: string) => void;
    onOpenCard: (id: string) => void;
    onCardCreated: () => void;
    onClose: () => void;
    onError: (error: unknown) => void;
}

/** 卡片佔滿操作區，左右面板都留著。 */
function CardFullscreen({
    noteID, linksRevision, onChange, onNoteChanged, onCardChanged, onCodeLanguageChange, onOpenLink, onOpenCard, onCardCreated,
    onClose, onError,
}: CardFullscreenProps) {
    const [note, setNote] = useState<Note | null>(null);
    const drawio = useRef<DrawioHandle>(null);
    const [tools, setTools] = useState<HTMLElement | null>(null);

    /** Draw.io 要先把最後的改動存好，iframe 移除後就無法匯出了。 */
    const close = useCallback(() => {
        void (drawio.current?.flush() ?? Promise.resolve()).then(onClose);
    }, [onClose]);

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
    }, [noteID, onError]);

    useEffect(() => {
        const onKeyDown = (evt: KeyboardEvent) => {
            // 連結輸入框和 [[ 選單會自己處理 Esc；確認框或右鍵選單開著時，按鍵是給它們的。
            if (evt.key !== "Escape" || evt.defaultPrevented || evt.isComposing) return;
            if (document.querySelector(".confirm-backdrop, .context-menu")) return;
            close();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [close]);

    return (
        <section className="card-fullscreen" aria-label="全螢幕卡片">
            <div className="right-panel-title">
                {note?.id === noteID ? noteTypeLabel(note.type) : "卡片"}
                <span ref={setTools} className="panel-tools">
                    <button className="panel-back panel-fullscreen-toggle" title="結束全螢幕 (Esc)" onClick={close}>
                        結束全螢幕
                    </button>
                </span>
            </div>
            {note?.id === noteID && note.type === "mermaid" && (
                <MermaidEditor
                    key={noteID}
                    source={note.content}
                    onChange={(content) => onChange(noteID, content)}
                />
            )}
            {note?.id === noteID && note.type === "code" && (
                <CodeEditor
                    key={noteID}
                    source={note.content}
                    language={noteLanguage(note)}
                    onChange={(content) => onChange(noteID, content)}
                    onLanguageChange={(language) => onCodeLanguageChange(noteID, language)}
                />
            )}
            {note?.id === noteID && note.type === "mindmap" && (
                <MindmapEditor key={noteID} noteID={noteID} onChanged={onNoteChanged} onError={onError} />
            )}
            {note?.id === noteID && note.type === "drawio" && (
                <DrawioEditor key={noteID} ref={drawio} note={note} onChanged={onNoteChanged} onError={onError} />
            )}
            {note?.id === noteID && note.type === "image" && <ImageViewer note={note} />}
            {note?.id === noteID && note.type === "video" && <VideoViewer note={note} />}
            {note?.id === noteID && note.type === "writer" && (
                <WriterEditor key={noteID} noteID={noteID} toolsSlot={tools} onChanged={onNoteChanged} onOpenLink={onOpenLink} onError={onError} />
            )}
            {note?.id === noteID && note.type === "sheet" && (
                <SheetEditor key={noteID} noteID={noteID} onChanged={onNoteChanged} onOpenChart={onOpenCard} onError={onError} />
            )}
            {note?.id === noteID && note.type === "slides" && (
                <SlidesEditor key={noteID} noteID={noteID} onChanged={onNoteChanged} onError={onError} />
            )}
            {note?.id === noteID && note.type === "chart" && (
                <ChartEditor key={noteID} noteID={noteID} onChanged={onNoteChanged} onError={onError} />
            )}
            {note?.id === noteID && !["card", "code", "mermaid", "image", "video", "mindmap", "drawio", "writer", "sheet", "slides", "chart"].includes(note.type) && (
                <NoteEditorPlaceholder type={note.type} />
            )}
            {note?.id === noteID && note.type === "card" && (
                <WriterEditor
                    key={noteID}
                    noteID={noteID}
                    card
                    onChanged={() => onCardChanged(noteID)}
                    onOpenLink={onOpenLink}
                    onCardCreated={onCardCreated}
                    onError={onError}
                />
            )}
            {note && !["drawio", "sheet", "slides"].includes(note.type) && <CardLinks
                key={`links:${noteID}`}
                cardID={noteID}
                showHint={note?.type === "card"}
                revision={linksRevision}
                onOpenCard={onOpenCard}
                onError={onError}
            />}
        </section>
    );
}

export default CardFullscreen;
