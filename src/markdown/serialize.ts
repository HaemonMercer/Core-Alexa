import {
    marksOf,
    normalizeRuns,
    paragraph,
    runsText,
    sameMarks,
    type Block,
    type Marks,
    type Run,
} from "./ast.ts";
import { parseInline } from "./parse.ts";

const OPEN: Record<string, string> = { bold: "**", italic: "*", strike: "~~" };

const escapeBackslashes = (text: string) => text.replace(/\\(?=[!-/:-@[-`{-~])/g, "\\\\");
const escapeSyntax = (text: string) => text.replace(/[\\`*_~[\]]/g, "\\$&");

function intersectMarks(a: Marks | undefined, b: Marks | undefined): Marks {
    if (!a || !b) return {};
    const marks: Marks = {};
    if (a.bold && b.bold) marks.bold = true;
    if (a.italic && b.italic) marks.italic = true;
    if (a.strike && b.strike) marks.strike = true;
    if (a.href !== undefined && a.href === b.href) marks.href = a.href;
    return marks;
}

/** `**a **b` 不是合法語法，格式邊界上的空白要移到記號外面。 */
function moveEdgeSpaceOut(runs: Run[]): Run[] {
    const pieces: Run[] = [];
    for (const run of runs) {
        if (run.code) {
            pieces.push(run);
            continue;
        }
        const [, lead, core, trail] = /^(\s*)(.*?)(\s*)$/s.exec(run.text)!;
        for (const text of [lead, core, trail]) {
            if (text) pieces.push({ ...run, text });
        }
    }

    const isSpacePiece = (run: Run) => !run.code && !run.text.trim();
    const neighbour = (index: number, step: number) => {
        for (let i = index + step; i >= 0 && i < pieces.length; i += step) {
            if (!isSpacePiece(pieces[i])) return pieces[i];
        }
        return undefined;
    };

    return normalizeRuns(pieces.map((run, index) =>
        isSpacePiece(run)
            ? { ...intersectMarks(neighbour(index, -1), neighbour(index, 1)), text: run.text }
            : run,
    ));
}

function dropTrailingBreaks(runs: Run[]): Run[] {
    const trimmed = runs.map((run) => ({ ...run }));
    while (trimmed.length > 0) {
        const last = trimmed[trimmed.length - 1];
        last.text = last.text.replace(/\n+$/, "");
        if (last.text) break;
        trimmed.pop();
    }
    return trimmed;
}

function codeSpan(text: string): string {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longest + 1);
    const pad = text.startsWith("`") || text.endsWith("`") || /^ .* $/s.test(text) ? " " : "";
    return `${fence}${pad}${text}${pad}${fence}`;
}

const markKeys = (run: Run): string[] => [
    ...(run.bold ? ["bold"] : []),
    ...(run.italic ? ["italic"] : []),
    ...(run.strike ? ["strike"] : []),
    ...(run.href !== undefined ? [`href:${run.href}`] : []),
];

const encodeHref = (href: string) =>
    href.replace(/[\s()]/g, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`);

function renderRuns(runs: Run[], escapeText: (text: string) => string): string {
    const stack: string[] = [];
    let output = "";

    const close = (count: number) => {
        while (stack.length > count) {
            const key = stack.pop()!;
            output += key.startsWith("href:") ? `](${encodeHref(key.slice(5))})` : OPEN[key];
        }
    };

    runs.forEach((run, index) => {
        const wanted = markKeys(run);
        let keep = 0;
        while (keep < stack.length && wanted.includes(stack[keep])) keep += 1;
        close(keep);

        // 延伸最遠的格式放外層，才能少關閉再重開。
        const reach = (key: string) => {
            let end = index;
            while (end < runs.length && markKeys(runs[end]).includes(key)) end += 1;
            return end;
        };
        const opening = wanted
            .filter((key) => !stack.includes(key))
            .sort((a, b) => reach(b) - reach(a));
        for (const key of opening) {
            stack.push(key);
            output += key.startsWith("href:") ? "[" : OPEN[key];
        }

        output += run.code ? codeSpan(run.text) : escapeText(run.text);
    });

    close(0);
    return output;
}

export function serializeInline(runs: Run[]): string {
    const clean = moveEdgeSpaceOut(normalizeRuns(dropTrailingBreaks(runs)));
    // 先試最少的跳脫，文字裡的 `2*3` 才不會存成 `2\*3`；解析結果不符時才全部跳脫。
    const simple = renderRuns(clean, escapeBackslashes);
    const reparsed = parseInline(simple);
    const matches = reparsed.length === clean.length && reparsed.every((run, index) =>
        run.text === clean[index].text && sameMarks(marksOf(run), marksOf(clean[index])));
    return matches ? simple : renderRuns(clean, escapeSyntax);
}

/** 行首的文字若長得像區塊語法，要跳脫才不會在重新開啟時變成標題或清單。 */
function escapeLineStarts(text: string): string {
    return text.split("\n").map((line) => {
        if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) return `\\${line}`;
        return line
            .replace(/^( {0,3})(#{1,6}(?:[ \t]|$)|>|[-+*](?:[ \t]|$)|```|~~~)/, "$1\\$2")
            .replace(/^( {0,3}\d{1,9})([.)](?:[ \t]|$))/, "$1\\$2");
    }).join("\n");
}

