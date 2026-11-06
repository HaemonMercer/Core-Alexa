import assert from "node:assert/strict";
import { test } from "node:test";
import {
    cardAroundMap,
    descendantCount,
    dropZone,
    edgePath,
    fitView,
    isInside,
    layoutMindmap,
    mapInCard,
    neighbour,
    nodeAtCardPoint,
    nodeLook,
    NODE_HEIGHT,
    revealNode,
    wrapLines,
} from "../src/components/mindmap/layout.ts";
import type { MindNode, MindSide } from "../src/types.ts";

const node = (id: string, parentId: string | null, side: MindSide | null = null, collapsed = false): MindNode => ({
    id,
    parentId,
    text: id,
    collapsed,
    side,
    color: parentId === "root" ? "#112233" : null,
    shape: null,
    orientation: null,
    lineStyle: null,
});
const measure = (text: string) => text.length * 10;

const TREE = [
    node("root", null),
    node("a", "root", "right"),
    node("a1", "a"),
    node("a2", "a"),
    node("b", "root", "right"),
    node("c", "root", "left"),
    node("c1", "c"),
];
const vertical = (nodes: MindNode[]) =>
    nodes.map((item) => (item.parentId === null ? { ...item, orientation: "vertical" as const } : item));
const at = (layout: ReturnType<typeof layoutMindmap>, id: string) => {
    const found = layout.nodes.find((item) => item.id === id);
    assert.ok(found);
    return found;
};
const centerX = (item: { x: number; w: number }) => item.x + item.w / 2;
const centerY = (item: { y: number; h: number }) => item.y + item.h / 2;

test("分支分在根節點兩側，子節點往外長", () => {
    const layout = layoutMindmap(TREE, measure);
    const root = at(layout, "root");
    assert.ok(at(layout, "a").x > root.x + root.w);
    assert.ok(at(layout, "a1").x > at(layout, "a").x + at(layout, "a").w);
    assert.ok(at(layout, "c").x + at(layout, "c").w < root.x);
    assert.ok(at(layout, "c1").x + at(layout, "c1").w < at(layout, "c").x);
    assert.ok(at(layout, "a2").y > at(layout, "a1").y);
});

test("沒有 side 的節點放右邊", () => {
    const layout = layoutMindmap([node("root", null), node("a", "root")], measure);
    assert.ok(at(layout, "a").x > at(layout, "root").x);
});

test("直向版面時分支在上下，同層左右排開", () => {
    const layout = layoutMindmap(vertical(TREE), measure);
    const root = at(layout, "root");
    assert.ok(at(layout, "a").y > root.y + root.h);
    assert.ok(at(layout, "c").y + at(layout, "c").h < root.y);
    assert.ok(at(layout, "a2").x > at(layout, "a1").x);
    assert.equal(at(layout, "a1").y, at(layout, "a2").y);
});

for (const [name, nodes] of [["橫向", TREE], ["直向", vertical(TREE)]] as const) {
    test(`${name}節點不重疊，畫布包住所有節點`, () => {
        const layout = layoutMindmap(nodes, measure);
        for (const a of layout.nodes) {
            assert.ok(a.x >= 0 && a.y >= 0);
            assert.ok(a.x + a.w <= layout.width);
            assert.ok(a.y + a.h <= layout.height);
            for (const b of layout.nodes) {
                if (a === b) continue;
                const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
                assert.ok(apart, `${a.id} 與 ${b.id} 重疊`);
            }
        }
    });
}

test("根節點的中心就是視圖原點", () => {
    const layout = layoutMindmap(TREE, measure);
    assert.equal(layout.rootX, centerX(at(layout, "root")));
    assert.equal(layout.rootY, centerY(at(layout, "root")));
});

test("父節點在子節點的垂直中間", () => {
    const layout = layoutMindmap(TREE, measure);
    assert.equal(centerY(at(layout, "a")), (centerY(at(layout, "a1")) + centerY(at(layout, "a2"))) / 2);
});

