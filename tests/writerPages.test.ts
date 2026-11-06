import assert from "node:assert/strict";
import { test } from "node:test";
import { bandTop, fitScale, formatPageNumber, pageBox, PAGE_GAP, sheetHeight, showsBands, slotNumber } from "../src/components/writer/pageFormat.ts";
import type { PageNumber, WriterPage } from "../src/types.ts";
import { bandPolygon, groupLines, paginate, type FlowBand, type FlowRow } from "../src/components/writer/paginate.ts";

const metrics = { contentHeight: 100, pitch: 200 };

const row = (id: string, top: number, height: number, splittable = true, keepAfter = 0): FlowRow => ({
    id, top, height, splittable, keepAfter,
});

/** 每行 20 高的文字。`drift` 是瀏覽器每段留白多推的距離。 */
const linesOfRow = (count: number, drift = 0) => (_id: string, bands: FlowBand[]) => {
    const lines = [];
    let top = 0;
    let used = 0;
    for (let index = 0; index < count; index += 1) {
        const band = bands[used];
        if (band && top + 1 > band.top) {
            top += band.height + drift;
            used += 1;
        }
        lines.push({ top, bottom: top + 20 });
        top += 20;
    }
    return { lines, height: top };
};

const empty = { left: "", center: "", right: "" };
const setup = (number: PageNumber, skipFirst = false): WriterPage => ({
    size: "A4", landscape: false, margin: "normal", header: empty, footer: empty, number, skipFirst,
});

test("頁碼的四種格式", () => {
    assert.equal(formatPageNumber("plain", 3, 12), "3");
    assert.equal(formatPageNumber("chinese", 3, 12), "第 3 頁");
    assert.equal(formatPageNumber("fraction", 3, 12), "3 / 12");
    assert.equal(formatPageNumber("chineseTotal", 3, 12), "第 3 頁，共 12 頁");
});

test("頁碼只出現在選定的那一格，頁數從 1 算", () => {
    const page = setup({ place: "footer", align: "right", format: "fraction" });
    assert.equal(slotNumber(page, "footer", "right", 1, 4), "2 / 4");
    assert.equal(slotNumber(page, "footer", "left", 1, 4), "");
    assert.equal(slotNumber(page, "header", "right", 1, 4), "");
});

test("關掉頁碼時哪一格都沒有", () => {
    const page = setup({ place: "none", align: "center", format: "plain" });
    assert.equal(slotNumber(page, "header", "center", 0, 1), "");
    assert.equal(slotNumber(page, "footer", "center", 0, 1), "");
});

test("第一頁不顯示時第二頁仍是第 2 頁", () => {
    const page = setup({ place: "footer", align: "center", format: "plain" }, true);
    assert.equal(showsBands(page, 0), false);
    assert.equal(showsBands(page, 1), true);
    assert.equal(slotNumber(page, "footer", "center", 1, 2), "2");
});

test("頁首貼著每一頁的頂端，頁尾填滿下方留白", () => {
    const box = pageBox({ size: "A4", landscape: false, margin: "normal" });
    assert.equal(bandTop(box, "header", 0), 0);
    assert.equal(bandTop(box, "header", 2), box.pitch * 2);
    assert.equal(bandTop(box, "footer", 0) + box.margin, box.height);
    assert.equal(bandTop(box, "footer", 1) + box.margin, box.pitch + box.height);
});

test("A4 直向的尺寸換算成像素", () => {
    const box = pageBox({ size: "A4", landscape: false, margin: "normal" });
    assert.equal(Math.round(box.width), 794);
    assert.equal(Math.round(box.height), 1123);
    assert.equal(Math.round(box.margin), 96);
    assert.equal(Math.round(box.contentHeight), 931);
});

test("橫向對調長寬", () => {
    const portrait = pageBox({ size: "B4", landscape: false, margin: "normal" });
    const landscape = pageBox({ size: "B4", landscape: true, margin: "normal" });
    assert.equal(landscape.width, portrait.height);
    assert.equal(landscape.height, portrait.width);
});

