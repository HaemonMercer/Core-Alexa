import type { MindLineStyle, MindNode, MindOrientation, MindShape } from "../../types.ts";
import type { View } from "../canvas/viewport.ts";

// 心智圖的版面：根節點在中央，分支往兩側展開，直向時是上下兩側。
// 只負責算位置，畫布縮圖與編輯器共用同一份結果。節點的順序與父子關係由 Rust 決定，這裡直接照著清單排。

const FONT_FAMILY = '"Segoe UI", "Microsoft JhengHei", sans-serif';
export const NODE_FONT = `14px ${FONT_FAMILY}`;
export const ROOT_FONT = `600 18px ${FONT_FAMILY}`;
const LINE_HEIGHT = 20;
const ROOT_LINE_HEIGHT = 24;
/** 只有一行文字的節點高度。 */
export const NODE_HEIGHT = 28;
/** 文字換行前的寬度上限。 */
const MAX_TEXT_WIDTH = 240;
const MIN_NODE_WIDTH = 48;
/** 邊框與文字框的捲動誤差，輸入框才不會比顯示時早換行。 */
const WIDTH_SLACK = 4;
const LEVEL_GAP = 56;
const SIBLING_GAP = 8;
const VERTICAL_SIBLING_GAP = 24;
const MARGIN = 32;
const VIEW_MARGIN = 24;
const MIN_FIT_SCALE = 0.25;
const DEFAULT_ROOT_COLOR = "#7b3ff2";
/** 有形狀的節點用分支顏色的淡色填滿，文字維持深色。 */
const FILL_ALPHA = "2b";
const ROUNDED_RADIUS = 10;

export type MindDirection = "left" | "right" | "top" | "bottom";

export interface PlacedMindNode extends MindNode {
    x: number;
    y: number;
    w: number;
    h: number;
    depth: number;
    /** 直接的子節點數。摺疊時畫面上看不到它們，但數量還在。 */
    childCount: number;
    /** 摺疊時藏起來的節點數，包含更深的。 */
    hiddenCount: number;
    /** 往外長的方向。根節點兩側都能長，所以是 null。 */
    out: MindDirection | null;
    lines: string[];
    font: string;
    lineHeight: number;
    paddingX: number;
    paddingY: number;
    branchColor: string;
    shapeKind: MindShape;
}

export interface MindEdge {
    from: PlacedMindNode;
    to: PlacedMindNode;
}

export interface MindLayout {
    nodes: PlacedMindNode[];
    edges: MindEdge[];
    width: number;
    height: number;
    orientation: MindOrientation;
    lineStyle: MindLineStyle;
    /** 根節點的中心。編輯器以它為視圖的原點，分支長大時根節點才不會跑掉。 */
    rootX: number;
    rootY: number;
}

export type Measure = (text: string, font: string) => number;

type NodeSize = Pick<PlacedMindNode, "w" | "h" | "lines" | "font" | "lineHeight" | "paddingX" | "paddingY" | "shapeKind">;

/** 依寬度折行。西文優先斷在空白，中文哪裡都能斷。 */
export function wrapLines(text: string, measure: (text: string) => number, maxWidth: number) {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        if (measure(paragraph) <= maxWidth) {
            lines.push(paragraph);
            continue;
        }
        let line = "";
        for (const char of paragraph) {
            if (!line || measure(line + char) <= maxWidth) {
                line += char;
                continue;
            }
            const space = line.lastIndexOf(" ");
            if (space > 0 && char !== " ") {
                lines.push(line.slice(0, space));
                line = line.slice(space + 1) + char;
            } else {
                lines.push(line);
                line = char;
            }
        }
        lines.push(line);
    }
    return lines;
}

function sizeOf(node: MindNode, measure: Measure): NodeSize {
    const root = node.parentId === null;
    const shapeKind = node.shape ?? (root ? "pill" : "none");
    const font = root ? ROOT_FONT : NODE_FONT;
    const lineHeight = root ? ROOT_LINE_HEIGHT : LINE_HEIGHT;
    const paddingX = root ? 28 : shapeKind === "none" ? 8 : 14;
    const paddingY = root ? 12 : shapeKind === "none" ? 4 : 8;
    const lines = wrapLines(node.text, (text) => measure(text, font), MAX_TEXT_WIDTH);
    const textWidth = Math.ceil(Math.max(...lines.map((line) => measure(line, font))));
    return {
        w: Math.max(MIN_NODE_WIDTH, textWidth + paddingX * 2 + WIDTH_SLACK),
        h: lines.length * lineHeight + paddingY * 2,
        lines,
        font,
        lineHeight,
        paddingX,
        paddingY,
        shapeKind,
    };
}

