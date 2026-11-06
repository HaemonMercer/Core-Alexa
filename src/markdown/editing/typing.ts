// 打字、換行、刪除、縮排與剪貼簿。

import { normalizeRuns, paragraph, runsText, sliceRuns, type Block, type LeafBlock } from "../ast.ts";
import { parseMarkdown } from "../parse.ts";
import { serializeInline, serializeMarkdown } from "../serialize.ts";
import {
    collapse,
    collectLeaves,
    finish,
    insertRunsAt,
    isFirstInContainer,
    leafLength,
    leafRuns,
    leafText,
    marksAt,
    outdent,
    removeLeaf,
    replaceLeaf,
    selectionRange,
    tidy,
    type Doc,
    type Leaf,
    type Point,
} from "./document.ts";

export function insertText(doc: Doc, text: string): Doc {
    const { blocks, point } = collapse(doc);
    const marks = marksAt(leafRuns(collectLeaves(blocks)[point.leaf].block), point.offset);
    const length = insertRunsAt(blocks, point, [{ ...marks, text }]);
    return finish(blocks, { leaf: point.leaf, offset: point.offset + length });
}

function joinLeaves(target: LeafBlock, source: LeafBlock) {
    if (target.type === "code") target.text += leafText(source);
    else if (target.type !== "rule") target.runs = normalizeRuns([...target.runs, ...leafRuns(source)]);
}

