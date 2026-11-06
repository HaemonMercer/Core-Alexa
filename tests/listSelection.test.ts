import assert from "node:assert/strict";
import { test } from "node:test";
import {
    clickSelection,
    contextSelection,
    NO_SELECTION,
    selectedInOrder,
} from "../src/components/common/listSelection.ts";

const ordered = ["a", "b", "c", "d"];
const plain = { toggle: false, range: false };
const toggle = { toggle: true, range: false };
const range = { toggle: false, range: true };
const ids = (selection: { selected: ReadonlySet<string> }) => [...selection.selected].sort();

test("一般點選只留下點到的項目", () => {
    const first = clickSelection(NO_SELECTION, ordered, "a", plain);
    assert.deepEqual(ids(clickSelection(first, ordered, "b", plain)), ["b"]);
});

test("Ctrl 點選加入或取消，不影響其他項目", () => {
    const one = clickSelection(NO_SELECTION, ordered, "a", plain);
    const two = clickSelection(one, ordered, "c", toggle);
    assert.deepEqual(ids(two), ["a", "c"]);
    assert.deepEqual(ids(clickSelection(two, ordered, "a", toggle)), ["c"]);
});

test("Shift 點選選取起點到終點，往上往下都可以", () => {
    const start = clickSelection(NO_SELECTION, ordered, "b", plain);
    assert.deepEqual(ids(clickSelection(start, ordered, "d", range)), ["b", "c", "d"]);
    assert.deepEqual(ids(clickSelection(start, ordered, "a", range)), ["a", "b"]);
});

test("連續 Shift 點選以同一個起點重新計算", () => {
    const start = clickSelection(NO_SELECTION, ordered, "b", plain);
    const down = clickSelection(start, ordered, "d", range);
    assert.deepEqual(ids(clickSelection(down, ordered, "c", range)), ["b", "c"]);
});

test("Ctrl+Shift 點選保留原本的選取", () => {
    const one = clickSelection(NO_SELECTION, ordered, "a", plain);
    const start = clickSelection(one, ordered, "c", toggle);
    const both = clickSelection(start, ordered, "d", { toggle: true, range: true });
    assert.deepEqual(ids(both), ["a", "c", "d"]);
});

test("沒有起點時 Shift 點選視為一般點選", () => {
    assert.deepEqual(ids(clickSelection(NO_SELECTION, ordered, "c", range)), ["c"]);
});

test("起點已不在清單時 Shift 點選視為一般點選", () => {
    const stale = { selected: new Set(["x"]), anchor: "x" };
    assert.deepEqual(ids(clickSelection(stale, ordered, "c", range)), ["c"]);
});

test("回傳的選取依清單順序，略過已不存在的項目", () => {
    const selection = { selected: new Set(["c", "gone", "a"]), anchor: "c" };
    assert.deepEqual(selectedInOrder(selection, ordered), ["a", "c"]);
});

test("右鍵按在選取範圍內保留整組，按在外面只選那一個", () => {
    const group = { selected: new Set(["a", "b"]), anchor: "a" };
    assert.equal(contextSelection(group, "b"), group);
    assert.deepEqual(ids(contextSelection(group, "c")), ["c"]);
});