export function layoutMindmap(nodes: MindNode[], measure: Measure): MindLayout {
    const root = nodes.find((node) => node.parentId === null);
    const orientation: MindOrientation = root?.orientation ?? "horizontal";
    const lineStyle: MindLineStyle = root?.lineStyle ?? "curved";
    const empty = { nodes: [], edges: [], width: 0, height: 0, orientation, lineStyle, rootX: 0, rootY: 0 };
    if (!root) return empty;

    const horizontal = orientation === "horizontal";
    const siblingGap = horizontal ? SIBLING_GAP : VERTICAL_SIBLING_GAP;
    const children = new Map<string, MindNode[]>();
    for (const node of nodes) {
        if (node.parentId === null) continue;
        children.set(node.parentId, [...(children.get(node.parentId) ?? []), node]);
    }
    const visibleChildren = (node: MindNode) => (node.collapsed ? [] : children.get(node.id) ?? []);

    const sizes = new Map(nodes.map((node) => [node.id, sizeOf(node, measure)]));
    const size = (node: MindNode) => sizes.get(node.id) as NodeSize;
    const along = (item: NodeSize) => (horizontal ? item.w : item.h);
    const across = (item: NodeSize) => (horizontal ? item.h : item.w);

    // 橫向時是子樹佔的高度，直向時是寬度。
    const extents = new Map<string, number>();
    const totalOf = (kids: MindNode[]) => kids.reduce((sum, kid) => sum + extentOf(kid) + siblingGap, -siblingGap);
    function extentOf(node: MindNode): number {
        const kids = visibleChildren(node);
        const extent = Math.max(across(size(node)), kids.length > 0 ? totalOf(kids) : 0);
        extents.set(node.id, extent);
        return extent;
    }

    const placed: PlacedMindNode[] = [];
    const edges: MindEdge[] = [];
    const placeAt = (
        node: MindNode,
        x: number,
        y: number,
        depth: number,
        parent: PlacedMindNode | null,
        out: MindDirection | null,
    ) => {
        const self: PlacedMindNode = {
            ...node,
            ...size(node),
            x,
            y,
            depth,
            childCount: children.get(node.id)?.length ?? 0,
            hiddenCount: node.collapsed ? descendantCount(nodes, node.id) : 0,
            out,
            branchColor: node.color ?? parent?.branchColor ?? DEFAULT_ROOT_COLOR,
        };
        placed.push(self);
        if (parent) edges.push({ from: parent, to: self });
        return self;
    };

    /** `main` 是節點內側到根節點中心的距離，`start` 是子樹在另一軸的起點。 */
    const placeBranch = (
        node: MindNode,
        main: number,
        start: number,
        forward: boolean,
        depth: number,
        parent: PlacedMindNode,
        out: MindDirection,
    ) => {
        const item = size(node);
        const center = start + (extents.get(node.id) ?? across(item)) / 2;
        const near = forward ? main : -main - along(item);
        const far = center - across(item) / 2;
        const self = placeAt(node, horizontal ? near : far, horizontal ? far : near, depth, parent, out);

        const kids = visibleChildren(node);
        let kidStart = center - totalOf(kids) / 2;
        for (const kid of kids) {
            placeBranch(kid, main + along(item) + LEVEL_GAP, kidStart, forward, depth + 1, self, out);
            kidStart += (extents.get(kid.id) ?? 0) + siblingGap;
        }
    };

    const rootSize = size(root);
    const self = placeAt(root, -rootSize.w / 2, -rootSize.h / 2, 0, null, null);
    // 根節點的摺疊沒有按鈕可以展開，舊資料若是摺疊的也照常顯示。
    const branches = children.get(root.id) ?? [];
    for (const forward of [true, false]) {
        const kids = branches.filter((kid) => (kid.side === "left") !== forward);
        for (const kid of kids) extentOf(kid);
        const out: MindDirection = horizontal ? (forward ? "right" : "left") : forward ? "bottom" : "top";
        let start = -totalOf(kids) / 2;
        for (const kid of kids) {
            placeBranch(kid, along(rootSize) / 2 + LEVEL_GAP, start, forward, 1, self, out);
            start += (extents.get(kid.id) ?? 0) + siblingGap;
        }
    }

    const left = Math.min(...placed.map((node) => node.x));
    const top = Math.min(...placed.map((node) => node.y));
    for (const node of placed) {
        node.x += MARGIN - left;
        node.y += MARGIN - top;
    }
    return {
        nodes: placed,
        edges,
        width: Math.max(...placed.map((node) => node.x + node.w)) + MARGIN,
        height: Math.max(...placed.map((node) => node.y + node.h)) + MARGIN,
        orientation,
        lineStyle,
        rootX: MARGIN - left,
        rootY: MARGIN - top,
    };
}

