import { imageInfo, mediaUrl, videoDetails } from "../../media.ts";
import type { PreviewRenderer } from "../canvas/notePreview.ts";

/** 白板上不需要原始解析度。大照片解碼後很吃記憶體，先縮小。 */
const MAX_DECODED_SIDE = 2048;

async function decode(file: string, width: number, height: number) {
    const response = await fetch(mediaUrl(file));
    if (!response.ok) throw new Error(`讀不到檔案：${file}`);

    const blob = await response.blob();
    const scale = Math.min(MAX_DECODED_SIDE / Math.max(width, height), 1);
    return createImageBitmap(blob, {
        resizeWidth: Math.round(width * scale),
        resizeHeight: Math.round(height * scale),
        resizeQuality: "high",
    });
}

export const imagePreview: PreviewRenderer = {
    version: (note) => imageInfo(note)?.file ?? "",
    render: async (note) => {
        const info = imageInfo(note);
        return info && decode(info.file, info.width, info.height);
    },
};

/** Draw.io 匯出的預覽圖。 */
export const drawioPreview: PreviewRenderer = {
    version: (note) => (typeof note.context.preview === "string" ? note.context.preview : ""),
    render: async (note) => {
        const { preview, width, height } = note.context;
        return typeof preview === "string" && typeof width === "number" && typeof height === "number"
            ? decode(preview, width, height)
            : null;
    },
};

/** 影片在白板上平常只畫封面。 */
export const videoPreview: PreviewRenderer = {
    version: (note) => videoDetails(note)?.poster ?? "",
    render: async (note) => {
        const video = videoDetails(note);
        return video?.poster && video.width && video.height
            ? decode(video.poster, video.width, video.height)
            : null;
    },
};
