import assert from "node:assert/strict";
import { test } from "node:test";
import { arrowSegments, marqueeRect, noteAt, previewNotes } from "../src/components/canvas/gestures.ts";
import type { Arrow, PlacedNote } from "../src/types.ts";

function placed(id: string, x: number, y: number): PlacedNote {
    return {
        id,
        whiteboardID: "b",
        noteID: `note-${id}`,
        x,
        y,
        w: 100,
        h: 100,
        zKey: "a0",
        style: {},
        minSize: { w: 80, h: 48 },
    };
}

const drag = (ids: string[], dx: number, dy: number) => ({
    ids: new Set(ids),
    clickedID: ids[0],
    dx,
    dy,
    snap: { x: 1, y: 2 },
    moved: true,
    onTileTitle: false,
    reclickedCard: false,
});

test("拖曳預覽只移動被拖的筆記，並加上吸附量", () => {
    const [a, b] = previewNotes([placed("a", 0, 0), placed("b", 300, 0)], drag(["a"], 10, 20), null);
    assert.deepEqual([a.x, a.y], [11, 22]);
    assert.deepEqual([b.x, b.y], [300, 0]);
});

test("縮放預覽優先於拖曳預覽", () => {
    const start = placed("a", 0, 0);
    const rect = { x: 5, y: 6, w: 7, h: 8 };
    const [a] = previewNotes([start], drag(["a"], 10, 20), { id: "a", handle: "se", start, rect, dx: 0, dy: 0 });
    assert.deepEqual([a.x, a.y, a.w, a.h], [5, 6, 7, 8]);
});

test("重疊時點到最上層的筆記", () => {
    const notes = [placed("a", 0, 0), placed("b", 50, 50)];
    assert.equal(noteAt(notes, 75, 75)?.id, "b");
    assert.equal(noteAt(notes, 10, 10)?.id, "a");
    assert.equal(noteAt(notes, 500, 500), null);
});

test("箭頭缺少一端時不畫", () => {
    const arrow = (id: string, to: string): Arrow => ({
        id,
        fromPlacedID: "a",
        toPlacedID: to,
        direction: "forward",
        label: "",
    });
    const notes = [placed("a", 0, 0), placed("b", 300, 0)];
    const found = arrowSegments([arrow("kept", "b"), arrow("gone", "missing")], notes);
    assert.deepEqual(found.map((item) => item.arrow.id), ["kept"]);
});

test("框選範圍不受拖曳方向影響", () => {
    assert.deepEqual(
        marqueeRect({ base: new Set(), x0: 30, y0: 40, x1: 10, y1: 5 }),
        { x: 10, y: 5, w: 20, h: 35 },
    );
});
