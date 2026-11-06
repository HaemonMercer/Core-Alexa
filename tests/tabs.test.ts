import assert from "node:assert/strict";
import { test } from "node:test";
import {
    activeTab, addTab, closeOtherTabs, closeTab, dropMissingBoards, followActiveBoard, moveTab, neighbourTab,
    newTab, parseTabs, patchActive, tabShowingBoard, tabShowingNote, withoutNotes, type Tab, type TabState,
} from "../src/components/tabs/tabs.ts";

const tab = (id: string, fields: Partial<Tab> = {}): Tab => ({
    id, page: "whiteboard", whiteboardID: "root", fullscreenID: null, ...fields,
});
const state = (ids: string[], activeID = ids[0]): TabState => ({ tabs: ids.map((id) => tab(id)), activeID });
const ids = (value: TabState) => value.tabs.map((item) => item.id);

test("新分頁放在目前分頁右邊並切換過去", () => {
    const added = tab("x");
    const next = addTab(state(["a", "b"], "a"), added);
    assert.deepEqual(ids(next), ["a", "x", "b"]);
    assert.equal(next.activeID, "x");
});

test("newTab 每次產生不同的 id", () => {
    const fields = { page: "cards" as const, whiteboardID: "root", fullscreenID: null };
    assert.notEqual(newTab(fields).id, newTab(fields).id);
});

test("用別的分頁展開建立時不會沿用它的 id", () => {
    assert.notEqual(newTab({ ...tab("a"), fullscreenID: "n1" }).id, "a");
});

test("關掉目前分頁時切到右邊，最右邊時切到左邊", () => {
    assert.equal(closeTab(state(["a", "b", "c"], "b"), "b").activeID, "c");
    assert.equal(closeTab(state(["a", "b", "c"], "c"), "c").activeID, "b");
});

test("關掉別的分頁不換目前分頁", () => {
    const next = closeTab(state(["a", "b", "c"], "a"), "c");
    assert.equal(next.activeID, "a");
    assert.deepEqual(ids(next), ["a", "b"]);
});

test("最後一個分頁不能關", () => {
    const only = state(["a"]);
    assert.equal(closeTab(only, "a"), only);
});

test("關閉其他分頁後留下的分頁變成目前分頁", () => {
    const next = closeOtherTabs(state(["a", "b", "c"], "a"), "b");
    assert.deepEqual(ids(next), ["b"]);
    assert.equal(next.activeID, "b");
});

test("切換到頭後繞回另一端", () => {
    assert.equal(neighbourTab(state(["a", "b"], "b"), 1), "a");
    assert.equal(neighbourTab(state(["a", "b"], "a"), -1), "b");
});

test("移動分頁不換目前分頁", () => {
    const next = moveTab(state(["a", "b", "c"], "a"), "a", 2);
    assert.deepEqual(ids(next), ["b", "c", "a"]);
    assert.equal(next.activeID, "a");
});

test("只改目前分頁", () => {
    const next = patchActive(state(["a", "b"], "b"), { page: "tags" });
    assert.equal(next.tabs[0].page, "whiteboard");
    assert.equal(activeTab(next).page, "tags");
});

test("找已經開著的分頁時，全螢幕蓋住的白板不算", () => {
    const value: TabState = {
        tabs: [tab("a", { whiteboardID: "b1", fullscreenID: "n1" }), tab("b", { whiteboardID: "b2" })],
        activeID: "a",
    };
    assert.equal(tabShowingBoard(value, "b1"), undefined);
    assert.equal(tabShowingBoard(value, "b2")?.id, "b");
    assert.equal(tabShowingNote(value, "n1")?.id, "a");
});

test("刪除筆記時所有顯示它的分頁都回到底下的頁面", () => {
    const value: TabState = {
        tabs: [tab("a", { fullscreenID: "n1" }), tab("b", { fullscreenID: "n1" }), tab("c", { fullscreenID: "n2" })],
        activeID: "a",
    };
    assert.deepEqual(withoutNotes(value, ["n1"]).tabs.map((item) => item.fullscreenID), [null, null, "n2"]);
});

test("白板被刪除時分頁回到 Root，沒有變動時回傳同一個物件", () => {
    const value: TabState = { tabs: [tab("a", { whiteboardID: "gone" }), tab("b", { whiteboardID: "b1" })], activeID: "b" };
    const next = dropMissingBoards(value, ["root", "b1"], "root");
    assert.deepEqual(next.tabs.map((item) => item.whiteboardID), ["root", "b1"]);
    assert.equal(dropMissingBoards(next, ["root", "b1"], "root"), next);
});

test("白板分頁跟著 Rust 目前的白板，Library 分頁不動", () => {
    const board = state(["a"]);
    assert.equal(activeTab(followActiveBoard(board, "b1")).whiteboardID, "b1");
    const library = patchActive(board, { page: "cards" });
    assert.equal(followActiveBoard(library, "b1"), library);
});

test("還原分頁時內容不對就當作沒有", () => {
    assert.equal(parseTabs(null), null);
    assert.equal(parseTabs("不是 JSON"), null);
    assert.equal(parseTabs(JSON.stringify({ tabs: [], activeID: "a" })), null);
    assert.equal(parseTabs(JSON.stringify({ tabs: [{ id: "a" }], activeID: "a" })), null);
    assert.equal(parseTabs(JSON.stringify({ tabs: [tab("a", { page: "removed" as never })], activeID: "a" })), null);
});

test("還原分頁時目前分頁不見了就用第一個", () => {
    const saved = JSON.stringify({ tabs: [tab("a"), tab("b")], activeID: "x" });
    assert.equal(parseTabs(saved)?.activeID, "a");
});
