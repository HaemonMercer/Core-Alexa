import assert from "node:assert/strict";
import { test } from "node:test";
import {
    blockGroup, blockRuns, cardDropAt, columnAt, dropSide, filterCommands, findRanges, findTrigger, hasText, indentLimit, isDividerMarker, listNumbers, pastedLines, shortcutKind, visibleBlocks, wordCount,
} from "../src/components/writer/rules.ts";
import type { DropRow } from "../src/components/writer/rules.ts";
import type { WriterBlock } from "../src/types.ts";

const block = (id: string, kind: string, indent = 0, collapsed = false): WriterBlock => ({
    id, kind, text: "", indent, checked: false, collapsed, language: null, noteId: null, source: null, table: null, group: null, column: 0,
});

const inColumn = (id: string, group: string, column: number): WriterBlock => ({ ...block(id, "paragraph"), group, column });

test("分欄可以超過兩欄", () => {
    const [run] = blockRuns([inColumn("a", "g", 0), inColumn("b", "g", 1), inColumn("c", "g", 2), inColumn("d", "g", 3)]);
    assert.equal(run.type === "columns" && run.columns.length, 4);
});

test("拖到區塊右側四分之一是放到右邊", () => {
    assert.equal(dropSide(800, 0, 1000), "right");
    assert.equal(dropSide(1200, 0, 1000), "right");
});

test("拖到區塊左側是放到左邊，但把手的範圍不算", () => {
    assert.equal(dropSide(100, 0, 1000), "left");
    assert.equal(dropSide(10, 0, 1000), null);
    assert.equal(dropSide(-20, 0, 1000), null);
});

test("拖到區塊中間是放到上下", () => {
    assert.equal(dropSide(500, 0, 1000), null);
});

test("窄的欄中間一樣是放到上下", () => {
    assert.equal(dropSide(47, 0, 94), null);
    assert.equal(dropSide(90, 0, 94), "right");
    assert.equal(dropSide(20, 0, 94), "left");
});

test("游標落在欄裡或欄間", () => {
    const columns = [{ left: 0, right: 100 }, { left: 130, right: 230 }];
    assert.deepEqual(columnAt(50, columns), { index: 0, inGap: false });
    assert.deepEqual(columnAt(115, columns), { index: 1, inGap: true });
    assert.deepEqual(columnAt(500, columns), { index: 1, inGap: false });
    assert.deepEqual(columnAt(-10, columns), { index: 0, inGap: true });
});

test("連續的同一組分欄包成一組，各欄分開放", () => {
    const runs = blockRuns([block("a", "paragraph"), inColumn("b", "g", 0), inColumn("c", "g", 1), inColumn("d", "g", 1), block("e", "paragraph")]);
    assert.deepEqual(runs.map((run) => (run.type === "block" ? run.block.id : run.columns.map((column) => column.map((item) => item.id)))), [
        "a",
        [["b"], ["c", "d"]],
        "e",
    ]);
});

test("分欄裡的區塊沒有文字欄位的只有引入內容與表格", () => {
    assert.equal(hasText("table"), false);
    assert.equal(hasText("paragraph"), true);
});

test("字數：中文一字一個，英文一詞一個，標點不算", () => {
    assert.equal(wordCount("你好，世界。"), 4);
    assert.equal(wordCount("hello world"), 2);
    assert.equal(wordCount("打 3 顆 apple 和 it's"), 6);
    assert.equal(wordCount(""), 0);
});

test("尋找所有位置，不分大小寫也不重疊", () => {
    assert.deepEqual(findRanges("Aa aA", "aa"), [{ from: 0, to: 2 }, { from: 3, to: 5 }]);
    assert.deepEqual(findRanges("aaa", "aa"), [{ from: 0, to: 2 }]);
    assert.deepEqual(findRanges("abc", ""), []);
});

test("/ 指令找得到換頁和目錄", () => {
    assert.equal(filterCommands("換頁")[0].id, "pagebreak");
    assert.equal(filterCommands("目錄")[0].id, "toc");
});

test("/ 指令找得到表格", () => {
    assert.equal(filterCommands("表格")[0].id, "table");
});

test("行首標記加空白會變成對應的區塊", () => {
    assert.equal(shortcutKind("# "), "h1");
    assert.equal(shortcutKind("### "), "h3");
    assert.equal(shortcutKind("- "), "bullet");
    assert.equal(shortcutKind("1. "), "number");
    assert.equal(shortcutKind("[] "), "todo");
    assert.equal(shortcutKind("> "), "quote");
});

test("瀏覽器輸入的不換行空白也算空白", () => {
    assert.equal(shortcutKind("## "), "h2");
});

