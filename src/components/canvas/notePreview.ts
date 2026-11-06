import type { Note } from "../../types.ts";

// 非卡片內容在畫布上都畫成一張圖。產生圖要花時間，所以先畫佔位框，好了再重畫。

export type PreviewImage = ImageBitmap | HTMLCanvasElement;

export interface PreviewRenderer {
    /** 值改變才重新產生。內容沒變時平移、縮放不會重做。 */
    version: (note: Note) => string;
    /** null 表示沒有內容可畫，要回到佔位框。語法錯誤要 reject，才會留著上一張圖。 */
    render: (note: Note, variant?: string) => Promise<PreviewImage | null>;
}

interface Entry {
    version: string;
    image: PreviewImage | null;
}

const DEFAULT_LIMIT = 200;

const release = (image: PreviewImage | null) => {
    if (image && "close" in image) image.close();
};

export class NotePreviews {
    private readonly entries = new Map<string, Entry>();
    private readonly renderers: Record<string, PreviewRenderer>;
    private readonly onReady: () => void;
    private readonly limit: number;

    constructor(renderers: Record<string, PreviewRenderer>, onReady: () => void, limit = DEFAULT_LIMIT) {
        this.renderers = renderers;
        this.onReady = onReady;
        this.limit = limit;
    }

    /** 內容改變後、新圖好之前回傳舊圖；語法寫到一半失敗時也留著上一張正確的。 */
    /** 同一份筆記在白板上有不同畫面時（例如試算表的各個表格）用 `variant` 分開快取。 */
    get(note: Note, variant?: string): PreviewImage | null {
        const renderer = this.renderers[note.type];
        if (!renderer) return null;

        const key = variant ? `${note.id}:${variant}` : note.id;
        const version = renderer.version(note);
        let entry = this.entries.get(key);
        if (entry) {
            // 重新插入，Map 的順序就是最近使用的順序。
            this.entries.delete(key);
            this.entries.set(key, entry);
        }
        if (entry?.version !== version) {
            entry = { version, image: entry?.image ?? null };
            this.entries.set(key, entry);
            this.evict();
            this.start(note, variant, key, renderer, entry);
        }
        return entry.image;
    }

    dispose() {
        for (const { image } of this.entries.values()) release(image);
        this.entries.clear();
    }

    private start(note: Note, variant: string | undefined, key: string, renderer: PreviewRenderer, entry: Entry) {
        renderer.render(note, variant).then(
            (image) => {
                // 等待期間內容又變了或已被淘汰，這張圖就沒有用了。
                if (this.entries.get(key) !== entry) {
                    release(image);
                    return;
                }
                release(entry.image);
                entry.image = image;
                this.onReady();
            },
            () => { /* 錯誤由編輯器顯示，畫布維持原本的圖。 */ },
        );
    }

    private evict() {
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next().value as string;
            release(this.entries.get(oldest)?.image ?? null);
            this.entries.delete(oldest);
        }
    }
}