test("摺疊後看不到子孫，但知道藏了幾個", () => {
    const layout = layoutMindmap(
        [node("root", null), node("a", "root", "right", true), node("a1", "a"), node("a2", "a1")],
        measure,
    );
    assert.deepEqual(layout.nodes.map((item) => item.id), ["root", "a"]);
    assert.equal(at(layout, "a").childCount, 1);
    assert.equal(at(layout, "a").hiddenCount, 2);
    assert.equal(layout.edges.length, 1);
});

test("根節點的摺疊不影響顯示", () => {
    const layout = layoutMindmap([node("root", null, null, true), node("a", "root", "right")], measure);
    assert.equal(layout.nodes.length, 2);
});

test("顏色沿用父節點，自己指定的優先", () => {
    const layout = layoutMindmap(
        [node("root", null), node("a", "root", "right"), node("a1", "a"), { ...node("a2", "a"), color: "#445566" }],
        measure,
    );
    assert.equal(at(layout, "a1").branchColor, "#112233");
    assert.equal(at(layout, "a2").branchColor, "#445566");
});

test("預設根節點是膠囊，其他節點沒有外框", () => {
    const layout = layoutMindmap(TREE, measure);
    assert.equal(at(layout, "root").shapeKind, "pill");
    assert.equal(nodeLook(at(layout, "a")).border, "transparent");
    const shaped = layoutMindmap([node("root", null), { ...node("a", "root", "right"), shape: "rounded" }], measure);
    assert.equal(nodeLook(at(shaped, "a")).fill, "#1122332b");
    assert.equal(nodeLook(at(shaped, "a")).border, "#112233");
});

test("文字依換行符號與寬度折行，節點跟著變高", () => {
    assert.deepEqual(wrapLines("甲\n乙", measure, 100), ["甲", "乙"]);
    assert.deepEqual(wrapLines("甲乙丙丁", measure, 20), ["甲乙", "丙丁"]);
    assert.deepEqual(wrapLines("aaa bbb", measure, 50), ["aaa", "bbb"]);
    const layout = layoutMindmap(
        [node("root", null), { ...node("a", "root", "right"), text: "一\n二\n三" }, { ...node("b", "root", "right"), text: "x" }],
        measure,
    );
    assert.equal(at(layout, "a").h, at(layout, "b").h + 40);
    assert.equal(at(layout, "b").h, NODE_HEIGHT);
});

test("寬度有上下限", () => {
    const layout = layoutMindmap([{ ...node("root", null), text: "" }, { ...node("a", "root", "right"), text: "長".repeat(99) }], measure);
    assert.equal(at(layout, "a").w, 260);
    assert.ok(at(layout, "root").w >= 48);
});

test("連線從父節點外側接到子節點內側，左側分支反過來", () => {
    const layout = layoutMindmap(TREE, measure);
    const right = layout.edges.find(({ to }) => to.id === "a");
    const left = layout.edges.find(({ to }) => to.id === "c");
    assert.ok(right && left);
    assert.ok(edgePath(right, "curved").startsWith(`M ${right.from.x + right.from.w} `));
    assert.ok(edgePath(right, "curved").endsWith(`${right.to.x} ${centerY(right.to)}`));
    assert.ok(edgePath(left, "curved").startsWith(`M ${left.from.x} `));
    assert.ok(edgePath(left, "curved").endsWith(`${left.to.x + left.to.w} ${centerY(left.to)}`));
});

test("折線只有水平與垂直段", () => {
    const layout = layoutMindmap(TREE, measure);
    assert.match(edgePath(layout.edges[0], "elbow"), /^M \S+ \S+ H \S+ V \S+ H \S+$/);
    const down = layoutMindmap(vertical(TREE), measure);
    assert.match(edgePath(down.edges[0], "elbow"), /^M \S+ \S+ V \S+ H \S+ V \S+$/);
});

test("方向鍵依節點在哪一側移動", () => {
    const layout = layoutMindmap(TREE, measure);
    assert.equal(neighbour(layout, "root", "ArrowRight"), "a");
    assert.equal(neighbour(layout, "root", "ArrowLeft"), "c");
    assert.equal(neighbour(layout, "root", "ArrowUp"), null);
    assert.equal(neighbour(layout, "a", "ArrowRight"), "a1");
    assert.equal(neighbour(layout, "a", "ArrowLeft"), "root");
    assert.equal(neighbour(layout, "c", "ArrowLeft"), "c1");
    assert.equal(neighbour(layout, "c", "ArrowRight"), "root");
    assert.equal(neighbour(layout, "a1", "ArrowDown"), "a2");
    assert.equal(neighbour(layout, "a", "ArrowDown"), "b");
    assert.equal(neighbour(layout, "b", "ArrowDown"), null, "另一側的節點不算同層");
    assert.equal(neighbour(layout, "b", "ArrowRight"), null);
});

