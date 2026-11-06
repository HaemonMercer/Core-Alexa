import { normalizeRuns, runsText, sliceRuns, type Block, type LeafBlock, type Marks } from "../ast.ts";
import {
    collectLeaves,
    finish,
    isCollapsed,
    leafRuns,
    marksAt,
    replaceLeaf,
    selectionRange,
    type Doc,
} from "./document.ts";

const BLOCK_RULES: { pattern: RegExp; wrap: (block: LeafBlock, match: RegExpExecArray) => Block }[] = [
    {
        pattern: /^(#{1,6}) $/,
        wrap: (block, match) => ({ type: "heading", level: match[1].length, runs: leafRuns(block) }),
    },
    {
        pattern: /^[-*+] $/,
        wrap: (block) => ({ type: "list", ordered: false, start: 1, items: [[block]] }),
    },
    {
        pattern: /^(\d{1,9})[.)] $/,
        wrap: (block, match) => ({ type: "list", ordered: true, start: parseInt(match[1], 10), items: [[block]] }),
    },
    { pattern: /^> $/, wrap: (block) => ({ type: "quote", blocks: [block] }) },
];

const INLINE_RULES: { pattern: RegExp; marks: Marks; link?: boolean }[] = [
    { pattern: /(?<![*\\])\*\*\*(?=[^\s*])([^*\n]*[^\s*])\*\*\*$/, marks: { bold: true, italic: true } },
    { pattern: /(?<![*\\])\*\*(?=[^\s*])([^*\n]*[^\s*])\*\*$/, marks: { bold: true } },
    { pattern: /(?<![\w_\\])__(?=[^\s_])([^_\n]*[^\s_])__$/, marks: { bold: true } },
    { pattern: /(?<![*\\])\*(?=[^\s*])([^*\n]*[^\s*])\*$/, marks: { italic: true } },
    { pattern: /(?<![\w_\\])_(?=[^\s_])([^_\n]*[^\s_])_$/, marks: { italic: true } },
    { pattern: /(?<![~\\])~~(?=[^\s~])([^~\n]*[^\s~])~~$/, marks: { strike: true } },
    { pattern: /(?<![`\\])`([^`\n]+)`$/, marks: { code: true } },
    { pattern: /(?<![\\!])\[([^\]\n]+)\]\(([^\s()]+)\)$/, marks: {}, link: true },
];

/** 打字時把剛完成的 Markdown 記號轉成格式，例如行首的 `# ` 或結尾的 `**粗體**`。 */
export function applyInputRule(doc: Doc): Doc | null {
    if (!isCollapsed(doc)) return null;
    const [point] = selectionRange(doc);
    const blocks = structuredClone(doc.blocks);
    const leaf = collectLeaves(blocks)[point.leaf];
    const { block } = leaf;
    if (block.type !== "paragraph" && block.type !== "heading") return null;

    const before = runsText(block.runs).slice(0, point.offset);

    if (block.type === "paragraph") {
        for (const { pattern, wrap } of BLOCK_RULES) {
            const match = pattern.exec(before);
            if (!match) continue;
            block.runs = sliceRuns(block.runs, point.offset);
            replaceLeaf(leaf, wrap(block, match));
            return finish(blocks, { leaf: point.leaf, offset: 0 });
        }
    }

    for (const { pattern, marks, link } of INLINE_RULES) {
        const match = pattern.exec(before);
        if (!match) continue;

        const start = match.index;
        const inner = match[1];
        const opening = match[0].indexOf(inner);
        const from = start + opening;
        const to = from + inner.length;
        if (sliceRuns(block.runs, start, point.offset).some((run) => run.code)) continue;

        const outside = marksAt(block.runs, from);
        const added: Marks = link ? { href: match[2] } : marks;
        block.runs = normalizeRuns([
            ...sliceRuns(block.runs, 0, start),
            ...sliceRuns(block.runs, from, to).map((run) => ({ ...run, ...added })),
            ...sliceRuns(block.runs, point.offset),
        ]);
        return finish(blocks, { leaf: point.leaf, offset: start + inner.length }, outside);
    }

    return null;
}
