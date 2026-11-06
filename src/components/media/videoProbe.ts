import { mediaUrl } from "../../media.ts";

// 影片的尺寸與封面要解碼才知道，由 WebView 做，量到的結果交給 Rust 保存。

const POSTER_LONG_SIDE = 1280;
const POSTER_QUALITY = 0.85;
const TIMEOUT_MS = 20000;
/** 片頭常是全黑，封面取稍後一點的畫面。 */
const POSTER_TIME_SECONDS = 1;
const POSTER_TIME_RATIO = 0.1;

export interface VideoProbe {
    width: number;
    height: number;
    duration: number;
    poster: Blob;
}

function once(video: HTMLVideoElement, event: string) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("讀取影片逾時")), TIMEOUT_MS);
        const finish = (settle: () => void) => () => {
            clearTimeout(timer);
            settle();
        };
        video.addEventListener(event, finish(resolve), { once: true });
        video.addEventListener("error", finish(() => reject(new Error("無法解碼影片"))), { once: true });
    });
}

function capture(video: HTMLVideoElement) {
    const scale = Math.min(POSTER_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight), 1);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("無法產生封面"))),
            "image/jpeg",
            POSTER_QUALITY,
        );
    });
}

export async function probeVideo(file: string): Promise<VideoProbe> {
    const video = document.createElement("video");
    // 沒有這個設定，影片畫到 canvas 之後就讀不出來，封面存不了。
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";
    try {
        const metadata = once(video, "loadedmetadata");
        video.src = mediaUrl(file);
        await metadata;
        if (!video.videoWidth || !video.videoHeight) throw new Error("影片沒有畫面");

        const seeked = once(video, "seeked");
        video.currentTime = Math.min(POSTER_TIME_SECONDS, video.duration * POSTER_TIME_RATIO);
        await seeked;
        return {
            width: video.videoWidth,
            height: video.videoHeight,
            duration: video.duration,
            poster: await capture(video),
        };
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}
