import { imageInfo, mediaUrl } from "../../media.ts";
import type { Note } from "../../types.ts";

/** 圖片沒有內容可以編輯，面板和全螢幕只顯示原圖與檔案資訊。 */
function ImageViewer({ note }: { note: Note }) {
    const info = imageInfo(note);
    if (!info) return <p className="library-empty right-panel-hint">這張圖片的資料不完整。</p>;
    return (
        <div className="image-viewer">
            <img src={mediaUrl(info.file)} alt={info.name} draggable={false} />
            <p className="library-empty">{info.name || "圖片"} · {info.width} × {info.height}</p>
        </div>
    );
}

export default ImageViewer;
