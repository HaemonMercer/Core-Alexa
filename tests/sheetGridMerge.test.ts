import assert from "node:assert/strict";
import { test } from "node:test";
import {
    boxHasMerge, expandBox, fillTarget, findCells, mergeAnchor, mergeMaps, replaceText, stepCell,
} from "../src/components/sheet/grid.ts";
import type { SheetTable } from "../src/types.ts";

const merge = { top: 1, left: 1, rows: 2, cols: 2 };
const limits = { rows: 5, cols: 5, merges: [merge], hidden: new Set<number>() };

test("選取碰到合併的格子時整塊包進來", () => {
    assert.deepEqual(expandBox({ top: 0, bottom: 1, left: 0, right: 1 }, [merge]), { top: 0, bottom: 2, left: 0, right: 2 });
});

test("包進來後碰到別塊也要包", () => {
    const other = { top: 2, left: 3, rows: 2, cols: 1 };
    assert.deepEqual(expandBox({ top: 1, bottom: 1, left: 1, right: 1 }, [merge, other]), { top: 1, bottom: 2, left: 1, right: 2 });
    assert.deepEqual(expandBox({ top: 1, bottom: 2, left: 1, right: 3 }, [merge, other]), { top: 1, bottom: 3, left: 1, right: 3 });
});

test("被蓋住的格子用左上角代表", () => {
    assert.deepEqual(mergeAnchor([merge], { row: 2, col: 2 }), { row: 1, col: 1 });
    assert.deepEqual(mergeAnchor([merge], { row: 0, col: 0 }), { row: 0, col: 0 });
});

test("畫表格時略過被蓋住的格子", () => {
    const { covered, spans } = mergeMaps([merge]);
    assert.equal(covered.size, 3);
    assert.equal(covered.has("1:1"), false);
    assert.equal(spans.get("1:1"), merge);
});

test("方向鍵走出合併的格子", () => {
    assert.deepEqual(stepCell({ row: 1, col: 1 }, 1, 0, limits), { row: 3, col: 1 });
    assert.deepEqual(stepCell({ row: 1, col: 1 }, 0, 1, limits), { row: 1, col: 3 });
    assert.deepEqual(stepCell({ row: 1, col: 1 }, -1, 0, limits), { row: 0, col: 1 });
});

test("方向鍵走進合併的格子會到左上角", () => {
    assert.deepEqual(stepCell({ row: 3, col: 2 }, -1, 0, limits), { row: 1, col: 1 });
});

test("方向鍵跳過隱藏的列，到邊界留在原地", () => {
    const hidden = { ...limits, merges: [], hidden: new Set([1, 2]) };
    assert.deepEqual(stepCell({ row: 0, col: 0 }, 1, 0, hidden), { row: 3, col: 0 });
    assert.deepEqual(stepCell({ row: 0, col: 0 }, -1, 0, hidden), { row: 0, col: 0 });
    assert.deepEqual(stepCell({ row: 3, col: 0 }, 1, 0, { ...hidden, hidden: new Set([4]) }), { row: 3, col: 0 });
});

test("填充只往較遠的方向延伸", () => {
    const box = { top: 1, bottom: 2, left: 1, right: 2 };
    assert.deepEqual(fillTarget(box, { row: 5, col: 3 }), { top: 3, bottom: 5, left: 1, right: 2 });
    assert.deepEqual(fillTarget(box, { row: 3, col: 6 }), { top: 1, bottom: 2, left: 3, right: 6 });
    assert.deepEqual(fillTarget(box, { row: 0, col: 1 }), { top: 0, bottom: 0, left: 1, right: 2 });
    assert.deepEqual(fillTarget(box, { row: 1, col: 0 }), { top: 1, bottom: 2, left: 0, right: 0 });
    assert.equal(fillTarget(box, { row: 2, col: 2 }), null);
});

test("判斷選取裡有沒有合併", () => {
    assert.equal(boxHasMerge({ top: 0, bottom: 0, left: 0, right: 0 }, [merge]), false);
    assert.equal(boxHasMerge({ top: 2, bottom: 3, left: 2, right: 3 }, [merge]), true);
});

const table = {
    id: "t",
    rows: [{ id: "r0", size: 28 }, { id: "r1", size: 28 }],
    cols: [{ id: "c0", size: 100 }],
    merges: [],
    hiddenRows: ["r1"],
    cells: { "r0:c0": { display: "Apple" }, "r1:c0": { display: "apple" } },
} as unknown as SheetTable;

test("尋找不分大小寫且略過隱藏的列", () => {
    assert.deepEqual(findCells([table], "APP"), [{ tableID: "t", row: 0, col: 0 }]);
    assert.deepEqual(findCells([table], ""), []);
});

test("取代全部出現的地方，不分大小寫", () => {
    assert.equal(replaceText("Apple apple", "APPLE", "梨"), "梨 梨");
    assert.equal(replaceText("abc", "x", "y"), "abc");
    assert.equal(replaceText("aaa", "a", "aa"), "aaaaaa");
});
