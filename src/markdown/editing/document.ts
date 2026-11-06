import {
    normalizeRuns,
    paragraph,
    runsLength,
    runsText,
    sliceRuns,
    type Block,
    type LeafBlock,
    type ListBlock,
    type Marks,
    type QuoteBlock,
    type Run,
} from "../ast.ts";

// 文字輸入（含注音、倉頡等輸入法）交給瀏覽器，結構變動都在這裡對文件模型操作。
// 每個指令都不修改傳入的文件，復原堆疊才能直接保存舊文件。

/** `leaf` 是文件順序中第幾個最小區塊，`offset` 是其中的字元位置。 */
export interface Point {
    leaf: number;
    offset: number;
}

export interface Selection {
    anchor: Point;
    focus: Point;
}

export interface Doc {
    blocks: Block[];
    selection: Selection;
    /** 游標處下一個輸入字元的格式，用於關閉格式後繼續打字。 */
    pending?: Marks;
}

type Parent =
    | { kind: "quote"; node: QuoteBlock; siblings: Block[]; parent: Parent | null }
    | { kind: "item"; node: ListBlock; item: Block[]; siblings: Block[]; parent: Parent | null };

export interface Leaf {
    block: LeafBlock;
    siblings: Block[];
    parent: Parent | null;
}

export function collectLeaves(blocks: Block[], parent: Parent | null = null, leaves: Leaf[] = []): Leaf[] {
    for (const block of blocks) {
        if (block.type === "quote") {
            collectLeaves(block.blocks, { kind: "quote", node: block, siblings: blocks, parent }, leaves);
        } else if (block.type === "list") {
            for (const item of block.items) {
                collectLeaves(item, { kind: "item", node: block, item, siblings: blocks, parent }, leaves);
            }
        } else if (block.type !== "table" && block.type !== "image") {
            leaves.push({ block, siblings: blocks, parent });
        }
    }
    return leaves;
}

export function tidy(blocks: Block[]) {
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
        const block = blocks[i];
        if (block.type === "quote") {
            tidy(block.blocks);
            if (block.blocks.length === 0) blocks.splice(i, 1);
        } else if (block.type === "list") {
            block.items.forEach(tidy);
            block.items = block.items.filter((item) => item.length > 0);
            if (block.items.length === 0) blocks.splice(i, 1);
        }
    }
    for (let i = blocks.length - 1; i > 0; i -= 1) {
        const previous = blocks[i - 1];
        const current = blocks[i];
        if (previous.type === "quote" && current.type === "quote") {
            previous.blocks.push(...current.blocks);
            blocks.splice(i, 1);
        } else if (
            previous.type === "list" && current.type === "list" &&
            previous.ordered === current.ordered
        ) {
            previous.items.push(...current.items);
            blocks.splice(i, 1);
        }
    }
}

export function finish(blocks: Block[], point: Point, pending?: Marks): Doc {
    tidy(blocks);
    if (blocks.length === 0) blocks.push(paragraph());
    return { blocks, selection: { anchor: point, focus: point }, pending };
}

export const leafLength = (block: LeafBlock): number => {
    if (block.type === "code") return block.text.length;
    return block.type === "rule" ? 0 : runsLength(block.runs);
};

export const leafRuns = (block: LeafBlock): Run[] => {
    if (block.type === "code") return block.text ? [{ text: block.text }] : [];
    return block.type === "rule" ? [] : block.runs;
};

export const leafText = (block: LeafBlock): string => runsText(leafRuns(block));

export function replaceLeaf(leaf: Leaf, next: Block) {
    leaf.siblings[leaf.siblings.indexOf(leaf.block)] = next;
}

export function removeLeaf(leaf: Leaf) {
    leaf.siblings.splice(leaf.siblings.indexOf(leaf.block), 1);
}

export const isFirstInContainer = (leaf: Leaf) => leaf.siblings[0] === leaf.block;

/** 回傳依文件順序排列、且位置不超出區塊長度的選取範圍。 */
export function selectionRange(doc: Doc): [Point, Point] {
    const leaves = collectLeaves(doc.blocks);
    const clamp = (point: Point): Point => {
        const leaf = Math.min(point.leaf, leaves.length - 1);
        return { leaf, offset: Math.min(point.offset, leafLength(leaves[leaf].block)) };
    };
    const a = clamp(doc.selection.anchor);
    const b = clamp(doc.selection.focus);
    const inOrder = a.leaf < b.leaf || (a.leaf === b.leaf && a.offset <= b.offset);
    return inOrder ? [a, b] : [b, a];
}

export function isCollapsed(doc: Doc): boolean {
    const [start, end] = selectionRange(doc);
    return start.leaf === end.leaf && start.offset === end.offset;
}

export const spansLeaves = (doc: Doc): boolean => {
    const [start, end] = selectionRange(doc);
    return start.leaf !== end.leaf;
};

