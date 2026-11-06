import { highlight, TOKEN_COLORS } from "../components/code/highlight.ts";
import { fenceToLanguage } from "../components/code/languages.ts";
import { mediaUrl } from "../media.ts";
import { normalizeRuns, paragraph, type Block, type Marks, type Run } from "./ast.ts";
import type { Point } from "./editing.ts";

// 文件模型與編輯區 DOM 之間的轉換。畫面只用 createElement 與文字節點建立，
// 筆記內容裡的 HTML 永遠只是文字。

/** 瀏覽器要有一個字元才能把游標放進指定格式，讀回文件時會被移除。 */
export const CARET_HOLDER = "​";

const LEAF_SELECTOR = "p,h1,h2,h3,h4,h5,h6,pre,hr,div";

function appendText(parent: Node, text: string) {
    text.split("\n").forEach((line, index) => {
        if (index > 0) parent.appendChild(document.createElement("br"));
        if (line) parent.appendChild(document.createTextNode(line));
    });
}

function appendRun(parent: Node, run: Run) {
    let target = parent;
    const wrap = (tag: string) => {
        const element = document.createElement(tag);
        target.appendChild(element);
        target = element;
        return element;
    };
    if (run.href !== undefined) wrap("a").setAttribute("href", run.href);
    if (run.strike) wrap("del");
    if (run.bold) wrap("strong");
    if (run.italic) wrap("em");
    if (run.code) wrap("code");
    appendText(target, run.text);
}

function appendRuns(parent: HTMLElement, runs: Run[]) {
    runs.forEach((run) => appendRun(parent, run));
    // 區塊結尾的 <br> 不會多出一行：空區塊和結尾換行都要再補一個才看得到。
    if (runs.length === 0 || runs[runs.length - 1].text.endsWith("\n")) {
        parent.appendChild(document.createElement("br"));
    }
}

function renderBlock(block: Block): HTMLElement {
    switch (block.type) {
        case "paragraph": {
            const element = document.createElement("p");
            appendRuns(element, block.runs);
            return element;
        }
        case "heading": {
            const element = document.createElement(`h${block.level}`);
            appendRuns(element, block.runs);
            return element;
        }
        case "code": {
            const element = document.createElement("pre");
            if (block.language) element.dataset.language = block.language;
            const code = document.createElement("code");
            for (const { text, kind } of highlight(block.text, fenceToLanguage(block.language))) {
                if (kind === "plain") {
                    code.append(text);
                } else {
                    const span = document.createElement("span");
                    span.style.color = TOKEN_COLORS[kind];
                    span.textContent = text;
                    code.append(span);
                }
            }
            // 同樣的道理，結尾多一個換行，最後的空行才看得到。
            code.append("\n");
            element.appendChild(code);
            return element;
        }
        case "rule":
            return document.createElement("hr");
        case "quote": {
            const element = document.createElement("blockquote");
            element.append(...block.blocks.map(renderBlock));
            return element;
        }
        case "list": {
            const element = document.createElement(block.ordered ? "ol" : "ul");
            if (block.ordered && block.start !== 1) element.setAttribute("start", String(block.start));
            block.items.forEach((item, index) => {
                const li = document.createElement("li");
                li.append(...item.map(renderBlock));
                const marker = block.markers?.[index];
                if (marker) li.dataset.marker = marker;
                element.appendChild(li);
            });
            return element;
        }
        case "table": {
            const element = document.createElement("table");
            block.rows.forEach((row, rowIndex) => {
                const tr = element.insertRow();
                for (const cell of row) {
                    const td = document.createElement(rowIndex === 0 ? "th" : "td");
                    cell.forEach((run) => appendRun(td, run));
                    tr.appendChild(td);
                }
            });
            return element;
        }
        case "image": {
            const element = document.createElement("img");
            element.src = mediaUrl(block.file);
            element.alt = "";
            if (block.percent !== null) element.style.width = `${block.percent}%`;
            return element;
        }
    }
}

export const renderBlocks = (blocks: Block[]): HTMLElement[] => blocks.map(renderBlock);

function markFor(element: Element, marks: Marks): Marks {
    switch (element.tagName) {
        case "STRONG":
        case "B":
            return { ...marks, bold: true };
        case "EM":
        case "I":
            return { ...marks, italic: true };
        case "DEL":
        case "S":
        case "STRIKE":
            return { ...marks, strike: true };
        case "CODE":
            return { ...marks, code: true };
        case "A":
            return { ...marks, href: element.getAttribute("href") ?? "" };
        default:
            return marks;
    }
}

function readRuns(nodes: Iterable<Node>, marks: Marks, runs: Run[]) {
    for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            runs.push({ ...marks, text: node.textContent!.split(CARET_HOLDER).join("") });
        } else if (node instanceof HTMLBRElement) {
            runs.push({ ...marks, text: "\n" });
        } else if (node instanceof Element) {
            readRuns(node.childNodes, markFor(node, marks), runs);
        }
    }
}

export function readInline(nodes: Iterable<Node>): Run[] {
    const runs: Run[] = [];
    readRuns(nodes, {}, runs);
    const merged = normalizeRuns(runs);
    const last = merged[merged.length - 1];
    if (last?.text.endsWith("\n")) last.text = last.text.slice(0, -1);
    return normalizeRuns(merged);
}

