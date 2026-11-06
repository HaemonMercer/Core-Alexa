import { useDiagram } from "./useDiagram.ts";

/** 唯讀的圖。空白或語法錯誤、又沒有上一張圖時顯示 `fallback`。 */
function MermaidPreview({ text, fallback }: { text: string; fallback?: string }) {
    const { diagram } = useDiagram(text);
    if (!diagram) return fallback ? <span className="note-type-badge">{fallback}</span> : null;
    return <img className="mermaid-image" src={diagram.dataUri} alt="Mermaid 圖表" draggable={false} />;
}

export default MermaidPreview;
