import { convertFileSrc } from "@tauri-apps/api/core";
import type { Note } from "./types.ts";

// 圖片和影片由 Rust 的 `media://` 提供，檔案只在資料夾裡，筆記的 context 記著檔名。

export interface ImageInfo {
    file: string;
    name: string;
    width: number;
    height: number;
}

/** 影片匯入後要解碼才知道尺寸，解碼失敗時尺寸與封面都是 null。 */
export interface VideoDetails {
    file: string;
    name: string;
    poster: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
}

const text = (value: unknown) => (typeof value === "string" ? value : null);
const number = (value: unknown) => (typeof value === "number" ? value : null);

/** 欄位不齊時回傳 null，例如新版建立的資料。 */
export function imageInfo(note: Note): ImageInfo | null {
    const { media, name, width, height } = note.context;
    if (typeof media !== "string" || typeof width !== "number" || typeof height !== "number") return null;
    return { file: media, name: text(name) ?? "", width, height };
}

export function videoDetails(note: Note): VideoDetails | null {
    const { media, name, poster, width, height, duration } = note.context;
    if (typeof media !== "string") return null;
    return {
        file: media,
        name: text(name) ?? "",
        poster: text(poster),
        width: number(width),
        height: number(height),
        duration: number(duration),
    };
}

/** 縮放時要維持的比例；不是圖片或影片、或尺寸未知時回傳 null。 */
export function mediaRatio(note: Note) {
    if (note.type !== "image" && note.type !== "video") return null;
    const width = number(note.context.width);
    const height = number(note.context.height);
    return width && height ? width / height : null;
}

export const mediaUrl = (file: string) => convertFileSrc(file, "media");
