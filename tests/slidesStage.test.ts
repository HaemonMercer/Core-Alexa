import assert from "node:assert/strict";
import { test } from "node:test";
import { fitScale, MIN_ELEMENT, resizeRect, snapToCenter, STAGE_HEIGHT, STAGE_WIDTH } from "../src/components/slides/stage.ts";

const rect = { x: 100, y: 100, w: 200, h: 100 };

test("投影片縮放不變形，以較窄的一邊為準", () => {
    assert.equal(fitScale(STAGE_WIDTH / 2, STAGE_HEIGHT), 0.5);
    assert.equal(fitScale(STAGE_WIDTH, STAGE_HEIGHT / 4), 0.25);
});

test("容器沒有尺寸時比例仍是正數", () => {
    assert.ok(fitScale(0, 0) > 0);
});

test("拖右下角只改寬高", () => {
    assert.deepEqual(resizeRect(rect, "se", 30, 20), { x: 100, y: 100, w: 230, h: 120 });
});

test("拖左上角時右下角固定", () => {
    assert.deepEqual(resizeRect(rect, "nw", 30, 20), { x: 130, y: 120, w: 170, h: 80 });
});

test("拖過頭時停在最小尺寸，另一側不動", () => {
    const next = resizeRect(rect, "w", 1000, 0);
    assert.equal(next.w, MIN_ELEMENT);
    assert.equal(next.x + next.w, rect.x + rect.w);
});

test("單邊控制點不影響另一個方向", () => {
    assert.deepEqual(resizeRect(rect, "e", 10, 99), { x: 100, y: 100, w: 210, h: 100 });
});

test("靠近中線才吸附", () => {
    const near = { x: (STAGE_WIDTH - 200) / 2 + 3, y: 0, w: 200, h: 100 };
    assert.equal(snapToCenter(near, 5).x, (STAGE_WIDTH - 200) / 2);
    assert.equal(snapToCenter(near, 2).x, near.x);
    assert.equal(snapToCenter(near, 5).y, 0);
});
