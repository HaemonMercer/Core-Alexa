import assert from "node:assert/strict";
import { test } from "node:test";
import { gridStep, toScreen, toWorld, visibleWorld, zoomAt } from "../src/components/canvas/viewport.ts";

const view = { x: 40, y: -20, scale: 2 };

test("世界座標與螢幕座標互相換算", () => {
    assert.deepEqual(toWorld(view, 140, 80), { x: 50, y: 50 });
    assert.deepEqual(toScreen(view, 50, 50), { x: 140, y: 80 });
});

test("visibleWorld 是畫布在世界座標中的範圍", () => {
    assert.deepEqual(visibleWorld(view, 200, 100), { x: -20, y: 10, w: 100, h: 50 });
});

test("縮放時滑鼠下方的世界座標不變", () => {
    const zoomed = zoomAt(view, 300, 200, true);
    const before = toWorld(view, 300, 200);
    const after = toWorld(zoomed, 300, 200);
    assert.ok(Math.abs(before.x - after.x) < 1e-9);
    assert.ok(Math.abs(before.y - after.y) < 1e-9);
    assert.ok(zoomed.scale > view.scale);
});

test("縮放有上下限", () => {
    assert.equal(zoomAt({ x: 0, y: 0, scale: 10 }, 0, 0, true).scale, 10);
    assert.equal(zoomAt({ x: 0, y: 0, scale: 0.1 }, 0, 0, false).scale, 0.1);
});

test("格線間距維持在 12 到 48 之間", () => {
    assert.equal(gridStep(24, 1), 24);
    assert.equal(gridStep(25, 0.1), 20);
    assert.equal(gridStep(24, 10), 30);
});