export function isAtLeafEnd(doc: Doc): boolean {
    const [, end] = selectionRange(doc);
    return end.offset >= leafLength(collectLeaves(doc.blocks)[end.leaf].block);
}

function cutRange(blocks: Block[], start: Point, end: Point) {
    const leaves = collectLeaves(blocks);
    let first = leaves[start.leaf];
    const last = leaves[end.leaf];

    if (first.block.type === "rule") {
        const replacement = paragraph();
        replaceLeaf(first, replacement);
        first = { ...first, block: replacement };
    }

    const block = first.block;
    if (block.type === "code") {
        const tail = leafText(last.block).slice(end.offset);
        block.text = block.text.slice(0, start.offset) + tail;
    } else if (block.type !== "rule") {
        block.runs = normalizeRuns([
            ...sliceRuns(block.runs, 0, start.offset),
            ...sliceRuns(leafRuns(last.block), end.offset),
        ]);
    }

    for (let i = start.leaf + 1; i <= end.leaf; i += 1) removeLeaf(leaves[i]);
    tidy(blocks);
    if (blocks.length === 0) blocks.push(paragraph());
}

/** 先刪掉選取內容，回傳複製後的區塊與游標位置。 */
export function collapse(doc: Doc): { blocks: Block[]; point: Point } {
    const [start, end] = selectionRange(doc);
    const leaves = collectLeaves(doc.blocks);
    const wholeDocument = !isCollapsed(doc) && start.leaf === 0 && start.offset === 0
        && end.leaf === leaves.length - 1 && end.offset === leafLength(leaves[end.leaf].block);
    if (wholeDocument) return { blocks: [paragraph()], point: start };

    const blocks = structuredClone(doc.blocks);
    if (start.leaf !== end.leaf || start.offset !== end.offset) cutRange(blocks, start, end);
    return { blocks, point: start };
}

export function deleteSelection(doc: Doc): Doc {
    const { blocks, point } = collapse(doc);
    return finish(blocks, point);
}

export function insertRunsAt(blocks: Block[], point: Point, inserted: Run[]): number {
    const { block } = collectLeaves(blocks)[point.leaf];
    if (block.type === "code") {
        block.text = block.text.slice(0, point.offset) + runsText(inserted) + block.text.slice(point.offset);
    } else if (block.type !== "rule") {
        block.runs = normalizeRuns([
            ...sliceRuns(block.runs, 0, point.offset),
            ...inserted,
            ...sliceRuns(block.runs, point.offset),
        ]);
    }
    return runsLength(inserted);
}

/** 回傳只用來顯示的文件：`pending` 格式的佔位字元放在游標處。 */
export function insertCaretHolder(doc: Doc, holder: string): Doc {
    const blocks = structuredClone(doc.blocks);
    const [point] = selectionRange(doc);
    insertRunsAt(blocks, point, [{ ...doc.pending, text: holder }]);
    return { ...doc, blocks };
}

export function marksAt(runs: Run[], offset: number): Marks {
    const at = offset > 0 ? sliceRuns(runs, offset - 1, offset) : sliceRuns(runs, 0, 1);
    const { text: _text, ...marks } = at[0] ?? { text: "" };
    return marks;
}

/** 移到上一層：清單項目往外一層，引言中的區塊移出引言。區塊順序不變。 */
export function outdent(leaf: Leaf) {
    const parent = leaf.parent;
    if (!parent) return;

    const index = parent.siblings.indexOf(parent.node);
    if (parent.kind === "quote") {
        const position = parent.node.blocks.indexOf(leaf.block);
        const before = parent.node.blocks.slice(0, position);
        const after = parent.node.blocks.slice(position + 1);
        const pieces: Block[] = [leaf.block];
        if (before.length > 0) pieces.unshift({ type: "quote", blocks: before });
        if (after.length > 0) pieces.push({ type: "quote", blocks: after });
        parent.siblings.splice(index, 1, ...pieces);
        return;
    }

    const list = parent.node;
    const position = list.items.indexOf(parent.item);
    const before = list.items.slice(0, position);
    const after = list.items.slice(position + 1);
    const remainder = (items: Block[][], offset: number): ListBlock => ({ ...list, start: list.start + offset, items });
    const outer = parent.parent;

    if (outer?.kind === "item") {
        const moved = [...parent.item];
        if (after.length > 0) moved.push(remainder(after, position + 1));
        list.items = before;
        outer.node.items.splice(outer.node.items.indexOf(outer.item) + 1, 0, moved);
    } else {
        const pieces: Block[] = [...parent.item];
        if (before.length > 0) pieces.unshift(remainder(before, 0));
        if (after.length > 0) pieces.push(remainder(after, position + 1));
        parent.siblings.splice(index, 1, ...pieces);
    }
}
