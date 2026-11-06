// 文字編輯的計算，不碰 DOM。

export const INDENT = "    ";

export interface Replacement {
    /** 要取代的範圍。 */
    from: number;
    to: number;
    text: string;
    /** 取代後的選取範圍。 */
    selectionStart: number;
    selectionEnd: number;
}

const lineStart = (text: string, offset: number) => text.lastIndexOf("\n", offset - 1) + 1;

function lineEnd(text: string, offset: number) {
    const end = text.indexOf("\n", offset);
    return end === -1 ? text.length : end;
}

function removeIndent(line: string) {
    if (line.startsWith("\t")) return line.slice(1);
    return line.slice(/^ {0,4}/.exec(line)![0].length);
}

/**
 * Tab 與 Shift+Tab 作用在選取到的每一行。選取到下一行開頭時，下一行不算選到。
 * 回傳 null 表示沒有東西要改。
 */
export function indentLines(text: string, start: number, end: number, outdent: boolean): Replacement | null {
    const from = lineStart(text, start);
    const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const to = lineEnd(text, last);

    const before = text.slice(from, to).split("\n");
    const after = before.map((line) => (outdent ? removeIndent(line) : INDENT + line));
    const replaced = after.join("\n");
    if (replaced === text.slice(from, to)) return null;

    const firstShift = after[0].length - before[0].length;
    return {
        from,
        to,
        text: replaced,
        selectionStart: Math.max(from, start + firstShift),
        selectionEnd: Math.max(from, end + replaced.length - (to - from)),
    };
}

/** 按 Enter 時要插入的文字：新的一行沿用目前這行的縮排。 */
export function newLineWithIndent(text: string, offset: number) {
    const line = text.slice(lineStart(text, offset), offset);
    return `\n${/^[ \t]*/.exec(line)![0]}`;
}

/** 第 `line` 行（從 1 算起）的範圍。超過最後一行時回傳最後一行。 */
export function lineRange(text: string, line: number) {
    const lines = text.split("\n");
    const index = Math.min(Math.max(line, 1), lines.length) - 1;
    const start = lines.slice(0, index).reduce((total, current) => total + current.length + 1, 0);
    return { start, end: start + lines[index].length };
}
