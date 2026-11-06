import { normalizeRuns, paragraph, type Block, type Marks, type Run } from "./ast.ts";

// 支援的語法：標題、段落、粗體、斜體、刪除線、行內程式碼、連結、
// 項目／編號清單（可巢狀）、待辦、折疊項目、引言、程式碼區塊、分隔線、表格、卡片圖片。
// 卡片的 Markdown 由 Rust 從區塊產生（`model/card_markdown.rs`），語法要和那邊一致。
// 便利貼的多行文字要照原樣顯示，所以段落內的單一換行就是換行。
// HTML 一律當成文字，畫面也只用 DOM API 建立，內容無法注入標籤。

const ESCAPABLE = /[!-/:-@[-`{-~]/;
const BLANK = /^[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))??(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:( +)(.*))?$/;
const MARKED_ITEM = /^(\[ \]|\[[xX]\]|▾|▸)(?: (.*))?$/s;
const IMAGE = /^!\[\]\(media:([^?\s)]+)\?w=(\d+)&h=(\d+)(?:&p=(\d+))?\)[ \t]*$/;

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char);
const isWordChar = (char: string | undefined) =>
    char !== undefined && /[\p{L}\p{N}]/u.test(char);

function runLength(source: string, index: number): number {
    let end = index;
    while (source[end] === source[index]) end += 1;
    return end - index;
}

function findCodeClose(source: string, from: number, length: number): number {
    for (let i = from; i < source.length; ) {
        if (source[i] !== "`") {
            i += 1;
            continue;
        }
        const run = runLength(source, i);
        if (run === length) return i;
        i += run;
    }
    return -1;
}

function findEmphasisClose(source: string, from: number, char: string, size: number): number {
    for (let i = from; i < source.length; ) {
        const current = source[i];
        if (current === "\\") {
            i += 2;
        } else if (current === "`") {
            const run = runLength(source, i);
            const close = findCodeClose(source, i + run, run);
            i = close >= 0 ? close + run : i + run;
        } else if (current === char) {
            const run = runLength(source, i);
            // 找單一 * 時要跳過成對的 **；連續符號取最後幾個，`***a***` 才能正確巢狀。
            if (run >= size && !(size === 1 && run === 2)) {
                const close = i + run - size;
                const validUnderscore = char !== "_" || !isWordChar(source[i + run]);
                if (close > from && !isSpace(source[close - 1]) && validUnderscore) return close;
            }
            i += run;
        } else {
            i += 1;
        }
    }
    return -1;
}

function matchLink(source: string, start: number) {
    let depth = 0;
    let i = start + 1;
    for (; i < source.length; i += 1) {
        const char = source[i];
        if (char === "\\") i += 1;
        else if (char === "[") depth += 1;
        else if (char === "]" && depth === 0) break;
        else if (char === "]") depth -= 1;
    }
    if (source[i + 1] !== "(") return null;
    const target = /^\(([^\s()]*(?:\([^\s()]*\)[^\s()]*)*)\)/.exec(source.slice(i + 1));
    if (!target) return null;
    return { label: source.slice(start + 1, i), href: target[1], end: i + 1 + target[0].length };
}

