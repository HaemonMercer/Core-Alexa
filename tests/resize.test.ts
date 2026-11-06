import assert from "node:assert/strict";
import { test } from "node:test";
import {
    hitResizeHandle,
    keepRatio,
    resizeCursor,
    resizeRect,
    widthOnlyHandle,
    type ResizeHandle,
} from "../src/components/canvas/resize.ts";

const rect = { x: 100, y: 100, w: 200, h: 150 };
const min = { w: 80, h: 48 };

test("只能拖寬度時，四角當成左右邊，上下邊不算控制點", () => {
    assert.equal(widthOnlyHandle("ne"), "e");
    assert.equal(widthOnlyHandle("se"), "e");
    assert.equal(widthOnlyHandle("nw"), "w");
    assert.equal(widthOnlyHandle("sw"), "w");
    assert.equal(widthOnlyHandle("e"), "e");
    assert.equal(widthOnlyHandle("n"), null);
    assert.equal(widthOnlyHandle("s"), null);
    assert.equal(widthOnlyHandle(null), null);
});

test("拖曳四邊只改變該邊", () => {
    assert.deepEqual(resizeRect(rect, "e", 30, 99, min), { x: 100, y: 100, w: 230, h: 150 });
    assert.deepEqual(resizeRect(rect, "s", 99, 30, min), { x: 100, y: 100, w: 200, h: 180 });
    assert.deepEqual(resizeRect(rect, "w", 30, 99, min), { x: 130, y: 100, w: 170, h: 150 });
    assert.deepEqual(resizeRect(rect, "n", 99, 30, min), { x: 100, y: 130, w: 200, h: 120 });
});

test("拖曳四角同時改變兩邊", () => {
    assert.deepEqual(resizeRect(rect, "se", 10, 20, min), { x: 100, y: 100, w: 210, h: 170 });
    assert.deepEqual(resizeRect(rect, "nw", 10, 20, min), { x: 110, y: 120, w: 190, h: 130 });
    assert.deepEqual(resizeRect(rect, "ne", 10, 20, min), { x: 100, y: 120, w: 210, h: 130 });
    assert.deepEqual(resizeRect(rect, "sw", 10, 20, min), { x: 110, y: 100, w: 190, h: 170 });
});

test("到達最小尺寸後對邊仍固定不動", () => {
    const shrunk = resizeRect(rect, "nw", 1000, 1000, min);
    assert.deepEqual(shrunk, { x: 220, y: 202, w: 80, h: 48 });
    assert.equal(shrunk.x + shrunk.w, rect.x + rect.w);
    assert.equal(shrunk.y + shrunk.h, rect.y + rect.h);
});

test("碰到控制點時回傳對應方位", () => {
    const at: [number, number, ResizeHandle | null][] = [
        [100, 100, "nw"],
        [300, 100, "ne"],
        [100, 250, "sw"],
        [300, 250, "se"],
        [200, 100, "n"],
        [200, 250, "s"],
        [100, 175, "w"],
        [300, 175, "e"],
        [96, 96, "nw"],
        [200, 175, null],
        [50, 50, null],
    ];
    for (const [x, y, handle] of at) assert.equal(hitResizeHandle(rect, x, y, 1), handle, `${x},${y}`);
});

test("控制點的感應範圍在螢幕上固定，不隨縮放改變", () => {
    assert.equal(hitResizeHandle(rect, 90, 175, 0.5), "w");
    assert.equal(hitResizeHandle(rect, 90, 175, 2), null);
});

test("縮得很小時中間仍保留可拖曳移動的範圍", () => {
    const small = { x: 0, y: 0, w: 80, h: 48 };
    assert.equal(hitResizeHandle(small, 40, 24, 0.1), null);
});

test("每個方位都有對應的游標", () => {
    assert.equal(resizeCursor("n"), "ns-resize");
    assert.equal(resizeCursor("ne"), "nesw-resize");
    assert.equal(resizeCursor("se"), "nwse-resize");
});

test("拖右下角維持比例，左上角不動", () => {
    const start = { x: 10, y: 20, w: 200, h: 100 };
    assert.deepEqual(keepRatio(start, "se", { ...start, w: 300, h: 110 }, 2, { w: 80, h: 48 }), { x: 10, y: 20, w: 300, h: 150 });
});

test("拖左上角時右下角不動", () => {
    const start = { x: 100, y: 100, w: 200, h: 100 };
    const rect = keepRatio(start, "nw", { x: 0, y: 100, w: 300, h: 100 }, 2, { w: 80, h: 48 });
    assert.equal(rect.x + rect.w, 300);
    assert.equal(rect.y + rect.h, 200);
    assert.equal(rect.w / rect.h, 2);
});

test("拖上下邊時高度帶動寬度", () => {
    const start = { x: 0, y: 0, w: 200, h: 100 };
    assert.deepEqual(keepRatio(start, "s", { ...start, h: 150 }, 2, { w: 80, h: 48 }), { x: 0, y: 0, w: 300, h: 150 });
});

test("縮到下限時兩邊都不低於下限，比例不變", () => {
    const start = { x: 0, y: 0, w: 200, h: 100 };
    const rect = keepRatio(start, "e", { ...start, w: 10 }, 2, { w: 80, h: 48 });
    assert.equal(rect.h, 48);
    assert.equal(rect.w, 96);
});