function readBlock(element: Element): Block | null {
    const tag = element.tagName;
    if (/^H[1-6]$/.test(tag)) {
        const runs = readInline(element.childNodes).map((run) => ({ ...run, text: run.text.replace(/\n/g, " ") }));
        return { type: "heading", level: Number(tag[1]), runs };
    }
    switch (tag) {
        case "P":
        case "DIV":
            return paragraph(readInline(element.childNodes));
        case "PRE":
            return {
                type: "code",
                language: (element as HTMLElement).dataset.language ?? "",
                text: element.textContent!.split(CARET_HOLDER).join("").replace(/\n$/, ""),
            };
        case "HR":
            return { type: "rule" };
        case "BLOCKQUOTE":
            return { type: "quote", blocks: readBlocks(element) };
        case "UL":
        case "OL":
            return {
                type: "list",
                ordered: tag === "OL",
                start: Number(element.getAttribute("start") ?? 1),
                items: [...element.children]
                    .filter((child) => child.tagName === "LI")
                    .map(readBlocks),
            };
        default:
            return null;
    }
}

export function readBlocks(container: Element): Block[] {
    const blocks: Block[] = [];
    let stray: Node[] = [];

    const flushStray = () => {
        const runs = readInline(stray);
        if (runs.length > 0) blocks.push(paragraph(runs));
        stray = [];
    };

    for (const node of container.childNodes) {
        const block = node instanceof Element ? readBlock(node) : null;
        if (block) {
            flushStray();
            blocks.push(block);
        } else {
            stray.push(node);
        }
    }
    flushStray();

    return blocks.length > 0 ? blocks : [paragraph()];
}

const leafElements = (root: Element) => [...root.querySelectorAll(LEAF_SELECTOR)];

function countOffset(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent!.split(CARET_HOLDER).join("").length;
    }
    if (node instanceof HTMLBRElement) return 1;
    let total = 0;
    node.childNodes.forEach((child) => {
        total += countOffset(child);
    });
    return total;
}

function offsetWithin(leaf: Element, node: Node, offset: number): number {
    const range = document.createRange();
    range.setStart(leaf, 0);
    range.setEnd(node, offset);
    return countOffset(range.cloneContents());
}

export function pointFromDom(root: Element, node: Node, offset: number): Point {
    const leaves = leafElements(root);
    const element = node instanceof Element ? node : node.parentElement;
    const leaf = element?.closest(LEAF_SELECTOR);
    const index = leaf ? leaves.indexOf(leaf) : -1;
    if (index >= 0) return { leaf: index, offset: offsetWithin(leaf!, node, offset) };

    // 全選時端點會落在區塊之間，改用最接近的區塊。
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const following = leaves.findIndex((candidate) => range.comparePoint(candidate, 0) >= 0);
    if (following >= 0) return { leaf: following, offset: 0 };
    const last = leaves.length - 1;
    if (last < 0) return { leaf: 0, offset: 0 };
    return { leaf: last, offset: countOffset(leaves[last]) };
}

function findPosition(node: Node, remaining: { offset: number }): { node: Node; offset: number } | null {
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            const length = child.textContent!.length;
            if (remaining.offset <= length) return { node: child, offset: remaining.offset };
            remaining.offset -= length;
        } else if (child instanceof HTMLBRElement) {
            if (remaining.offset === 0) {
                return { node, offset: [...node.childNodes].indexOf(child) };
            }
            remaining.offset -= 1;
        } else {
            const found = findPosition(child, remaining);
            if (found) return found;
        }
    }
    return null;
}

export function domPosition(root: Element, point: Point): { node: Node; offset: number } {
    const leaves = leafElements(root);
    const leaf = leaves[Math.min(point.leaf, leaves.length - 1)];
    if (!leaf) return { node: root, offset: 0 };
    if (leaf.tagName === "HR") {
        return { node: leaf.parentNode!, offset: [...leaf.parentNode!.childNodes].indexOf(leaf) };
    }
    return findPosition(leaf, { offset: point.offset }) ?? { node: leaf, offset: leaf.childNodes.length };
}

export function leafElement(root: Element, point: Point): Element | undefined {
    return leafElements(root)[point.leaf];
}

export function marksAtNode(root: Element, node: Node | null): Marks {
    const chain: Element[] = [];
    let element = node instanceof Element ? node : node?.parentElement ?? null;
    for (; element && element !== root; element = element.parentElement) chain.unshift(element);
    return chain.reduce<Marks>((marks, current) => markFor(current, marks), {});
}

/** 游標所在程式碼區塊的語言，不在程式碼區塊裡時回傳 null。 */
export function codeFenceAtNode(root: Element, node: Node | null): string | null {
    const element = node instanceof Element ? node : node?.parentElement ?? null;
    const block = element?.closest("pre");
    return block && root.contains(block) ? block.dataset.language ?? "" : null;
}

/** 工具列要標示的區塊狀態，例如 h1、ul、blockquote、pre。 */
export function blockTagsAtNode(root: Element, node: Node | null): string[] {
    const tags: string[] = [];
    let element = node instanceof Element ? node : node?.parentElement ?? null;
    for (; element && element !== root; element = element.parentElement) {
        tags.push(element.tagName.toLowerCase());
    }
    return tags;
}
