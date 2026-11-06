import { imageInfo, mediaUrl, videoDetails } from "../../media.ts";
import { noteTypeLabel, OFFICE_TYPES } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";
import CodePreview from "../code/CodePreview.tsx";
import { noteLanguage } from "../code/languages.ts";
import MermaidPreview from "../mermaid/MermaidPreview.tsx";
import MindmapPreview from "../mindmap/MindmapPreview.tsx";
import OfficeSummary from "../office/OfficeSummary.tsx";
import CardPreview from "./CardPreview.tsx";

/** Library 清單裡的一筆內容。 */
function NoteSummary({ note }: { note: Note }) {
    const image = note.type === "image" ? imageInfo(note) : null;
    if (image) return <img className="note-image" src={mediaUrl(image.file)} alt={image.name} draggable={false} />;
    const video = note.type === "video" ? videoDetails(note) : null;
    if (video?.poster) return <img className="note-image" src={mediaUrl(video.poster)} alt={video.name} draggable={false} />;
    const { preview } = note.context;
    if (note.type === "drawio" && typeof preview === "string") {
        return <img className="note-image" src={mediaUrl(preview)} alt="Draw.io 圖表" draggable={false} />;
    }
    if (OFFICE_TYPES.includes(note.type)) return <OfficeSummary note={note} />;
    if (note.type === "mindmap") return <MindmapPreview note={note} />;
    if (note.type === "mermaid") return <MermaidPreview text={note.content} fallback="Mermaid" />;
    if (note.type === "code" && note.content) return <CodePreview text={note.content} language={noteLanguage(note)} />;
    if (note.type !== "card") return <span className="note-type-badge">{noteTypeLabel(note.type)}</span>;
    return note.content
        ? <CardPreview markdown={note.content} />
        : <span className="library-empty">（空白卡片）</span>;
}

export default NoteSummary;