test("標記後面有內容或沒有空白時不轉換", () => {
    assert.equal(shortcutKind("#"), null);
    assert.equal(shortcutKind("# 標題"), null);
    assert.equal(shortcutKind("#### "), null);
});

test("分隔線標記", () => {
    assert.ok(isDividerMarker("---"));
    assert.ok(!isDividerMarker("--"));
});

test("/ 只在行首或空白後才算指令", () => {
    assert.deepEqual(findTrigger("/待辦"), { type: "slash", from: 0, query: "待辦" });
    assert.deepEqual(findTrigger("文字 /h"), { type: "slash", from: 3, query: "h" });
    assert.equal(findTrigger("a/b"), null);
    assert.equal(findTrigger("https://example.com"), null);
});

test("[[ 開啟連結選單", () => {
    assert.deepEqual(findTrigger("看 [[會議"), { type: "link", from: 2, query: "會議" });
    assert.equal(findTrigger("[[完成]]"), null);
});

test("指令可用中文、英文或 id 篩選", () => {
    assert.ok(filterCommands("").length >= 10);
    assert.deepEqual(filterCommands("todo").map((command) => command.id), ["todo"]);
    assert.ok(filterCommands("待辦").some((command) => command.id === "todo"));
    assert.deepEqual(filterCommands("不存在"), []);
});

test("收合的折疊區塊藏起縮排更深的內容", () => {
    const blocks = [block("a", "toggle", 0, true), block("b", "paragraph", 1), block("c", "paragraph", 2), block("d", "paragraph", 0)];
    assert.deepEqual(visibleBlocks(blocks).map((item) => item.id), ["a", "d"]);
});

test("展開的折疊區塊全部顯示", () => {
    const blocks = [block("a", "toggle"), block("b", "paragraph", 1)];
    assert.equal(visibleBlocks(blocks).length, 2);
});

test("編號清單同層連續計數，被隔開就重來", () => {
    const blocks = [block("a", "number"), block("b", "number", 1), block("c", "number"), block("d", "paragraph"), block("e", "number")];
    assert.deepEqual([...listNumbers(blocks).entries()], [["a", 1], ["b", 1], ["c", 2], ["e", 1]]);
});

test("拖曳區塊時底下縮排的區塊一起走", () => {
    const blocks = [block("a", "bullet"), block("b", "bullet", 1), block("c", "bullet", 2), block("d", "bullet")];
    assert.deepEqual(blockGroup(blocks, "a"), ["a", "b", "c"]);
    assert.deepEqual(blockGroup(blocks, "d"), ["d"]);
    assert.deepEqual(blockGroup(blocks, "x"), []);
});

test("縮排最多比上一個區塊深一層", () => {
    const blocks = [block("a", "paragraph"), block("b", "paragraph", 1)];
    assert.equal(indentLimit(blocks, "a"), 0);
    assert.equal(indentLimit(blocks, "b"), 1);
});

test("貼上多行時各種換行都能切開", () => {
    assert.deepEqual(pastedLines("a\r\nb\rc\nd"), ["a", "b", "c", "d"]);
});

const dropRow = (id: string, top: number, extra: Partial<DropRow> = {}): DropRow => ({ first: id, last: id, top, bottom: top + 20, empty: false, columns: false, ...extra });

test("卡片放在區塊之間，看游標靠近哪一邊", () => {
    const rows = [dropRow("a", 0), dropRow("b", 20)];
    assert.deepEqual(cardDropAt(rows, 5), { after: null, replace: false, leaveColumns: false, line: 0 });
    assert.deepEqual(cardDropAt(rows, 15), { after: "a", replace: false, leaveColumns: false, line: 20 });
    assert.deepEqual(cardDropAt(rows, 500), { after: "b", replace: false, leaveColumns: false, line: 40 });
});

test("卡片放到空段落上取代它，放到文件下方也算最後一段", () => {
    const rows = [dropRow("a", 0), dropRow("b", 20, { empty: true })];
    assert.deepEqual(cardDropAt(rows, 25), { after: "b", replace: true, leaveColumns: false, line: 20 });
    assert.deepEqual(cardDropAt(rows, Number.POSITIVE_INFINITY), { after: "b", replace: true, leaveColumns: false, line: 20 });
});

test("卡片接在分欄後面時留在分欄外", () => {
    const rows = [dropRow("group", 0, { first: "a", last: "c", columns: true }), dropRow("b", 20)];
    assert.deepEqual(cardDropAt(rows, 15), { after: "c", replace: false, leaveColumns: true, line: 20 });
});

test("空白文件也放得下卡片", () => {
    assert.deepEqual(cardDropAt([], 10), { after: null, replace: false, leaveColumns: false, line: 0 });
});
