import { runsText, type Block } from "./ast.ts";
import { parseMarkdown } from "./parse.ts";

// 卡片之間的連結就是一般的 Markdown 連結，網址是 `note:<筆記 id>`。
// 用 id 而不是標題，卡片改內容後連結才不會斷；哪些卡片互相連結由 Rust 從內文推導。

const NOTE_HREF = "note:";
const TITLE_LIMIT = 60;
const UNTITLED = "（空白卡片）";

export const noteHref = (noteID: string) => `${NOTE_HREF}${noteID}`;

/** 不是卡片連結時回傳 null。 */
export const noteIDFromHref = (href: string) =>
    href.startsWith(NOTE_HREF) ? href.slice(NOTE_HREF.length) : null;

function firstLine(blocks: Block[]): string {
    for (const block of blocks) {
        const text = (() => {
            switch (block.type) {
                case "paragraph":
                case "heading":
                    return runsText(block.runs);
                case "code":
                    return block.text;
                case "quote":
                    return firstLine(block.blocks);
                case "list":
                    return firstLine(block.items.flat());
                case "table":
                    return block.rows.flat().map(runsText).find(Boolean) ?? "";
                case "rule":
                case "image":
                    return "";
            }
        })();
        const line = text.split("\n").map((part) => part.trim()).find(Boolean);
        if (line) return line;
    }
    return "";
}

/** 打的文字已經是某張卡片的標題時，就不必再提供建立新卡片。 */
export function isNewCardTitle(query: string, titles: string[]): boolean {
    const wanted = query.trim().toLowerCase();
    return wanted !== "" && !titles.some((title) => title.toLowerCase() === wanted);
}

/** 卡片沒有標題欄位，用第一行文字代表它。 */
export const cardTitle = (markdown: string) =>
    firstLine(parseMarkdown(markdown)).slice(0, TITLE_LIMIT) || UNTITLED;