export function parseInline(source: string, marks: Marks = {}): Run[] {
    const runs: Run[] = [];
    let plain = "";
    const flush = () => {
        if (plain) runs.push({ ...marks, text: plain });
        plain = "";
    };

    for (let i = 0; i < source.length; ) {
        const char = source[i];

        if (char === "\\" && i + 1 < source.length && ESCAPABLE.test(source[i + 1])) {
            plain += source[i + 1];
            i += 2;
        } else if (char === "`") {
            const run = runLength(source, i);
            const close = findCodeClose(source, i + run, run);
            if (close < 0) {
                plain += source.slice(i, i + run);
                i += run;
                continue;
            }
            let text = source.slice(i + run, close);
            if (/^ .*[^ ].* $|^ [^ ]+ $/s.test(text)) text = text.slice(1, -1);
            flush();
            runs.push({ ...marks, text, code: true });
            i = close + run;
        } else if (char === "[") {
            const link = matchLink(source, i);
            if (!link) {
                plain += char;
                i += 1;
                continue;
            }
            flush();
            runs.push(...parseInline(link.label, { ...marks, href: link.href }));
            i = link.end;
        } else if (char === "*" || char === "_" || char === "~") {
            const run = runLength(source, i);
            const sizes = char === "~" ? [2] : [2, 1];
            let matched = false;

            for (const size of sizes) {
                if (run < size) continue;
                const opensWord = char === "_" && isWordChar(source[i - 1]);
                if (opensWord || isSpace(source[i + size])) continue;
                const close = findEmphasisClose(source, i + size, char, size);
                if (close < 0) continue;

                const key = char === "~" ? "strike" : size === 2 ? "bold" : "italic";
                flush();
                runs.push(...parseInline(source.slice(i + size, close), { ...marks, [key]: true }));
                i = close + size;
                matched = true;
                break;
            }

            if (!matched) {
                plain += source.slice(i, i + run);
                i += run;
            }
        } else {
            plain += char;
            i += 1;
        }
    }

    flush();
    return normalizeRuns(runs);
}

const expandTabs = (line: string) =>
    line.replace(/^[ \t]+/, (indent) => indent.replace(/\t/g, "    "));

const indentOf = (line: string) => /^ */.exec(line)![0].length;

const isOrdered = (marker: string) => /\d/.test(marker);

function tableCells(line: string): string[] {
    const body = line.trim().replace(/^\|/, "");
    const cells: string[] = [];
    let cell = "";
    for (let i = 0; i < body.length; i += 1) {
        if (body[i] === "\\" && body[i + 1] === "|") {
            cell += "|";
            i += 1;
        } else if (body[i] === "|") {
            cells.push(cell.trim());
            cell = "";
        } else {
            cell += body[i];
        }
    }
    if (cell.trim()) cells.push(cell.trim());
    return cells;
}

const isTableDivider = (line: string) =>
    line.trim().startsWith("|") && tableCells(line).length > 0 && tableCells(line).every((cell) => /^:?-+:?$/.test(cell));

const tableStarts = (lines: string[], index: number) =>
    lines[index].trim().startsWith("|") && index + 1 < lines.length && isTableDivider(lines[index + 1]);

function startsBlock(lines: string[], index: number): boolean {
    const line = lines[index];
    if (HEADING.test(line) || FENCE.test(line) || RULE.test(line) || QUOTE.test(line) || IMAGE.test(line)) return true;
    if (tableStarts(lines, index)) return true;
    // 空項目與非 1 開頭的編號不打斷段落，一般文字才不會意外變成清單。
    const item = ITEM.exec(line);
    if (!item || !item[4]) return false;
    return !isOrdered(item[2]) || parseInt(item[2], 10) === 1;
}

function parseList(lines: string[], start: number): { block: Block; next: number } {
    const first = ITEM.exec(lines[start])!;
    const ordered = isOrdered(first[2]);
    const items: Block[][] = [];
    const markers: (string | null)[] = [];
    let i = start;

    const continues = (line: string, width: number) => {
        const indent = indentOf(line);
        return indent >= width || (indent >= 2 && ITEM.test(line.slice(indent)));
    };

    while (i < lines.length) {
        const item = ITEM.exec(lines[i]);
        if (!item || RULE.test(lines[i]) || isOrdered(item[2]) !== ordered) break;

        const spaces = item[3]?.length ?? 1;
        const width = item[1].length + item[2].length + (spaces > 4 ? 1 : spaces);
        const body = [item[3] && spaces > 4 ? item[3].slice(1) + item[4] : item[4] ?? ""];
        i += 1;

        while (i < lines.length) {
            let next = i;
            while (next < lines.length && BLANK.test(lines[next])) next += 1;
            if (next === lines.length) break;

            const line = expandTabs(lines[next]);
            if (!continues(line, width)) break;
            for (let blank = i; blank < next; blank += 1) body.push("");
            body.push(line.slice(Math.min(indentOf(line), width)));
            i = next + 1;
        }
        const marked = ordered ? null : MARKED_ITEM.exec(body[0]);
        if (marked) body[0] = marked[2] ?? "";
        const blocks = parseBlocks(body);
        const mark = marked?.[1].toLowerCase();
        const first = blocks[0];
        if (mark === "[x]" && first?.type === "paragraph") {
            blocks[0] = paragraph(first.runs.map((run) => ({ ...run, strike: true })));
        }
        // 收合的項目底下的內容不顯示。
        items.push(mark === "▸" ? blocks.slice(0, 1) : blocks);
        markers.push(mark === undefined ? null : mark === "[ ]" ? "☐" : mark === "[x]" ? "☑" : mark);

        // 項目之間的空行不結束清單。
        let next = i;
        while (next < lines.length && BLANK.test(lines[next])) next += 1;
        const following = next < lines.length ? ITEM.exec(lines[next]) : null;
        if (!following || RULE.test(lines[next]) || isOrdered(following[2]) !== ordered) break;
        i = next;
    }

    const startNumber = ordered ? parseInt(first[2], 10) : 1;
    const block: Block = { type: "list", ordered, start: startNumber, items };
    if (markers.some(Boolean)) block.markers = markers;
    return { block, next: i };
}