test("不認識的紙張用 A4", () => {
    assert.deepEqual(pageBox({ size: "A9", landscape: false, margin: "?" }), pageBox({ size: "A4", landscape: false, margin: "normal" }));
});

test("整疊紙的高度含頁間距", () => {
    const box = pageBox({ size: "A5", landscape: false, margin: "normal" });
    assert.equal(sheetHeight(box, 1), box.height);
    assert.equal(sheetHeight(box, 3), box.height * 3 + PAGE_GAP * 2);
});

test("紙比可用寬度寬才縮小", () => {
    const box = pageBox({ size: "A4", landscape: false, margin: "normal" });
    assert.equal(fitScale(box, 2000), 1);
    assert.equal(fitScale(box, box.width / 2), 0.5);
});

test("放得下時一頁就好", () => {
    const result = paginate([row("a", 0, 40), row("b", 40, 60)], metrics, linesOfRow(0));
    assert.deepEqual(result, { pages: 1, breaks: [] });
});

test("剛好填滿一頁不會多一頁", () => {
    assert.equal(paginate([row("a", 0, 200, false)], { contentHeight: 200, pitch: 200 }, linesOfRow(0)).pages, 1);
});

test("圖片放不下就整塊換頁", () => {
    const result = paginate([row("a", 0, 80), row("b", 80, 50, false), row("c", 130, 20)], metrics, linesOfRow(0));
    assert.equal(result.pages, 2);
    assert.deepEqual(result.breaks, [{ id: "b", push: 120, bands: [] }]);
});

test("段落從放不下的那一行分到下一頁", () => {
    const result = paginate([row("a", 60, 80)], metrics, linesOfRow(4));
    assert.equal(result.pages, 2);
    assert.deepEqual(result.breaks, [{ id: "a", push: 0, bands: [{ top: 40, height: 100 }] }]);
});

test("分頁的推移會累積到後面的區塊", () => {
    const result = paginate([row("a", 60, 80), row("b", 140, 20, false)], metrics, linesOfRow(4));
    // a 多佔了 100，b 接在第二頁第二行之後，不用再推。
    assert.equal(result.breaks.length, 1);
    assert.equal(result.pages, 2);
});

test("第一行就放不下時整段換頁", () => {
    const result = paginate([row("a", 90, 60)], metrics, linesOfRow(3));
    assert.deepEqual(result.breaks, [{ id: "a", push: 110, bands: [] }]);
});

test("比一頁長的段落會分成好幾頁", () => {
    const result = paginate([row("a", 0, 280)], metrics, linesOfRow(14));
    assert.equal(result.pages, 3);
    assert.deepEqual(result.breaks[0].bands.map((band) => band.top), [100, 300]);
    assert.deepEqual(result.breaks[0].bands.map((band) => band.height), [100, 100]);
});

test("瀏覽器多推的誤差不會累積到最後一頁", () => {
    const layout = linesOfRow(40, 2);
    const result = paginate([row("a", 0, 800)], metrics, layout);
    const { lines } = layout("a", result.breaks[0].bands);
    for (const line of lines) {
        const page = Math.floor((line.top + 3) / metrics.pitch);
        assert.ok(line.bottom <= page * metrics.pitch + metrics.contentHeight, `第 ${page + 1} 頁的 ${line.top}`);
    }
});

test("留白推不動的空行不會讓分頁停不下來", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({ top: index * 20, bottom: (index + 1) * 20 }));
    const result = paginate([row("a", 0, 200)], metrics, () => ({ lines, height: 200 }));
    assert.ok(result.breaks[0].bands.length <= lines.length);
});

test("比一頁高的圖片已在頁首時不再換頁", () => {
    const result = paginate([row("a", 0, 150, false)], metrics, linesOfRow(0));
    assert.deepEqual(result.breaks, []);
});

