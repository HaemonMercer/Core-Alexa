import assert from "node:assert/strict";
import { test } from "node:test";
import { NotePreviews, type PreviewImage } from "../src/components/canvas/notePreview.ts";
import { deleteLabel, formatDuration, noteTitle, noteTypeLabel } from "../src/noteTypes.ts";
import type { Note } from "../src/types.ts";

const note = (id: string, content: string, type = "mermaid"): Note =>
    ({ id, type, context: {}, content, updatedAt: 0, createdAt: 0 });

const image = (name: string) => {
    const result = { name, closed: false, close() { this.closed = true; } };
    return result as unknown as PreviewImage & { name: string; closed: boolean };
};

/** 手動控制每次渲染何時完成。 */
function harness(limit?: number) {
    const calls: { content: string; finish: (result: PreviewImage | null) => void; fail: () => void }[] = [];
    let ready = 0;
    const previews = new NotePreviews({
        mermaid: {
            version: (target) => target.content,
            render: (target) => new Promise((resolve, reject) => {
                calls.push({ content: target.content, finish: resolve, fail: () => reject(new Error("語法錯誤")) });
            }),
        },
    }, () => { ready += 1; }, limit);
    return { previews, calls, ready: () => ready };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("沒有渲染器的類型沒有預覽", () => {
    const { previews, calls } = harness();
    assert.equal(previews.get(note("a", "x", "card")), null);
    assert.equal(calls.length, 0);
});

test("內容沒變時不重新渲染", async () => {
    const { previews, calls, ready } = harness();
    assert.equal(previews.get(note("a", "x")), null);
    previews.get(note("a", "x"));
    assert.equal(calls.length, 1);

    const first = image("第一張");
    calls[0].finish(first);
    await settle();
    assert.equal(ready(), 1);
    assert.equal(previews.get(note("a", "x")), first);
    assert.equal(calls.length, 1);
});

test("內容改變後，新圖好之前留著舊圖，好了才釋放", async () => {
    const { previews, calls } = harness();
    previews.get(note("a", "舊"));
    const old = image("舊");
    calls[0].finish(old);
    await settle();

    assert.equal(previews.get(note("a", "新")), old);
    const next = image("新");
    calls[1].finish(next);
    await settle();
    assert.equal(previews.get(note("a", "新")), next);
    assert.equal(old.closed, true);
});

test("渲染失敗時留著上一張正確的圖，也不會每次重畫都重試", async () => {
    const { previews, calls } = harness();
    previews.get(note("a", "好"));
    const good = image("好");
    calls[0].finish(good);
    await settle();

    previews.get(note("a", "寫到一半"));
    calls[1].fail();
    await settle();
    assert.equal(previews.get(note("a", "寫到一半")), good);
    assert.equal(calls.length, 2);
});

test("內容清空時回到佔位框並釋放舊圖", async () => {
    const { previews, calls } = harness();
    previews.get(note("a", "有內容"));
    const old = image("舊");
    calls[0].finish(old);
    await settle();

    previews.get(note("a", ""));
    calls[1].finish(null);
    await settle();
    assert.equal(previews.get(note("a", "")), null);
    assert.equal(old.closed, true);
});

test("過期的渲染結果會被丟棄", async () => {
    const { previews, calls } = harness();
    previews.get(note("a", "一"));
    previews.get(note("a", "二"));
    const stale = image("一");
    const fresh = image("二");
    calls[1].finish(fresh);
    await settle();
    calls[0].finish(stale);
    await settle();

    assert.equal(previews.get(note("a", "二")), fresh);
    assert.equal(stale.closed, true);
});

test("超過上限時淘汰最久沒用到的預覽", async () => {
    const { previews, calls } = harness(2);
    previews.get(note("a", "x"));
    previews.get(note("b", "x"));
    const a = image("a");
    calls[0].finish(a);
    calls[1].finish(image("b"));
    await settle();

    previews.get(note("a", "x"));
    previews.get(note("c", "x"));
    assert.equal(previews.get(note("a", "x")), a);
    assert.equal(calls.filter(({ content }) => content === "x").length, 3);
    previews.get(note("b", "x"));
    assert.equal(calls.length, 4);
});

test("影片長度的顯示", () => {
    assert.equal(formatDuration(0), "0:00");
    assert.equal(formatDuration(65.4), "1:05");
    assert.equal(formatDuration(3723), "1:02:03");
});

test("類型名稱與刪除文字", () => {
    assert.equal(noteTypeLabel("drawio"), "Draw.io");
    assert.equal(noteTypeLabel("未來的類型"), "未來的類型");
    assert.equal(noteTitle(note("a", "# 標題", "card")), "標題");
    assert.equal(noteTitle(note("a", "graph TD")), "Mermaid");
    assert.equal(noteTitle({ ...note("a", "", "image"), context: { name: "貓.png" } }), "貓.png");
    assert.equal(noteTitle(note("a", "", "image")), "圖片");
    assert.equal(noteTitle(note("a", "專案規劃", "mindmap")), "專案規劃");
    assert.equal(deleteLabel([note("a", "")]), "刪除Mermaid");
    assert.equal(deleteLabel([note("a", "", "card"), note("b", "", "card")]), "刪除 2 張卡片");
    assert.equal(deleteLabel([note("a", "", "card"), note("b", "")]), "刪除 2 個項目");
});
