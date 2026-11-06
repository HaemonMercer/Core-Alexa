import { mediaUrl } from "../../media.ts";
import type { Note } from "../../types.ts";

/** 右側面板太窄放不下編輯器，這裡只顯示預覽，編輯開在全螢幕。 */
function DrawioViewer({ note, onEdit }: { note: Note; onEdit: () => void }) {
    const { preview } = note.context;
    return (
        <div className="image-viewer">
            {typeof preview === "string"
                ? <img src={mediaUrl(preview)} alt="Draw.io 圖表" draggable={false} />
                : <p className="library-empty">這張圖表還是空的。</p>}
            <button type="button" className="open-button" onClick={onEdit}>在 Draw.io 編輯</button>
        </div>
    );
}

export default DrawioViewer;
