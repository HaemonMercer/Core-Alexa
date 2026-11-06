import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { Note } from "../../types.ts";
import { paintNodes } from "./draw.ts";

/** Library 裡的縮圖。 */
function MindmapPreview({ note }: { note: Note }) {
    const [image, setImage] = useState<string | null>(null);
    const { id, updatedAt } = note;

    useEffect(() => {
        let cancelled = false;
        api.getMindmap(id)
            .then((nodes) => {
                if (!cancelled) setImage(paintNodes(nodes).toDataURL("image/png"));
            })
            .catch(() => {
                if (!cancelled) setImage(null);
            });
        return () => {
            cancelled = true;
        };
    }, [id, updatedAt]);

    if (!image) return <span className="note-type-badge">Mind map</span>;
    return <img className="mermaid-image" src={image} alt={note.content} draggable={false} />;
}

export default MindmapPreview;
