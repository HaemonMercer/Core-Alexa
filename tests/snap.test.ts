import assert from "node:assert/strict";
import { test } from "node:test";
import { boundsOf, findGuides, intersects, snapMove, snapResize } from "../src/components/canvas/snap.ts";

const other = { x: 100, y: 100, w: 200, h: 100 };

test("移動時靠近其他矩形的邊會吸附", () => {
    const moving = { x: 104, y: 400, w: 50, h: 50 };
    assert.deepEqual(snapMove(moving, [other], 1), { x: -4, y: 0 });
});

test("移動時中線也能互相對齊", () => {
    const moving = { x: 172, y: 400, w: 50, h: 50 };
    assert.deepEqual(snapMove(moving, [other], 1), { x: 3, y: 0 });
});

test("有多個候選時選最近的", () => {
    const near = { x: 106, y: 0, w: 10, h: 10 };
    const moving = { x: 104, y: 400, w: 50, h: 50 };
    assert.equal(snapMove(moving, [other, near], 1).x, 2);
    assert.equal(snapMove({ ...moving, x: 105 }, [other, near], 1).x, 1);
});

test("超出吸附距離時不移動", () => {
    assert.deepEqual(snapMove({ x: 120, y: 400, w: 50, h: 50 }, [other], 1), { x: 0, y: 0 });
});

test("吸附距離在螢幕上固定，不隨縮放改變", () => {
    const moving = { x: 110, y: 400, w: 50, h: 50 };
    assert.equal(snapMove(moving, [other], 0.5).x, -10);
    assert.equal(snapMove(moving, [other], 2).x, 0);
});

test("調整大小時只有被拖動的邊會吸附", () => {
    const resizing = { x: 0, y: 95, w: 298, h: 300 };
    assert.deepEqual(snapResize(resizing, "e", [other], 1), { x: 2, y: 0 });
    assert.deepEqual(snapResize(resizing, "n", [other], 1), { x: 0, y: 5 });
    assert.deepEqual(snapResize(resizing, "w", [other], 1), { x: 0, y: 0 });
});

test("參考線涵蓋兩個矩形的範圍", () => {
    const rect = { x: 100, y: 400, w: 50, h: 50 };
    assert.deepEqual(findGuides(rect, [other]), [{ axis: "x", at: 100, from: 100, to: 450 }]);
});

test("沒有對齊時不畫參考線", () => {
    assert.deepEqual(findGuides({ x: 101, y: 400, w: 50, h: 50 }, [other]), []);
});

test("同一條線上的多個矩形合併成一條參考線", () => {
    const rect = { x: 100, y: 400, w: 50, h: 50 };
    const above = { x: 100, y: 0, w: 30, h: 30 };
    assert.deepEqual(findGuides(rect, [other, above]), [{ axis: "x", at: 100, from: 0, to: 450 }]);
});

test("boundsOf 涵蓋所有矩形", () => {
    assert.deepEqual(boundsOf([other, { x: 0, y: 150, w: 50, h: 100 }]), { x: 0, y: 100, w: 300, h: 150 });
});

test("intersects 判斷矩形是否重疊", () => {
    assert.equal(intersects(other, { x: 290, y: 190, w: 50, h: 50 }), true);
    assert.equal(intersects(other, { x: 300, y: 100, w: 50, h: 50 }), false);
});