const isEmptyParagraph = (block: Block) => block.type === "paragraph" && block.runs.length === 0;

/** 空項目和非 1 開頭的編號不會打斷段落，巢狀時前面要留空行。 */
function canFollowTextDirectly(block: Block): boolean {
    if (block.type !== "list") return false;
    const first = block.items[0]?.[0];
    return first !== undefined && !isEmptyParagraph(first) && (!block.ordered || block.start === 1);
}

function joinBlocks(blocks: Block[], tight: boolean): string {
    let output = "";
    blocks.forEach((block, index) => {
        if (index > 0) {
            const compact = isEmptyParagraph(blocks[index - 1]) || (tight && canFollowTextDirectly(block));
            output += compact ? "\n" : "\n\n";
        }
        output += serializeBlock(block);
    });
    return output;
}

function serializeList(block: Extract<Block, { type: "list" }>): string {
    return block.items.map((item, index) => {
        const marker = block.ordered ? `${block.start + index}.` : "-";
        const body = joinBlocks(item, true);
        if (!body) return marker;
        const indent = " ".repeat(marker.length + 1);
        return `${marker} ${body.replace(/\n(?=[^\n])/g, `\n${indent}`)}`;
    }).join("\n");
}

function serializeBlock(block: Block): string {
    switch (block.type) {
        case "paragraph":
            return escapeLineStarts(serializeInline(block.runs));
        case "heading": {
            const text = serializeInline(block.runs).replace(/\n/g, " ");
            return `${"#".repeat(block.level)} ${text}`.trimEnd();
        }
        case "code": {
            const longest = Math.max(2, ...(block.text.match(/`+/g) ?? []).map((run) => run.length));
            const fence = "`".repeat(longest + 1);
            return `${fence}${block.language}\n${block.text}\n${fence}`;
        }
        case "rule":
            return "---";
        case "quote":
            return joinBlocks(block.blocks, false)
                .split("\n")
                .map((line) => (line ? `> ${line}` : ">"))
                .join("\n");
        case "list":
            return serializeList(block);
        // 表格和圖片只來自 Writer 區塊，內容由 Rust 產生，不會走到這裡。
        case "table":
        case "image":
            return "";
    }
}

/** 結尾的空行也是內容。區塊結尾的換行要改存成空段落，重新開啟時才還在。 */
export function serializeMarkdown(blocks: Block[]): string {
    const last = blocks[blocks.length - 1];
    const breaks = last && "runs" in last ? /\n*$/.exec(runsText(last.runs))![0].length : 0;
    return joinBlocks([...blocks, ...Array.from({ length: breaks }, () => paragraph())], false);
}
