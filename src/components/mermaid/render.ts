import type { Mermaid } from "mermaid";
import type { PreviewRenderer } from "../canvas/notePreview.ts";
import { rasterSize } from "./size.ts";

// Mermaid 體積大，第一次用到才載入。這裡只負責顯示：原始碼存在 note.content，Rust 不解析。

export interface Diagram {
    /** 用 <img> 載入，裡面的內容不會碰到頁面。 */
    dataUri: string;
    width: number;
    height: number;
}

const CACHE_LIMIT = 100;
const cache = new Map<string, Promise<Diagram>>();
let mermaid: Promise<Mermaid> | null = null;
let nextId = 0;

function loadMermaid() {
    mermaid ??= import("mermaid").then(({ default: instance }) => {
        instance.initialize({ startOnLoad: false, securityLevel: "strict" });
        return instance;
    });
    return mermaid;
}

/** Mermaid 的寬度是 100%，放進 <img> 要有實際尺寸。先當 HTML 解析，輸出才是合法的 XML。 */
function toDiagram(svg: string): Diagram {
    const root = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
    const box = root?.getAttribute("viewBox")?.split(/[ ,]+/).map(Number);
    if (!root || box?.length !== 4) throw new Error("Mermaid 沒有產生圖形");

    const width = Math.ceil(box[2]);
    const height = Math.ceil(box[3]);
    root.setAttribute("width", String(width));
    root.setAttribute("height", String(height));
    root.style.maxWidth = "";
    const source = new XMLSerializer().serializeToString(root);
    return { dataUri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`, width, height };
}

async function render(text: string): Promise<Diagram> {
    const instance = await loadMermaid();
    // 先檢查語法：渲染失敗會在頁面上留下暫存元素。
    await instance.parse(text);
    const id = `mermaid-${++nextId}`;
    try {
        return toDiagram((await instance.render(id, text)).svg);
    } finally {
        document.getElementById(`d${id}`)?.remove();
    }
}

/** 語法錯誤時 reject，訊息可以直接顯示。同一份原始碼只渲染一次。 */
export function renderMermaid(text: string): Promise<Diagram> {
    const cached = cache.get(text);
    if (cached) return cached;

    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    const result = render(text);
    cache.set(text, result);
    result.catch(() => cache.delete(text));
    return result;
}

async function toCanvas({ dataUri, width, height }: Diagram) {
    const image = new Image();
    image.src = dataUri;
    await image.decode();

    const size = rasterSize(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, size.width, size.height);
    return canvas;
}

export const mermaidPreview: PreviewRenderer = {
    version: (note) => note.content,
    render: async (note) => (note.content.trim() ? toCanvas(await renderMermaid(note.content)) : null),
};
