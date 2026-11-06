import assert from "node:assert/strict";
import { test } from "node:test";
import {
    boxOf, cellLabel, clampCell, colLabel, offsetsOf, parseClipboard, tablePrefix, toClipboard,
} from "../src/components/sheet/grid.ts";

test("欄名超過 Z 之後變成兩個字母", () => {
    assert.equal(colLabel(0), "A");
    assert.equal(colLabel(25), "Z");
    assert.equal(colLabel(26), "AA");
    assert.equal(colLabel(701), "ZZ");
    assert.equal(colLabel(702), "AAA");
});

test("格子名稱", () => {
    assert.equal(cellLabel({ row: 2, col: 1 }), "B3");
});

test("反向拖曳的選取框也是由小到大", () => {
    const box = boxOf({ tableID: "t", anchor: { row: 4, col: 3 }, focus: { row: 1, col: 5 } });
    assert.deepEqual(box, { top: 1, bottom: 4, left: 3, right: 5 });
});

test("刪除列欄後選取夾回範圍內", () => {
    assert.deepEqual(clampCell({ row: 9, col: -1 }, 3, 4), { row: 2, col: 0 });
});

test("偏移量的最後一格是總長", () => {
    assert.deepEqual(offsetsOf([10, 20, 30]), [0, 10, 30, 60]);
    assert.deepEqual(offsetsOf([]), [0]);
});

test("表格名稱有空白或符號時要加引號", () => {
    assert.equal(tablePrefix("表格1"), "表格1::");
    assert.equal(tablePrefix("Q1 預算"), "'Q1 預算'::");
    assert.equal(tablePrefix("It's"), "'It''s'::");
});

test("解析 Excel 複製出來的 TSV", () => {
    assert.deepEqual(parseClipboard("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
});

test("引號裡可以有換行、Tab 與引號", () => {
    assert.deepEqual(parseClipboard('"a\nb"\t"c\td"\n"say ""hi"""'), [["a\nb", "c\td"], ['say "hi"']]);
});

test("單一格子與空字串", () => {
    assert.deepEqual(parseClipboard("x"), [["x"]]);
    assert.deepEqual(parseClipboard(""), [[""]]);
});

test("複製再貼上內容不變", () => {
    const rows = [["a\tb", 'q"x'], ["line\nbreak", ""]];
    assert.deepEqual(parseClipboard(toClipboard(rows)), rows);
});