/** 節點邊緣往 `out` 方向 `distance` 的點。 */
export function edgePoint(node: PlacedMindNode, out: MindDirection, distance = 0) {
    switch (out) {
        case "left":
            return { x: node.x - distance, y: node.y + node.h / 2 };
        case "right":
            return { x: node.x + node.w + distance, y: node.y + node.h / 2 };
        case "top":
            return { x: node.x + node.w / 2, y: node.y - distance };
        default:
            return { x: node.x + node.w / 2, y: node.y + node.h + distance };
    }
}

const OPPOSITE: Record<MindDirection, MindDirection> = { left: "right", right: "left", top: "bottom", bottom: "top" };

/** 連線的 SVG 路徑。Canvas 的 `Path2D` 也吃同一個字串，兩邊畫出來才會一樣。 */
export function edgePath({ from, to }: MindEdge, lineStyle: MindLineStyle) {
    const out = to.out ?? "right";
    const start = edgePoint(from, out);
    const end = edgePoint(to, OPPOSITE[out]);
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2;
    const sideways = out === "left" || out === "right";
    if (lineStyle === "elbow") {
        return sideways
            ? `M ${start.x} ${start.y} H ${middleX} V ${end.y} H ${end.x}`
            : `M ${start.x} ${start.y} V ${middleY} H ${end.x} V ${end.y}`;
    }
    return sideways
        ? `M ${start.x} ${start.y} C ${middleX} ${start.y} ${middleX} ${end.y} ${end.x} ${end.y}`
        : `M ${start.x} ${start.y} C ${start.x} ${middleY} ${end.x} ${middleY} ${end.x} ${end.y}`;
}

/** 節點的外框與填滿。App.css 不寫這些，編輯器與縮圖都從這裡拿。 */
export function nodeLook(node: PlacedMindNode) {
    if (node.shapeKind === "none") return { fill: "transparent", border: "transparent", radius: 4 };
    const radius = node.shapeKind === "pill" ? node.h / 2 : node.shapeKind === "rounded" ? ROUNDED_RADIUS : 0;
    return {
        fill: node.depth === 0 ? "#ffffff" : `${node.branchColor}${FILL_ALPHA}`,
        border: node.branchColor,
        radius,
    };
}

/** 方向鍵要移到的節點，沒有可去的地方時回傳 null。往外走到子節點，往內回父節點，另一軸在同側的同層間移動。 */
export function neighbour(layout: MindLayout, id: string, key: string): string | null {
    const current = layout.nodes.find((node) => node.id === id);
    if (!current) return null;
    const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom" } as const)[key];
    if (!direction) return null;
    const kids = layout.nodes.filter((node) => node.parentId === id);

    if (current.out === null) return kids.find((node) => node.out === direction)?.id ?? null;
    if (direction === current.out) return kids[0]?.id ?? null;
    if (direction === OPPOSITE[current.out]) return current.parentId;

    const siblings = layout.nodes.filter((node) => node.parentId === current.parentId && node.out === current.out);
    const index = siblings.indexOf(current);
    const earlier = direction === "top" || direction === "left";
    return siblings[index + (earlier ? -1 : 1)]?.id ?? null;
}

