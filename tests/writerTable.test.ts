import assert from "node:assert/strict";
import { test } from "node:test";
import {
    columnTemplate, deleteColumn, deleteRow, emptyTable, insertColumn, insertRow, overlayTable, tableFromText,
} from "../src/components/writer/table.ts";

test("欄寬依內容分配，中文字算兩格", () => {
    assert.equal(columnTemplate([["品項名稱", "abcdefgh"]]), "minmax(min(82px, 50%), 8fr) minmax(min(82px, 50%), 8fr)");
});

test("欄寬有上下限，看的是整欄最長的內容", () => {
    assert.equal(columnTemplate([["a", "x".repeat(100)], ["bbbbbb", ""]]), "minmax(min(66px, 50%), 6fr) minmax(min(82px, 50%), 30fr)");
    assert.equal(columnTemplate([["", ""]]), "minmax(min(18px, 50%), 4fr) minmax(min(18px, 50%), 4fr)");
});

test("Excel 複製的 Tab 分隔文字變成表格", () => {
    assert.deepEqual(tableFromText("項目\t金額\r\n午餐\t120\r\n"), [["項目", "金額"], ["午餐", "120"]]);
});

test("欄數不齊時補空格", () => {
    assert.deepEqual(tableFromText("甲\t乙\t丙\n丁\t戊"), [["甲", "乙", "丙"], ["丁", "戊", ""]]);
});

test("一行有 Tab 的文字不是表格", () => {
    assert.equal(tableFromText("甲\t乙"), null);
});

test("不是每行都有 Tab 的多行文字不是表格", () => {
    assert.equal(tableFromText("第一段\n第二段\t結尾"), null);
});

test("Markdown 表格", () => {
    assert.deepEqual(tableFromText("| 名稱 | 值 |\n| --- | :--: |\n| a | 1 |\n"), [["名稱", "值"], ["a", "1"]]);
});

test("Markdown 表格沒有外框也可以，直線可以跳脫", () => {
    assert.deepEqual(tableFromText("a | b\n--|--\nc\\|d | e"), [["a", "b"], ["c|d", "e"]]);
});

test("有直線但沒有分隔列的文字不是表格", () => {
    assert.equal(tableFromText("a | b\nc | d"), null);
});

test("貼到格子裡會蓋過去，超出時長大", () => {
    const table = [["1", "2"], ["3", "4"]];
    assert.deepEqual(overlayTable(table, 1, 1, [["x", "y"], ["z", ""]]), [["1", "2", ""], ["3", "x", "y"], ["", "z", ""]]);
});

test("插入列與欄", () => {
    const table = [["1", "2"]];
    assert.deepEqual(insertRow(table, 0), [["", ""], ["1", "2"]]);
    assert.deepEqual(insertColumn(table, 1), [["1", "", "2"]]);
});

test("刪掉最後一列或一欄回傳 null", () => {
    assert.equal(deleteRow(emptyTable(1, 2), 0), null);
    assert.equal(deleteColumn(emptyTable(2, 1), 0), null);
    assert.deepEqual(deleteRow([["1"], ["2"]], 0), [["2"]]);
    assert.deepEqual(deleteColumn([["1", "2"]], 1), [["1"]]);
});
