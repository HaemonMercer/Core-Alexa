// 行內格式、連結與 `[[` 提及。

import { mapRuns, normalizeRuns, runsLength, runsText, sliceRuns, type LeafBlock, type MarkName, type Marks, type Run } from "../ast.ts";
import { noteHref } from "../noteLink.ts";
import {
    collectLeaves,
    finish,
    insertRunsAt,
    isCollapsed,
    leafRuns,
    marksAt,
    selectionRange,
    type Doc,
} from "./document.ts";

function selectedSpans(doc: Doc): { block: Exclude<LeafBlock, { type: "code" | "rule" }>; from: number; to: number }[] {
    const [start, end] = selectionRange(doc);
    const spans = [];
    const leaves = collectLeaves(doc.blocks);
    for (let i = start.leaf; i <= end.leaf; i += 1) {
        const { block } = leaves[i];
        if (block.type === "code" || block.type === "rule") continue;
        const from = i === start.leaf ? start.offset : 0;
        const to = i === end.leaf ? end.offset : runsLength(block.runs);
        if (from < to) spans.push({ block, from, to });
    }
    return spans;
}

/** `caretMarks` 是游標處目前的格式；沒有選取文字時改變的是接下來要輸入的格式。 */
export function toggleMark(doc: Doc, mark: MarkName, caretMarks: Marks): Doc {
    if (isCollapsed(doc)) {
        const pending = { ...caretMarks };
        if (pending[mark]) delete pending[mark];
        else pending[mark] = true;
        return { ...doc, pending };
    }

    const copy = { ...doc, blocks: structuredClone(doc.blocks) };
    const spans = selectedSpans(copy);
    const allMarked = spans.every(({ block, from, to }) =>
        sliceRuns(block.runs, from, to).every((run) => run[mark]));

    for (const { block, from, to } of spans) {
        block.runs = mapRuns(block.runs, from, to, (run) => {
            const next = { ...run };
            if (allMarked) delete next[mark];
            else next[mark] = true;
            return next;
        });
    }
    return copy;
}

function linkExtent(runs: Run[], offset: number): [number, number] | null {
    let position = 0;
    for (let i = 0; i < runs.length; i += 1) {
        const end = position + runs[i].text.length;
        if (runs[i].href !== undefined && offset >= position && offset <= end) {
            return [position, end];
        }
        position = end;
    }
    return null;
}

export function linkAtCaret(doc: Doc): string {
    const [start] = selectionRange(doc);
    const runs = leafRuns(collectLeaves(doc.blocks)[start.leaf].block);
    const offset = start.offset;
    const found = sliceRuns(runs, Math.max(offset - 1, 0), offset + 1).find((run) => run.href !== undefined);
    return found?.href ?? "";
}

/** `href` 為空字串時移除連結。 */
export function setLink(doc: Doc, href: string): Doc {
    const blocks = structuredClone(doc.blocks);
    const [start] = selectionRange(doc);
    const leaf = collectLeaves(blocks)[start.leaf];
    const apply = (run: Run): Run => {
        const next = { ...run };
        if (href) next.href = href;
        else delete next.href;
        return next;
    };

    if (isCollapsed(doc)) {
        if (leaf.block.type !== "paragraph" && leaf.block.type !== "heading") return doc;
        const extent = linkExtent(leaf.block.runs, start.offset);
        if (extent) {
            leaf.block.runs = mapRuns(leaf.block.runs, extent[0], extent[1], apply);
            return finish(blocks, start);
        }
        if (!href) return doc;
        const length = insertRunsAt(blocks, start, [{ text: href, href }]);
        return finish(blocks, { leaf: start.leaf, offset: start.offset + length }, marksAt(leaf.block.runs, start.offset));
    }

    const copy = { ...doc, blocks };
    for (const { block, from, to } of selectedSpans(copy)) {
        block.runs = mapRuns(block.runs, from, to, apply);
    }
    return copy;
}

/** 正在輸入的 `[[搜尋文字`，`from` 是 `[[` 的位置。 */
export interface Mention {
    leaf: number;
    from: number;
    query: string;
}

/** 游標前面是還沒完成的 `[[` 時回傳它；程式碼和既有連結裡的 `[[` 只是文字。 */
export function mentionAtCaret(doc: Doc): Mention | null {
    if (!isCollapsed(doc)) return null;
    const [point] = selectionRange(doc);
    const { block } = collectLeaves(doc.blocks)[point.leaf];
    if (block.type !== "paragraph" && block.type !== "heading") return null;

    const match = /\[\[([^[\]\n]*)$/.exec(runsText(block.runs).slice(0, point.offset));
    if (!match) return null;
    const typed = sliceRuns(block.runs, match.index, point.offset);
    if (typed.some((run) => run.code || run.href !== undefined)) return null;
    return { leaf: point.leaf, from: match.index, query: match[1] };
}

/** 把 `[[搜尋文字` 換成指向卡片的連結，之後輸入的文字不在連結裡。 */
export function insertNoteLink(doc: Doc, mention: Mention, noteID: string, title: string): Doc {
    const blocks = structuredClone(doc.blocks);
    const { block } = collectLeaves(blocks)[mention.leaf];
    if (block.type !== "paragraph" && block.type !== "heading") return doc;

    const outside = marksAt(block.runs, mention.from);
    block.runs = normalizeRuns([
        ...sliceRuns(block.runs, 0, mention.from),
        { ...outside, text: title, href: noteHref(noteID) },
        ...sliceRuns(block.runs, mention.from + "[[".length + mention.query.length),
    ]);
    return finish(blocks, { leaf: mention.leaf, offset: mention.from + title.length }, outside);
}