test("直向版面的方向鍵", () => {
    const layout = layoutMindmap(vertical(TREE), measure);
    assert.equal(neighbour(layout, "root", "ArrowDown"), "a");
    assert.equal(neighbour(layout, "root", "ArrowUp"), "c");
    assert.equal(neighbour(layout, "a", "ArrowUp"), "root");
    assert.equal(neighbour(layout, "a1", "ArrowRight"), "a2");
});

test("符合畫面時整張圖都看得到，也不會放大超過原尺寸", () => {
    const layout = layoutMindmap(TREE, measure);
    const small = fitView(layout, layout.width / 2, layout.height / 2);
    assert.equal(small.scale, 0.5);
    assert.ok((0 - layout.rootX) * small.scale + small.x >= -0.001);
    assert.equal(fitView(layout, layout.width * 3, layout.height * 3).scale, 1);
});

test("平移到看得見節點，看得見時不動", () => {
    const layout = layoutMindmap(TREE, measure);
    const a1 = at(layout, "a1");
    const view = fitView(layout, layout.width, layout.height);
    assert.equal(revealNode(view, layout, at(layout, "root"), layout.width, layout.height), view);
    const away = { ...view, x: view.x - 10000 };
    const shown = revealNode(away, layout, a1, layout.width, layout.height);
    assert.ok((a1.x - layout.rootX) * shown.scale + shown.x >= 0);
    assert.equal(shown.y, away.y);
});

test("放開的位置決定排序或當子節點", () => {
    assert.equal(dropZone(false, 2, 36), "before");
    assert.equal(dropZone(false, 18, 36), "child");
    assert.equal(dropZone(false, 34, 36), "after");
    assert.equal(dropZone(true, 2, 36), "child");
});

test("子孫數量與祖先判斷", () => {
    assert.equal(descendantCount(TREE, "a"), 2);
    assert.equal(descendantCount(TREE, "b"), 0);
    assert.equal(isInside(TREE, "a", "a2"), true);
    assert.equal(isInside(TREE, "a", "a"), true);
    assert.equal(isInside(TREE, "a", "b"), false);
});

const SIZE = { width: 400, height: 200, rootX: 150, rootY: 100 };

test("心智圖在卡片裡置中，大卡片不放大", () => {
    const place = mapInCard({ x: 0, y: 0, w: 800, h: 600 }, SIZE);
    assert.deepEqual(place, { scale: 1, rootX: 350, rootY: 300 });
});

test("小卡片縮小後，就地編輯和畫布上的圖對齊", () => {
    const card = { x: 10, y: 20, w: 200, h: 100 };
    const { scale, rootX, rootY } = mapInCard(card, SIZE);
    assert.equal(scale, 0.5);
    assert.deepEqual(cardAroundMap(rootX, rootY, scale, SIZE), card);
});

test("分支長大時根節點不動，卡片往那一側長", () => {
    const grown = { width: 500, height: 200, rootX: 250, rootY: 100 };
    const rect = cardAroundMap(350, 300, 1, grown);
    assert.equal(rect.x + grown.rootX, 350);
    assert.equal(rect.w, 500);
});

test("在卡片上點到的節點", () => {
    const layout = layoutMindmap(TREE, measure);
    const a = at(layout, "a");
    const card = { x: 100, y: 50, w: layout.width / 2, h: layout.height };
    const scale = card.w / layout.width;
    const top = card.y + (card.h - layout.height * scale) / 2;
    const x = card.x + centerX(a) * scale;
    assert.equal(nodeAtCardPoint(layout, card, x, top + centerY(a) * scale), "a");
    assert.equal(nodeAtCardPoint(layout, card, card.x + 1, card.y + 1), null);
});
