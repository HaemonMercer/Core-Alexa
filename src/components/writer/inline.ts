import { highlight, TOKEN_COLORS } from "../code/highlight.ts";
import { fenceToLanguage } from "../code/languages.ts";
import { paragraph } from "../../markdown/ast.ts";
import { readInline, renderBlocks } from "../../markdown/dom.ts";
import { parseInline } from "../../markdown/parse.ts";
import { serializeInline } from "../../markdown/serialize.ts";

// 區塊文字是行內 Markdown，編輯時是 contenteditable 的 DOM，這裡負責兩邊互換與游標位置。

/** 程式碼區塊是純文字，其他區塊有行內格式。 */
export function renderText(element: HTMLElement, text: string, plain: boolean) {
    if (plain) {
        element.textContent = text;
    } else {
        const [holder] = renderBlocks([paragraph(parseInline(text))]);
        element.replaceChildren(...holder.childNodes);
    }
    markEmpty(element);
}

/** 重新上色。文字不變，讀回來的內容也一樣。 */
export function paintCode(element: HTMLElement, fence: string) {
    element.replaceChildren(...highlight(element.textContent ?? "", fenceToLanguage(fence)).map(({ text, kind }) => {
        if (kind === "plain") return document.createTextNode(text);
        const span = document.createElement("span");
        span.style.color = TOKEN_COLORS[kind];
        span.textContent = text;
        return span;
    }));
}

export function readText(element: HTMLElement, plain: boolean): string {
    if (plain) return element.textContent ?? "";
    return serializeInline(readInline(element.childNodes));
}

export function markEmpty(element: HTMLElement) {
    element.dataset.empty = String(!element.textContent);
}

/** 游標前面有幾個字元。沒有游標時回傳 null。 */
export function caretOffset(element: HTMLElement): number | null {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !element.contains(selection.focusNode)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(selection.focusNode as Node, selection.focusOffset);
    return range.toString().length;
}

function pointAt(element: HTMLElement, offset: number): { node: Node; offset: number } {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let rest = offset;
    let node = walker.nextNode();
    let last: Node | null = null;
    while (node) {
        const length = node.textContent?.length ?? 0;
        if (rest <= length) return { node, offset: rest };
        rest -= length;
        last = node;
        node = walker.nextNode();
    }
    return last ? { node: last, offset: last.textContent?.length ?? 0 } : { node: element, offset: 0 };
}

export function setCaret(element: HTMLElement, offset: number | "end") {
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const target = pointAt(element, offset === "end" ? Infinity : offset);
    selection.collapse(target.node, target.offset);
}

/** 文字範圍 [from, to)，用字元位置表示。 */
export function rangeOf(element: HTMLElement, from: number, to: number): Range {
    const range = document.createRange();
    const start = pointAt(element, from);
    const end = pointAt(element, to);
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
}

function fragmentText(fragment: DocumentFragment, plain: boolean): string {
    const holder = document.createElement("div");
    holder.append(fragment);
    return readText(holder, plain);
}

/** 在游標處切開，回傳前後兩段的 Markdown。選取的文字會被丟掉，和一般編輯器相同。 */
export function splitAtCaret(element: HTMLElement, plain: boolean): [string, string] {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return [readText(element, plain), ""];
    const picked = selection.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(element);
    before.setEnd(picked.startContainer, picked.startOffset);
    const after = document.createRange();
    after.selectNodeContents(element);
    after.setStart(picked.endContainer, picked.endOffset);
    return [fragmentText(before.cloneContents(), plain), fragmentText(after.cloneContents(), plain)];
}

/** 游標在這個區塊的第一行或最後一行，上下鍵才要跳到別的區塊。 */
export function caretOnEdgeLine(element: HTMLElement, edge: "top" | "bottom"): boolean {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    if (!element.textContent) return true;
    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getClientRects()[0];
    // 游標在空行上量不到位置，當成在邊緣以免卡住。
    if (!rect) return true;
    const box = element.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(element).lineHeight) || rect.height;
    return edge === "top" ? rect.top - box.top < line * 0.8 : box.bottom - rect.bottom < line * 0.8;
}

export function wrapSelectionInCode() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const code = document.createElement("code");
    code.append(range.extractContents());
    range.insertNode(code);
    selection.selectAllChildren(code);
}
