import assert from "node:assert/strict";
import { test } from "node:test";
import { indentLines, lineRange, newLineWithIndent } from "../src/components/code/editing.ts";
import { highlight, type TokenKind } from "../src/components/code/highlight.ts";
import { fitView } from "../src/components/mermaid/size.ts";
import { errorLine, TEMPLATES } from "../src/components/mermaid/templates.ts";

const kindsOf = (text: string, kind: TokenKind) =>
    highlight(text, "mermaid").filter((token) => token.kind === kind).map((token) => token.text);

/** 套用後的全文與選取範圍。 */
function apply(text: string, start: number, end: number, outdent: boolean) {
    const change = indentLines(text, start, end, outdent);
    if (!change) return null;
    const next = text.slice(0, change.from) + change.text + text.slice(change.to);
    return { text: next, selected: next.slice(change.selectionStart, change.selectionEnd) };
}

test("Tab 縮排選到的每一行，選取範圍跟著移動", () => {
    assert.deepEqual(apply("a\nb\nc", 0, 3, false), { text: "    a\n    b\nc", selected: "a\n    b" });
});

test("選取從行中間開始時整行都縮排", () => {
    assert.equal(apply("abc\ndef", 1, 5, false)?.text, "    abc\n    def");
});

test("選取到下一行開頭時，下一行不算選到", () => {
    assert.equal(apply("a\nb\nc", 0, 2, false)?.text, "    a\nb\nc");
});

test("Shift+Tab 移除一層縮排，縮排不足時有多少移多少", () => {
    assert.equal(apply("    a\n  b\nc\n\td", 0, 13, true)?.text, "a\nb\nc\nd");
    assert.equal(apply("        a", 0, 0, true)?.text, "    a");
});

test("Shift+Tab 時游標不會跑到行首之前", () => {
    const change = indentLines("x\n  a", 3, 3, true);
    assert.equal(change?.selectionStart, 2);
});

test("沒有縮排可以移除時不改內容", () => {
    assert.equal(indentLines("a\nb", 0, 3, true), null);
});

test("Enter 沿用目前這行的縮排", () => {
    assert.equal(newLineWithIndent("a\n    b", 7), "\n    ");
    assert.equal(newLineWithIndent("a", 1), "\n");
    // 游標在縮排中間時只沿用游標前面的部分。
    assert.equal(newLineWithIndent("    a", 2), "\n  ");
});

test("行的範圍，超出時回傳最後一行", () => {
    assert.deepEqual(lineRange("ab\ncd\n", 2), { start: 3, end: 5 });
    assert.deepEqual(lineRange("ab\ncd", 99), { start: 3, end: 5 });
    assert.deepEqual(lineRange("ab", 0), { start: 0, end: 2 });
});

test("Mermaid 的錯誤訊息取得行號", () => {
    assert.equal(errorLine("Parse error on line 3:\nflowchart\n-----^"), 3);
    assert.equal(errorLine("Lexical error on line 12. Unrecognized text."), 12);
    assert.equal(errorLine("No diagram type detected"), null);
});

test("Mermaid 的關鍵字、連線與註解", () => {
    assert.deepEqual(kindsOf("flowchart TD\n  A --> B", "keyword"), ["flowchart", "TD"]);
    assert.deepEqual(kindsOf("A --> B\nA -.-> B\nA ==> B\nA ->> B\nA <|-- B\nA ||--o{ B", "tag"),
        ["-->", "-.->", "==>", "->>", "<|--", "||--o{"]);
    assert.deepEqual(kindsOf("%% 註解 flowchart\nA", "comment"), ["%% 註解 flowchart"]);
    assert.deepEqual(kindsOf("stateDiagram-v2", "keyword"), ["stateDiagram-v2"]);
});

test("Mermaid 的括號是節點，不是函式呼叫；連線後的節點名稱不會被吃掉", () => {
    assert.deepEqual(kindsOf("A(文字)", "function"), []);
    assert.deepEqual(kindsOf("A-->xray", "tag"), ["-->"]);
    // 甘特圖的日期不是連線。
    assert.deepEqual(kindsOf("2026-01-01", "tag"), []);
});

test("範本的 id 不重複，也都有內容", () => {
    assert.equal(new Set(TEMPLATES.map(({ id }) => id)).size, TEMPLATES.length);
    for (const { source } of TEMPLATES) assert.ok(source.trim());
});

test("符合大小時圖要完整放進框內並置中，小圖不放大", () => {
    const big = fitView(400, 300, 800, 300);
    assert.ok(big.scale < 0.5);
    assert.ok(800 * big.scale <= 400);
    assert.equal(big.x, (400 - 800 * big.scale) / 2);

    const small = fitView(400, 300, 100, 50);
    assert.equal(small.scale, 1);
    assert.deepEqual([small.x, small.y], [150, 125]);
});