export function pressEnter(doc: Doc): Doc {
    const { blocks, point } = collapse(doc);
    const leaf = collectLeaves(blocks)[point.leaf];
    const { block } = leaf;
    const below: Point = { leaf: point.leaf + 1, offset: 0 };
    const index = leaf.siblings.indexOf(block);

    if (block.type === "rule") {
        leaf.siblings.splice(index + 1, 0, paragraph());
        return finish(blocks, below);
    }

    if (block.type === "code") {
        // 在最後一個空行再按一次 Enter 離開程式碼區塊。
        if (point.offset === block.text.length && block.text.endsWith("\n")) {
            block.text = block.text.slice(0, -1);
            leaf.siblings.splice(index + 1, 0, paragraph());
            return finish(blocks, below);
        }
        block.text = `${block.text.slice(0, point.offset)}\n${block.text.slice(point.offset)}`;
        return finish(blocks, { leaf: point.leaf, offset: point.offset + 1 });
    }

    const text = runsText(block.runs);
    if (block.type === "paragraph") {
        if (/^(---+|\*\*\*+|___+)$/.test(text)) {
            leaf.siblings.splice(index, 1, { type: "rule" }, paragraph());
            return finish(blocks, below);
        }
        const fence = /^```(\S*)$/.exec(text);
        if (fence && point.offset === text.length) {
            leaf.siblings[index] = { type: "code", language: fence[1], text: "" };
            return finish(blocks, { leaf: point.leaf, offset: 0 });
        }
        if (!text && leaf.parent) {
            outdent(leaf);
            return finish(blocks, point);
        }
    }

    const tail = sliceRuns(block.runs, point.offset);
    block.runs = sliceRuns(block.runs, 0, point.offset);

    if (block.type === "heading" && point.offset === 0 && tail.length > 0) {
        block.runs = tail;
        leaf.siblings.splice(index, 0, paragraph());
        return finish(blocks, below);
    }

    if (leaf.parent?.kind === "item" && index === 0) {
        const { node, item } = leaf.parent;
        const moved = item.splice(1);
        node.items.splice(node.items.indexOf(item) + 1, 0, [paragraph(tail), ...moved]);
    } else {
        leaf.siblings.splice(index + 1, 0, paragraph(tail));
    }
    return finish(blocks, below);
}

export function pressLineBreak(doc: Doc): Doc {
    const [start] = selectionRange(doc);
    const { block } = collectLeaves(doc.blocks)[start.leaf];
    if (block.type !== "paragraph") return pressEnter(doc);
    return insertText(doc, "\n");
}

/** 游標在區塊開頭時按 Backspace。 */
export function pressBackspace(doc: Doc): Doc {
    const blocks = structuredClone(doc.blocks);
    const [point] = selectionRange(doc);
    const leaves = collectLeaves(blocks);
    const leaf = leaves[point.leaf];
    const { block } = leaf;

    if (block.type === "heading") {
        replaceLeaf(leaf, paragraph(block.runs));
        return finish(blocks, point);
    }
    if (block.type === "code") {
        replaceLeaf(leaf, paragraph(block.text ? [{ text: block.text }] : []));
        return finish(blocks, point);
    }
    if (leaf.parent && isFirstInContainer(leaf)) {
        outdent(leaf);
        return finish(blocks, point);
    }

    const previous = leaves[point.leaf - 1];
    if (!previous) return finish(blocks, point);
    const target: Point = { leaf: point.leaf - 1, offset: leafLength(previous.block) };

    if (previous.block.type === "rule") {
        removeLeaf(previous);
        return finish(blocks, { leaf: target.leaf, offset: 0 });
    }
    if (previous.block.type === "paragraph" && target.offset === 0) {
        removeLeaf(previous);
        return finish(blocks, target);
    }
    joinLeaves(previous.block, block);
    removeLeaf(leaf);
    return finish(blocks, target);
}

/** 游標在區塊結尾時按 Delete。 */
export function pressDelete(doc: Doc): Doc {
    const blocks = structuredClone(doc.blocks);
    const [point] = selectionRange(doc);
    const leaves = collectLeaves(blocks);
    const leaf = leaves[point.leaf];
    const next = leaves[point.leaf + 1];
    if (!next) return finish(blocks, point);

    if (next.block.type === "rule") {
        removeLeaf(next);
    } else if (leaf.block.type === "paragraph" && leaf.block.runs.length === 0) {
        removeLeaf(leaf);
    } else {
        joinLeaves(leaf.block, next.block);
        removeLeaf(next);
    }
    return finish(blocks, point);
}

function indentItem(blocks: Block[], leaf: Leaf) {
    const parent = leaf.parent;
    if (parent?.kind !== "item") return;
    const list = parent.node;
    const position = list.items.indexOf(parent.item);
    if (position === 0) return;

    list.items.splice(position, 1);
    const previous = list.items[position - 1];
    const last = previous[previous.length - 1];
    if (last?.type === "list" && last.ordered === list.ordered) last.items.push(parent.item);
    else previous.push({ ...list, start: 1, items: [parent.item] });
    tidy(blocks);
}

export function pressTab(doc: Doc, outward: boolean): Doc {
    const [start, end] = selectionRange(doc);
    const blocks = structuredClone(doc.blocks);

    if (collectLeaves(blocks)[start.leaf].block.type === "code") {
        return outward ? doc : insertText(doc, "    ");
    }

    for (let i = start.leaf; i <= end.leaf; i += 1) {
        const leaf = collectLeaves(blocks)[i];
        if (leaf.parent?.kind !== "item" || !isFirstInContainer(leaf)) continue;
        if (outward) outdent(leaf);
        else indentItem(blocks, leaf);
        tidy(blocks);
    }
    return { ...doc, blocks };
}

export function pasteMarkdown(doc: Doc, source: string): Doc {
    const { blocks, point } = collapse(doc);
    const pasted = parseMarkdown(source);
    const leaf = collectLeaves(blocks)[point.leaf];
    const { block } = leaf;

    if (block.type === "code") {
        const length = insertRunsAt(blocks, point, [{ text: source.replace(/\r\n?/g, "\n") }]);
        return finish(blocks, { leaf: point.leaf, offset: point.offset + length });
    }

    const only = pasted.length === 1 ? pasted[0] : null;
    if (only?.type === "paragraph") {
        const length = insertRunsAt(blocks, point, only.runs);
        return finish(blocks, { leaf: point.leaf, offset: point.offset + length });
    }

    const index = leaf.siblings.indexOf(block);
    const count = collectLeaves(pasted).length;
    const lastPasted = collectLeaves(pasted)[count - 1];
    const end = leafLength(lastPasted.block);

    if (block.type === "rule") {
        leaf.siblings.splice(index + 1, 0, ...pasted);
        return finish(blocks, { leaf: point.leaf + count, offset: end });
    }

    const tail = sliceRuns(block.runs, point.offset);
    block.runs = sliceRuns(block.runs, 0, point.offset);
    const replaceCurrent = block.type === "paragraph" && block.runs.length === 0;
    const pieces: Block[] = tail.length > 0 ? [...pasted, paragraph(tail)] : pasted;
    leaf.siblings.splice(replaceCurrent ? index : index + 1, replaceCurrent ? 1 : 0, ...pieces);
    return finish(blocks, { leaf: point.leaf + (replaceCurrent ? count - 1 : count), offset: end });
}

/** 複製時放進剪貼簿的 Markdown。 */
export function selectedMarkdown(doc: Doc): string {
    const [start, end] = selectionRange(doc);
    const blocks = structuredClone(doc.blocks);
    const leaves = collectLeaves(blocks);

    if (start.leaf === end.leaf) {
        const { block } = leaves[start.leaf];
        if (block.type === "code") return block.text.slice(start.offset, end.offset);
        return serializeInline(sliceRuns(leafRuns(block), start.offset, end.offset));
    }

    leaves.forEach((leaf, index) => {
        if (index < start.leaf || index > end.leaf) removeLeaf(leaf);
    });
    const trim = (block: LeafBlock, from: number, to: number) => {
        if (block.type === "code") block.text = block.text.slice(from, to);
        else if (block.type !== "rule") block.runs = sliceRuns(block.runs, from, to);
    };
    trim(leaves[start.leaf].block, start.offset, Infinity);
    trim(leaves[end.leaf].block, 0, end.offset);
    tidy(blocks);
    return serializeMarkdown(blocks);
}
