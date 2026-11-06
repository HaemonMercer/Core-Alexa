import { highlight, TOKEN_COLORS } from "../components/code/highlight.ts";
import { fenceToLanguage } from "../components/code/languages.ts";
import { mediaUrl } from "../media.ts";
import { normalizeRuns, type Block, type Marks, type Run } from "./ast.ts";

// 文件模型與編輯區 DOM 之間的轉換。畫面只用 createElement 與文字節點建立，
// 筆記內容裡的 HTML 永遠只是文字。

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
            runs.push({ ...marks, text: node.textContent! });
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