function parseBlocks(lines: string[]): Block[] {
    const blocks: Block[] = [];

    for (let i = 0; i < lines.length; ) {
        const line = lines[i];

        if (BLANK.test(line)) {
            // 區塊之間固定一個空行，多出來的空行保留成空段落，編輯時留的空白才不會消失。
            let count = 0;
            while (i < lines.length && BLANK.test(lines[i])) {
                count += 1;
                i += 1;
            }
            const empty = blocks.length === 0 ? count : count - 1;
            for (let n = 0; n < empty; n += 1) blocks.push(paragraph());
            continue;
        }

        const fence = FENCE.exec(line);
        if (fence) {
            const marker = fence[1];
            const close = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
            const body: string[] = [];
            i += 1;
            while (i < lines.length && !close.test(lines[i])) {
                body.push(lines[i]);
                i += 1;
            }
            i += 1;
            blocks.push({ type: "code", language: fence[2], text: body.join("\n") });
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            blocks.push({
                type: "heading",
                level: heading[1].length,
                runs: parseInline(heading[2] ?? ""),
            });
            i += 1;
            continue;
        }

        if (RULE.test(line)) {
            blocks.push({ type: "rule" });
            i += 1;
            continue;
        }

        if (QUOTE.test(line)) {
            const body: string[] = [];
            while (i < lines.length && QUOTE.test(lines[i])) {
                body.push(lines[i].replace(QUOTE, ""));
                i += 1;
            }
            blocks.push({ type: "quote", blocks: parseBlocks(body) });
            continue;
        }

        if (ITEM.test(line)) {
            const { block, next } = parseList(lines, i);
            blocks.push(block);
            i = next;
            continue;
        }

        if (tableStarts(lines, i)) {
            const rows = [tableCells(line)];
            i += 2;
            while (i < lines.length && lines[i].trim().startsWith("|")) {
                rows.push(tableCells(lines[i]));
                i += 1;
            }
            const width = Math.max(...rows.map((row) => row.length));
            blocks.push({
                type: "table",
                rows: rows.map((row) => Array.from({ length: width }, (_, column) => parseInline(row[column] ?? ""))),
            });
            continue;
        }

        const image = IMAGE.exec(line);
        if (image) {
            blocks.push({
                type: "image",
                file: image[1],
                width: Number(image[2]),
                height: Number(image[3]),
                percent: image[4] ? Number(image[4]) : null,
            });
            i += 1;
            continue;
        }

        const body = [line];
        i += 1;
        while (i < lines.length && !BLANK.test(lines[i]) && !startsBlock(lines, i)) {
            body.push(lines[i]);
            i += 1;
        }
        blocks.push(paragraph(parseInline(body.join("\n"))));
    }

    return blocks;
}

export function parseMarkdown(source: string): Block[] {
    return parseBlocks(source.replace(/\r\n?/g, "\n").split("\n"));
}