test("標題不會單獨留在頁尾", () => {
    const result = paginate([row("a", 0, 80), row("h", 80, 18, false, 28), row("c", 98, 20)], metrics, linesOfRow(0));
    assert.deepEqual(result.breaks, [{ id: "h", push: 120, bands: [] }]);
});

test("上一塊的內距落在頁間時，下一塊從下一頁開始", () => {
    const result = paginate([row("a", 0, 100, false), row("b", 100, 20, false)], metrics, linesOfRow(0));
    assert.deepEqual(result.breaks, [{ id: "b", push: 100, bands: [] }]);
});

test("分欄每一欄各自換頁，後面的區塊接在較長那一欄之後", () => {
    const left = row("l", 0, 240);
    const right = row("r", 0, 20);
    const group: FlowRow = { ...row("g", 0, 240, false), columns: [[left], [right]] };
    const result = paginate([group, row("next", 240, 20, false)], metrics, linesOfRow(12));
    assert.deepEqual(result.breaks.map((item) => item.id), ["l"]);
    assert.equal(result.pages, 3);
});

test("分欄開頭放不下時整組換頁", () => {
    const image = row("i", 90, 50, false);
    const text = row("t", 90, 50);
    const group: FlowRow = { ...row("g", 90, 50, false), columns: [[image], [text]] };
    const result = paginate([group], metrics, linesOfRow(3));
    assert.deepEqual(result.breaks, [{ id: "g", push: 110, bands: [] }]);
});

test("換頁記號後面的區塊從下一頁開始", () => {
    const result = paginate([row("a", 0, 20), { ...row("b", 20, 10, false), pageBreak: true }, row("c", 30, 20)], metrics, linesOfRow(0));
    assert.deepEqual(result.breaks, [{ id: "c", push: 170, bands: [] }]);
    assert.equal(result.pages, 2);
});

test("換頁記號落在頁尾留白時不會多一張空白頁", () => {
    const result = paginate([row("a", 0, 100, false), { ...row("b", 100, 10, false), pageBreak: true }, row("c", 110, 20)], metrics, linesOfRow(0));
    assert.equal(result.pages, 2);
    assert.deepEqual(result.breaks, [{ id: "c", push: 90, bands: [] }]);
});

test("換頁記號連續兩個會空出一頁", () => {
    const mark = (id: string, top: number) => ({ ...row(id, top, 10, false), pageBreak: true });
    const result = paginate([mark("a", 0), mark("b", 10), row("c", 20, 20)], metrics, linesOfRow(0));
    assert.equal(result.pages, 2);
});

test("分欄裡的換頁只影響那一欄", () => {
    const group: FlowRow = {
        ...row("g", 0, 40, false),
        columns: [[{ ...row("m", 0, 10, false), pageBreak: true }, row("l", 10, 20)], [row("r", 0, 40)]],
    };
    const result = paginate([group], metrics, linesOfRow(0));
    assert.deepEqual(result.breaks.map((item) => item.id), ["l"]);
});

test("只有跨頁的區塊才量行", () => {
    let measured = 0;
    paginate([row("a", 0, 40), row("b", 40, 40)], metrics, () => {
        measured += 1;
        return { lines: [], height: 0 };
    });
    assert.equal(measured, 0);
});

test("留白的多邊形可以有好幾段", () => {
    assert.equal(
        bandPolygon([{ top: 10, height: 5 }, { top: 40, height: 5 }]),
        "0 10px, 100% 10px, 100% 15px, 0 15px, 0 40px, 100% 40px, 100% 45px, 0 45px",
    );
});

test("同一行的方框併成一行，高度用行高", () => {
    const lines = groupLines([
        { top: 3, bottom: 21 },
        { top: 1, bottom: 23 },
        { top: 27, bottom: 45 },
        { top: 10, bottom: 10 },
    ], 24);
    assert.deepEqual(lines, [{ top: 0, bottom: 24 }, { top: 24, bottom: 48 }]);
});
