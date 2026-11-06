import { mediaUrl } from "../../media.ts";
import type { VideoAnchor } from "../canvas/controller.ts";

interface VideoPlayerProps {
    anchor: VideoAnchor;
    onClose: () => void;
    /** 滑鼠在影片上時，滾輪仍然是平移與縮放白板。 */
    onWheel: (evt: WheelEvent) => void;
    onFailed: () => void;
}

/** 疊在畫布上的播放器，跟著白板移動與縮放。同時只有一個，播放時會蓋住其他卡片。 */
function VideoPlayer({ anchor, onClose, onWheel, onFailed }: VideoPlayerProps) {
    return (
        <div
            className="video-player"
            style={{
                left: anchor.left,
                top: anchor.top,
                width: anchor.width,
                height: anchor.height,
                transform: `scale(${anchor.scale})`,
            }}
            onWheel={(evt) => onWheel(evt.nativeEvent)}
        >
            <video
                key={anchor.placedID}
                src={mediaUrl(anchor.file)}
                controls
                autoPlay
                crossOrigin="anonymous"
                onError={onFailed}
            />
            <button aria-label="關閉影片" title="關閉影片 (Esc)" onClick={onClose}>✕</button>
        </div>
    );
}

export default VideoPlayer;
