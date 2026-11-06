import type { ReactNode } from "react";
import type { Note } from "../../types.ts";
import CardLinks from "../cards/CardLinks.tsx";
import CardPreview from "../cards/CardPreview.tsx";
import NoteEditorPlaceholder from "../cards/NoteEditorPlaceholder.tsx";
import CodeEditor from "../code/CodeEditor.tsx";
import CodePreview from "../code/CodePreview.tsx";
import { noteLanguage } from "../code/languages.ts";
import DrawioViewer from "../drawio/DrawioViewer.tsx";
import ChartEditor from "../chart/ChartEditor.tsx";
import ImageViewer from "../media/ImageViewer.tsx";
import VideoViewer from "../media/VideoViewer.tsx";
import MermaidEditor from "../mermaid/MermaidEditor.tsx";
import MermaidPreview from "../mermaid/MermaidPreview.tsx";
import MindmapEditor from "../mindmap/MindmapEditor.tsx";
import OfficeSummary from "../office/OfficeSummary.tsx";
import WriterEditor from "../writer/WriterEditor.tsx";
import PanelResizer from "./PanelResizer.tsx";


interface RightPanelProps {
    card: Note | null;
    /** 這張卡片正在白板上或全螢幕編輯，這裡只顯示內容，避免兩個編輯器互相覆蓋。 */
    editedElsewhere: boolean;
    /** 沒有開啟卡片時顯示這裡；傳 null 的頁面不需要它。 */
    library: ReactNode;
    collapsed: boolean;
    width: number;
    widthRange: { initial: number; min: number; max: number };
    /** 左側面板目前的寬度。 */
    otherWidth: number;
    onWidthChange: (width: number) => void;
    /** 內容或箭頭改變時遞增，連結清單要重新計算。 */
    linksRevision: number;
    onChange: (id: string, content: string) => void;
    /** 心智圖這類內容不在 content 裡，改動後要重新讀取。 */
    onNoteChanged: () => void;
    /** 卡片的內容在 Rust，改完要讀回來。 */
    onCardChanged: (id: string) => void;
    onCodeLanguageChange: (id: string, language: string) => void;
    onOpenLink: (href: string) => void;
    onOpenCard: (id: string) => void;
    onOpenFullscreen: (id: string) => void;
    onCloseCard: () => void;
    onCardCreated: () => void;
    onError: (error: unknown) => void;
    onToggle: () => void;
}

function RightPanel({
    card, editedElsewhere, library, collapsed, width, widthRange, otherWidth, onWidthChange, linksRevision,
    onChange, onNoteChanged, onCardChanged, onCodeLanguageChange, onOpenLink, onOpenCard, onOpenFullscreen, onCloseCard, onCardCreated,
    onError, onToggle,
}: RightPanelProps) {
    if (collapsed) {
        return (
            <aside className="right-panel collapsed" aria-label="右側面板">
                <button className="panel-toggle" aria-label="展開右側面板" title="展開右側面板" onClick={onToggle}>
                    «
                </button>
            </aside>
        );
    }
    return (
        <aside className="right-panel" aria-label="右側面板" style={{ flexBasis: width }}>
            <PanelResizer
                side="right"
                width={width}
                range={widthRange}
                otherWidth={otherWidth}
                onChange={onWidthChange}
            />
            <div className="right-panel-title">
                <button className="panel-toggle" aria-label="摺疊右側面板" title="摺疊右側面板" onClick={onToggle}>
                    »
                </button>
                {card && library && (
                    <button className="panel-back" onClick={onCloseCard}>‹ Library</button>
                )}
                {!card && library && "Library"}
                {!library && "卡片"}
            </div>
            {!card && library}
            {!card && !library && <p className="library-empty right-panel-hint">選取卡片後可以在這裡編輯。</p>}
            {card?.type === "card" && editedElsewhere && (
                <div
                    className="right-panel-preview"
                    onClick={(evt) => {
                        const href = (evt.target as Element).closest("a")?.getAttribute("href");
                        if (!href) return;
                        // 預覽裡的連結不能把整個 App 帶離開。
                        evt.preventDefault();
                        onOpenLink(href);
                    }}
                >
                    <p className="library-empty">這張卡片正在別處編輯。</p>
                    <CardPreview markdown={card.content} />
                </div>
            )}
            {card?.type === "mermaid" && editedElsewhere && (
                <div className="right-panel-preview">
                    <p className="library-empty">這張圖表正在別處編輯。</p>
                    <MermaidPreview text={card.content} />
                </div>
            )}
            {card?.type === "mermaid" && !editedElsewhere && (
                <MermaidEditor
                    key={card.id}
                    source={card.content}
                    onChange={(content) => onChange(card.id, content)}
                    onExpand={() => onOpenFullscreen(card.id)}
                />
            )}
            {card?.type === "code" && editedElsewhere && (
                <div className="right-panel-preview">
                    <p className="library-empty">這段程式碼正在別處編輯。</p>
                    <CodePreview text={card.content} language={noteLanguage(card)} />
                </div>
            )}
            {card?.type === "code" && !editedElsewhere && (
                <CodeEditor
                    key={card.id}
                    source={card.content}
                    language={noteLanguage(card)}
                    onChange={(content) => onChange(card.id, content)}
                    onLanguageChange={(language) => onCodeLanguageChange(card.id, language)}
                />
            )}
            {card?.type === "mindmap" && editedElsewhere && (
                <p className="library-empty right-panel-hint">這張 Mind map 正在別處編輯。</p>
            )}
            {card?.type === "mindmap" && !editedElsewhere && (
                <MindmapEditor key={card.id} noteID={card.id} onChanged={onNoteChanged} onError={onError} />
            )}
            {card?.type === "image" && <ImageViewer note={card} />}
            {card?.type === "drawio" && <DrawioViewer note={card} onEdit={() => onOpenFullscreen(card.id)} />}
            {card?.type === "video" && <VideoViewer key={card.id} note={card} />}
            {card?.type === "writer" && !editedElsewhere && (
                <WriterEditor key={card.id} noteID={card.id} draft onChanged={onNoteChanged} onOpenLink={onOpenLink} onError={onError} />
            )}
            {card?.type === "chart" && !editedElsewhere && (
                <ChartEditor key={card.id} noteID={card.id} onChanged={onNoteChanged} onError={onError} />
            )}
            {card && (card.type === "sheet" || card.type === "slides" || (editedElsewhere && (card.type === "writer" || card.type === "chart"))) && (
                <div className="office-open">
                    <OfficeSummary note={card} />
                    {editedElsewhere
                        ? <p className="library-empty">這份文件正在別處編輯。</p>
                        : <button type="button" className="open-button" onClick={() => onOpenFullscreen(card.id)}>開啟編輯器</button>}
                </div>
            )}
            {card && !["card", "code", "mermaid", "image", "video", "mindmap", "drawio", "writer", "sheet", "slides", "chart"].includes(card.type) && <NoteEditorPlaceholder type={card.type} />}
            {card?.type === "card" && !editedElsewhere && (
                <WriterEditor
                    key={card.id}
                    noteID={card.id}
                    card
                    onChanged={() => onCardChanged(card.id)}
                    onOpenLink={onOpenLink}
                    onCardCreated={onCardCreated}
                    onError={onError}
                />
            )}
            {card && (
                <CardLinks
                    key={`links:${card.id}`}
                    cardID={card.id}
                    showHint={card.type === "card"}
                    revision={linksRevision}
                    onOpenCard={onOpenCard}
                    onError={onError}
                />
            )}
        </aside>
    );
}

export default RightPanel;
