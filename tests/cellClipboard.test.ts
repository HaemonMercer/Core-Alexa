import assert from "node:assert/strict";
import { test } from "node:test";
import { cellsFromHtml, cellsToHtml, isSingleCell } from "../src/components/office/cellClipboard.ts";

const source = { noteId: "n", tableId: "t", rows: ["r1", "r2"], cols: ["c1"] };

test("Excels 複製的 HTML 帶得回來源範圍", () => {
    assert.deepEqual(cellsFromHtml(cellsToHtml(source, [["甲"], ["乙"]])), source);
});

test("內容裡的特殊字元會跳脫", () => {
    assert.match(cellsToHtml(source, [["<b>&"]]), /<td>&lt;b&gt;&amp;<\/td>/);
});

test("一般網頁的表格沒有來源", () => {
    assert.equal(cellsFromHtml("<table><tr><td>1</td></tr></table>"), null);
});

test("格式不對的來源當成沒有", () => {
    assert.equal(cellsFromHtml('<table data-alexa-cells="%7B%7D">'), null);
    assert.equal(cellsFromHtml('<table data-alexa-cells="%">'), null);
});

test("只有一格時是貼一個值", () => {
    assert.equal(isSingleCell({ ...source, rows: ["r1"] }), true);
    assert.equal(isSingleCell(source), false);
});
