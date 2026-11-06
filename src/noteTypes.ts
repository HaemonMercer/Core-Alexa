import { cardTitle } from "./markdown/noteLink.ts";
import type { Note } from "./types.ts";

const LABELS: Record<string, string> = {
    card: "卡片",
    sheet: "Excels",
    writer: "Writer",
    slides: "Slides",
    chart: "圖表",
    mindmap: "Mind map",
    mermaid: "Mermaid",
    image: "圖片",
    video: "影片",
    drawio: "Draw.io",
    code: "Code Block",
};

/** 文件類的筆記，內容不在 `content`，用獨立的編輯器。 */
export const OFFICE_TYPES = ["writer", "sheet", "slides", "chart"];

/** 新版才有的類型沒有名稱，直接顯示原本的字串。 */
export const noteTypeLabel = (type: string) => LABELS[type] ?? type;

export function noteTitle(note: Note) {
    if (note.type === "card") return cardTitle(note.content);
    // 心智圖的 content 是根節點的文字。
    if (note.type === "mindmap" && note.content) return note.content;
    // Code Block 沒有名稱，用第一行有字的程式碼辨認。
    if (note.type === "code") {
        const firstLine = note.content.split("\n").find((line) => line.trim());
        if (firstLine) return firstLine.trim();
    }
    const { name } = note.context;
    if (typeof name === "string" && name) return name;
    return OFFICE_TYPES.includes(note.type) ? `未命名 ${noteTypeLabel(note.type)}` : noteTypeLabel(note.type);
}

/** 影片長度，例如 `1:05`、`1:02:03`。 */
export function formatDuration(seconds: number) {
    const total = Math.round(seconds);
    const pad = (value: number) => String(value).padStart(2, "0");
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const rest = pad(total % 60);
    return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`;
}

/** 右鍵選單上的刪除項目。 */
export function deleteLabel(notes: Note[]) {
    if (notes.length === 1) return `刪除${noteTypeLabel(notes[0].type)}`;
    return notes.every((note) => note.type === "card")
        ? `刪除 ${notes.length} 張卡片`
        : `刪除 ${notes.length} 個項目`;
}
