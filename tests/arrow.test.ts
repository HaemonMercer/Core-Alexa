import assert from "node:assert/strict";
import { test } from "node:test";
import {
    borderPoint,
    connect,
    connectorPoints,
    distanceToSegment,
    hitConnector,
    hitsSegment,
    midpoint,
    nearConnectors,
} from "../src/components/canvas/arrow.ts";
import { hitResizeHandle } from "../src/components/canvas/resize.ts";

const left = { x: 0, y: 0, w: 100, h: 100 };
const right = { x: 300, y: 0, w: 100, h: 100 };

test("線從邊框連到邊框，不穿過筆記", () => {
    assert.deepEqual(connect(left, right), { from: { x: 100, y: 50 }, to: { x: 300, y: 50 } });
});

test("斜向的線停在第一個碰到的邊", () => {
    const point = borderPoint(left, { x: 150, y: 250 });
    assert.equal(point.y, 100);
    assert.equal(point.x, 75);
});

test("重疊的筆記之間沒有線", () => {
    assert.equal(connect(left, { x: 50, y: 50, w: 100, h: 100 }), null);
});

test("目標就在中心時不會除以零", () => {
    assert.deepEqual(borderPoint(left, { x: 50, y: 50 }), { x: 50, y: 50 });
});

test("點到線段的距離以線段兩端為界", () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    assert.equal(distanceToSegment({ x: 50, y: 10 }, segment), 10);
    assert.equal(distanceToSegment({ x: 130, y: 40 }, segment), 50);
    assert.equal(distanceToSegment({ x: 3, y: 4 }, { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }), 5);
});

test("點選線段的範圍在螢幕上固定", () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };
    assert.equal(hitsSegment({ x: 50, y: 5 }, segment, 1), true);
    assert.equal(hitsSegment({ x: 50, y: 5 }, segment, 2), false);
    assert.equal(hitsSegment({ x: 50, y: 10 }, segment, 0.5), true);
});

test("線段中點在兩端正中間", () => {
    assert.deepEqual(midpoint({ from: { x: 0, y: 10 }, to: { x: 100, y: 30 } }), { x: 50, y: 20 });
});

test("連接點不會和調整大小的控制點重疊", () => {
    for (const scale of [0.25, 1, 4]) {
        for (const dot of connectorPoints(left, scale)) {
            assert.equal(hitResizeHandle(left, dot.x, dot.y, scale), null);
            assert.equal(hitConnector(left, dot, scale), true);
        }
    }
});

test("移向連接點的路上不會離開判定範圍", () => {
    assert.equal(nearConnectors(left, { x: 50, y: -10 }, 1), true);
    assert.equal(nearConnectors(left, { x: 50, y: -40 }, 1), false);
});
