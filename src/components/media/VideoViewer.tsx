import { mediaUrl, videoDetails } from "../../media.ts";
import { formatDuration } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";

/** 面板與全螢幕用瀏覽器內建的播放控制。 */
function VideoViewer({ note }: { note: Note }) {
    const video = videoDetails(note);
    if (!video) return <p className="library-empty right-panel-hint">這部影片的資料不完整。</p>;

    const facts = [
        video.name || "影片",
        video.width && video.height ? `${video.width} × ${video.height}` : "",
        video.duration ? formatDuration(video.duration) : "",
    ];
    return (
        <div className="image-viewer">
            <video
                key={video.file}
                src={mediaUrl(video.file)}
                poster={video.poster ? mediaUrl(video.poster) : undefined}
                controls
                crossOrigin="anonymous"
            />
            <p className="library-empty">{facts.filter(Boolean).join(" · ")}</p>
        </div>
    );
}

export default VideoViewer;
