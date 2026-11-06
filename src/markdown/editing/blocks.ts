// 切換區塊類型：標題、清單、引言、程式碼與分隔線。

import { paragraph, type Block } from "../ast.ts";
import {
    collapse,
    collectLeaves,
    finish,
    leafRuns,
    leafText,
    outdent,
    removeLeaf,
    replaceLeaf,
    selectionRange,
    tidy,
    type Doc,
    type Leaf,
} from "./document.ts";

function eachSelectedLeaf(doc: Doc, visit: (blocks: Block[], index: number) => void): Doc {
    const [start, end] = selectionRange(doc);
    const blocks = structuredClone(doc.blocks);
    for (let i = start.leaf; i <= end.leaf; i += 1) {
        visit(blocks, i);
        tidy(blocks);
    }
    return { ...doc, blocks };
}

function selectedLeaves(doc: Doc): Leaf[] {
    const [start, end] = selectionRange(doc);
    return collectLeaves(doc.blocks).slice(start.leaf, end.leaf + 1);
}

export function setHeading(doc: Doc, level: number): Doc {
    const allSame = selectedLeaves(doc).every(({ block }) =>
        block.type === "heading" && block.level === level);

    return eachSelectedLeaf(doc, (blocks, index) => {
        const leaf = collectLeaves(blocks)[index];
        if (leaf.block.type === "rule") return;
        const runs = leafRuns(leaf.block);
        replaceLeaf(leaf, allSame ? paragraph(runs) : { type: "heading", level, runs });
    });
}

export function toggleList(doc: Doc, ordered: boolean): Doc {
    const inList = (leaf: Leaf) => leaf.parent?.kind === "item" && leaf.parent.node.ordered === ordered;
    const allInList = selectedLeaves(doc).every(inList);

    return eachSelectedLeaf(doc, (blocks, index) => {
        const leaf = collectLeaves(blocks)[index];
        if (allInList) {
            outdent(leaf);
        } else if (leaf.parent?.kind === "item") {
            leaf.parent.node.ordered = ordered;
        } else {
            replaceLeaf(leaf, { type: "list", ordered, start: 1, items: [[leaf.block]] });
        }
    });
}

function hasQuote(leaf: Leaf): boolean {
    for (let parent = leaf.parent; parent; parent = parent.parent) {
        if (parent.kind === "quote") return true;
    }
    return false;
}

export function toggleQuote(doc: Doc): Doc {
    const allQuoted = selectedLeaves(doc).every(hasQuote);

    return eachSelectedLeaf(doc, (blocks, index) => {
        if (!allQuoted) {
            const leaf = collectLeaves(blocks)[index];
            if (!hasQuote(leaf)) replaceLeaf(leaf, { type: "quote", blocks: [leaf.block] });
            return;
        }
        while (hasQuote(collectLeaves(blocks)[index])) {
            outdent(collectLeaves(blocks)[index]);
            tidy(blocks);
        }
    });
}

export function toggleCodeBlock(doc: Doc): Doc {
    const selected = selectedLeaves(doc);

    if (selected.every(({ block }) => block.type === "code")) {
        return eachSelectedLeaf(doc, (blocks, index) => {
            const leaf = collectLeaves(blocks)[index];
            replaceLeaf(leaf, paragraph(leafRuns(leaf.block)));
        });
    }

    const [start] = selectionRange(doc);
    const blocks = structuredClone(doc.blocks);
    const leaves = collectLeaves(blocks).slice(start.leaf, start.leaf + selected.length);
    const text = leaves
        .filter(({ block }) => block.type !== "rule")
        .map(({ block }) => leafText(block))
        .join("\n");
    replaceLeaf(leaves[0], { type: "code", language: "", text });
    leaves.slice(1).forEach(removeLeaf);
    return finish(blocks, start);
}

/** 選取範圍裡的程式碼區塊都換成這個語言，其他區塊不動。 */
export function setCodeLanguage(doc: Doc, language: string): Doc {
    return eachSelectedLeaf(doc, (blocks, index) => {
        const { block } = collectLeaves(blocks)[index];
        if (block.type === "code") block.language = language;
    });
}

export function insertRule(doc: Doc): Doc {
    const { blocks, point } = collapse(doc);
    const leaf = collectLeaves(blocks)[point.leaf];
    const index = leaf.siblings.indexOf(leaf.block);
    leaf.siblings.splice(index + 1, 0, { type: "rule" }, paragraph());
    return finish(blocks, { leaf: point.leaf + 2, offset: 0 });
}
