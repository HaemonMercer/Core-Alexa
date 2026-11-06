import type { BandSlot, PageNumber, WriterPage } from "../../types.ts";

// 紙張與邊距的實際尺寸。名稱清單要和 `model/writer.rs` 一致。

const PX_PER_MM = 96 / 25.4;

/** 間距固定，不隨紙張改變。 */
export const PAGE_GAP = 16;

/** 寬 × 高（公釐），都是直向。B 系列用影印與 Word 常見的 JIS 尺寸。 */
export const PAGE_SIZES = [
    { id: "A3", label: "A3", width: 297, height: 420 },
    { id: "A4", label: "A4", width: 210, height: 297 },
    { id: "A5", label: "A5", width: 148, height: 210 },
    { id: "B4", label: "B4", width: 257, height: 364 },
    { id: "B5", label: "B5", width: 182, height: 257 },
    { id: "Letter", label: "Letter", width: 215.9, height: 279.4 },
    { id: "Legal", label: "Legal", width: 215.9, height: 355.6 },
];

export const PAGE_MARGINS = [
    { id: "narrow", label: "窄", size: 12.7 },
    { id: "normal", label: "標準", size: 25.4 },
    { id: "wide", label: "寬", size: 38.1 },
];

export interface PageBox {
    width: number;
    height: number;
    margin: number;
    /** 一頁能放內容的高度。 */
    contentHeight: number;
    /** 這一頁到下一頁的內容起點距離。 */
    pitch: number;
}

export const NUMBER_PLACES: { id: PageNumber["place"]; label: string }[] = [
    { id: "none", label: "無" },
    { id: "header", label: "頁首" },
    { id: "footer", label: "頁尾" },
];

export const BAND_SLOTS: { id: BandSlot; label: string }[] = [
    { id: "left", label: "靠左" },
    { id: "center", label: "置中" },
    { id: "right", label: "靠右" },
];

export const NUMBER_FORMATS: { id: PageNumber["format"]; label: string }[] = [
    { id: "plain", label: "1" },
    { id: "chinese", label: "第 1 頁" },
    { id: "fraction", label: "1 / 5" },
    { id: "chineseTotal", label: "第 1 頁，共 5 頁" },
];

export function formatPageNumber(format: PageNumber["format"], page: number, pages: number) {
    switch (format) {
        case "chinese": return `第 ${page} 頁`;
        case "fraction": return `${page} / ${pages}`;
        case "chineseTotal": return `第 ${page} 頁，共 ${pages} 頁`;
        default: return String(page);
    }
}

export type BandArea = "header" | "footer";

/** 這一頁（從 0 算）顯示頁首頁尾嗎。頁碼仍照實際頁數，封面後面是第 2 頁。 */
export const showsBands = (page: WriterPage, index: number) => !(page.skipFirst && index === 0);

/** 頁首或頁尾某一格要接在文字後面的頁碼，沒有就是空字串。 */
export function slotNumber(page: WriterPage, area: BandArea, slot: BandSlot, index: number, pages: number) {
    const { place, align, format } = page.number;
    return place === area && align === slot ? formatPageNumber(format, index + 1, pages) : "";
}

/** 頁首頁尾佔滿上下留白，在分頁的那張連續的紙上的位置。 */
export const bandTop = (box: PageBox, area: BandArea, index: number) =>
    index * box.pitch + (area === "header" ? 0 : box.height - box.margin);

/** 把版面換算成畫面上的像素。 */
export function pageBox(page: Pick<WriterPage, "size" | "landscape" | "margin">): PageBox {
    const size = PAGE_SIZES.find((item) => item.id === page.size) ?? PAGE_SIZES[1];
    const margin = (PAGE_MARGINS.find((item) => item.id === page.margin) ?? PAGE_MARGINS[1]).size * PX_PER_MM;
    const short = size.width * PX_PER_MM;
    const long = size.height * PX_PER_MM;
    const width = page.landscape ? long : short;
    const height = page.landscape ? short : long;
    return { width, height, margin, contentHeight: height - margin * 2, pitch: height + PAGE_GAP };
}

/** 整疊紙的高度。 */
export const sheetHeight = (box: PageBox, pages: number) => (pages - 1) * box.pitch + box.height;

/** 列印時紙與紙之間沒有間距，要重新分頁，頁碼和螢幕上才會一致。 */
export const printBox = (box: PageBox): PageBox => ({ ...box, pitch: box.height });

/** 紙比可用寬度寬時整份縮小；不放大。 */
export const fitScale = (box: PageBox, available: number) => Math.min(1, Math.max(available, 1) / box.width);