export type DropZone = "before" | "child" | "after";

/** 放開在節點上的哪個位置：前緣、後緣是排到同層，中間是當子節點。根節點沒有同層。 */
export function dropZone(isRoot: boolean, offset: number, size: number): DropZone {
    if (isRoot) return "child";
    if (offset < size / 4) return "before";
    return offset > (size * 3) / 4 ? "after" : "child";
}

/** 刪除前要提醒的節點數：包含摺疊著看不到的。 */
export function descendantCount(nodes: MindNode[], id: string) {
    const found = new Set([id]);
    for (const node of nodes) {
        if (node.parentId !== null && found.has(node.parentId)) found.add(node.id);
    }
    return found.size - 1;
}

/** 拖曳時不能放到自己或自己底下。 */
export function isInside(nodes: MindNode[], ancestor: string, id: string) {
    if (ancestor === id) return true;
    const parent = new Map(nodes.map((node) => [node.id, node.parentId]));
    for (let current = parent.get(id); current; current = parent.get(current)) {
        if (current === ancestor) return true;
    }
    return false;
}

/** 整張圖放進可視範圍。視圖的原點是根節點，所以回傳的 x、y 是根節點在螢幕上的位置。不放大超過 1。 */
export function fitView(layout: MindLayout, width: number, height: number): View {
    const scale = Math.max(MIN_FIT_SCALE, Math.min(1, width / layout.width, height / layout.height));
    return {
        x: width / 2 + (layout.rootX - layout.width / 2) * scale,
        y: height / 2 + (layout.rootY - layout.height / 2) * scale,
        scale,
    };
}

/** 把 `start` 到 `end` 這段拉進 `size` 以內要移動多少，已經在裡面就是 0。 */
export function revealShift(start: number, end: number, size: number) {
    if (end - start > size - VIEW_MARGIN * 2 || start < VIEW_MARGIN) return VIEW_MARGIN - start;
    return end > size - VIEW_MARGIN ? size - VIEW_MARGIN - end : 0;
}

/** 平移到看得見節點，已經看得見就不動。 */
export function revealNode(view: View, layout: MindLayout, node: PlacedMindNode, width: number, height: number): View {
    const left = (node.x - layout.rootX) * view.scale + view.x;
    const top = (node.y - layout.rootY) * view.scale + view.y;
    const dx = revealShift(left, left + node.w * view.scale, width);
    const dy = revealShift(top, top + node.h * view.scale, height);
    return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

export type MapSize = Pick<MindLayout, "width" | "height" | "rootX" | "rootY">;

/** 心智圖在卡片裡的樣子：完整放進卡片並置中，但不放大。回傳比例與根節點的世界座標。 */
export function mapInCard(card: { x: number; y: number; w: number; h: number }, size: MapSize) {
    const scale = Math.min(1, card.w / size.width, card.h / size.height);
    return {
        scale,
        rootX: card.x + card.w / 2 + (size.rootX - size.width / 2) * scale,
        rootY: card.y + card.h / 2 + (size.rootY - size.height / 2) * scale,
    };
}

/** 白板上點到的節點。圖畫在卡片裡時會填滿卡片並置中，所以這裡不受不放大的限制。 */
export function nodeAtCardPoint(
    layout: MindLayout,
    card: { x: number; y: number; w: number; h: number },
    x: number,
    y: number,
) {
    const scale = Math.min(card.w / layout.width, card.h / layout.height);
    const left = card.x + (card.w - layout.width * scale) / 2;
    const top = card.y + (card.h - layout.height * scale) / 2;
    const mapX = (x - left) / scale;
    const mapY = (y - top) / scale;
    const hit = layout.nodes.find(
        (node) => mapX >= node.x && mapX <= node.x + node.w && mapY >= node.y && mapY <= node.y + node.h,
    );
    return hit?.id ?? null;
}

/** 卡片剛好包住心智圖。根節點固定不動，分支長大時卡片往那一側長。 */
export function cardAroundMap(rootX: number, rootY: number, scale: number, size: MapSize) {
    return {
        x: rootX - size.rootX * scale,
        y: rootY - size.rootY * scale,
        w: size.width * scale,
        h: size.height * scale,
    };
}
