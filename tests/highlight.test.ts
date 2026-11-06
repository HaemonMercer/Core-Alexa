import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBlocks, layoutCode } from "../src/components/canvas/noteLayout.ts";
import { highlight, paintRuns, TOKEN_COLORS, type TokenKind } from "../src/components/code/highlight.ts";
import {
    fenceToLanguage,
    LANGUAGES,
    languageLabel,
    languageToFence,
    noteLanguage,
    PLAIN_TEXT,
} from "../src/components/code/languages.ts";
import { parseMarkdown } from "../src/markdown/parse.ts";
import { noteTitle } from "../src/noteTypes.ts";
import type { Note } from "../src/types.ts";

const kindsOf = (text: string, language: string, kind: TokenKind) =>
    highlight(text, language).filter((token) => token.kind === kind).map((token) => token.text);

const note = (content: string, context = {}): Note =>
    ({ id: "a", type: "code", context, content, updatedAt: 0, createdAt: 0 });

test("每種語言輸出的文字接起來都等於原文，寫到一半也一樣", () => {
    const samples = [
        'const a = "未結束',
        "/* 沒有結束的註解\n第二行",
        "def f(x):\n    \"\"\"說明\n",
        'r#"raw\n',
        "<div class=\"a",
        "<!-- x",
        "'it''s",
        "a: 1\n- b: [x]\n",
        "$x = @{ a = 1 }\n",
        "\t縮排\r\n\n中文 123 0xff 1.5e3 @ # ` \\",
    ];
    for (const { id } of LANGUAGES) {
        for (const sample of samples) {
            assert.equal(highlight(sample, id).map((token) => token.text).join(""), sample, `${id}: ${sample}`);
        }
    }
});

test("空字串沒有任何片段", () => {
    assert.deepEqual(highlight("", "rust"), []);
});

test("不認得的語言和純文字都不上色", () => {
    assert.deepEqual(highlight("let a", "brainfuck"), [{ text: "let a", kind: "plain" }]);
    assert.deepEqual(highlight("let a", PLAIN_TEXT), [{ text: "let a", kind: "plain" }]);
});

test("圍欄裡像物件屬性的文字不會被當成語言", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
        assert.equal(fenceToLanguage(name), name.toLowerCase());
        assert.deepEqual(highlight("let a", name), [{ text: "let a", kind: "plain" }]);
    }
});

test("圍欄的常見寫法對應到語言", () => {
    assert.equal(fenceToLanguage("py"), "python");
    assert.equal(fenceToLanguage("TS"), "typescript");
    assert.equal(fenceToLanguage("c++"), "cpp");
    assert.equal(fenceToLanguage("js title=a.js"), "javascript");
    assert.equal(fenceToLanguage(""), PLAIN_TEXT);
    assert.equal(fenceToLanguage("dockerfile"), "dockerfile");
});

test("每個語言的 id 都是自己的圍欄寫法，純文字不寫語言", () => {
    for (const { id } of LANGUAGES) assert.equal(fenceToLanguage(languageToFence(id)), id);
    assert.equal(languageToFence(PLAIN_TEXT), "");
});

test("Tab 在畫布上換成四個空格，一般文字沿用預設顏色", () => {
    assert.deepEqual(paintRuns("\tif", "c"), [
        { text: "    ", code: true, color: undefined },
        { text: "if", code: true, color: TOKEN_COLORS.keyword },
    ]);
});

test("畫布上的 Markdown 程式碼區塊依圍欄的語言上色", () => {
    const ctx = {
        font: "",
        measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D;
    const colorOf = (source: string) => layoutBlocks(ctx, parseMarkdown(source), 400).commands
        .find((command) => command.kind === "text" && command.text.startsWith("fn"))?.color;

    assert.equal(colorOf("```rust\nfn a\n```"), TOKEN_COLORS.keyword);
    assert.equal(colorOf("```\nfn a\n```"), "#1f2328");
});

test("切換語言後同一段文字有不同的結果", () => {
    assert.deepEqual(kindsOf("def fn", "python", "keyword"), ["def"]);
    assert.deepEqual(kindsOf("def fn", "rust", "keyword"), ["fn"]);
});

test("字串和註解裡的關鍵字不算關鍵字", () => {
    assert.deepEqual(kindsOf('// return\nconst a = "if";', "javascript", "keyword"), ["const"]);
});

test("識別字裡的關鍵字和數字不會被切開", () => {
    assert.deepEqual(kindsOf("format2 = iffy", "python", "keyword"), []);
    assert.deepEqual(kindsOf("format2 = iffy", "python", "number"), []);
});

test("區塊註解和多行字串可以跨行", () => {
    assert.deepEqual(kindsOf("/* a\nb */ c", "c", "comment"), ["/* a\nb */"]);
    assert.deepEqual(kindsOf('x = """a\nb"""', "python", "string"), ['"""a\nb"""']);
});

test("Rust 的 raw string、生命週期與巨集", () => {
    assert.deepEqual(kindsOf('r#"a"b"#', "rust", "string"), ['r#"a"b"#']);
    assert.deepEqual(kindsOf("&'a str", "rust", "type"), ["'a", "str"]);
    assert.deepEqual(kindsOf("let c = 'x';", "rust", "string"), ["'x'"]);
    assert.deepEqual(kindsOf('println!("x")', "rust", "function"), ["println!"]);
});

test("SQL 的關鍵字不分大小寫", () => {
    assert.deepEqual(kindsOf("SELECT a from b", "sql", "keyword"), ["SELECT", "from"]);
});

test("函式呼叫和大寫型別", () => {
    assert.deepEqual(kindsOf("run(Value)", "typescript", "function"), ["run"]);
    assert.deepEqual(kindsOf("run(Value)", "typescript", "type"), ["Value"]);
});

test("JSON 的鍵和值是不同的顏色", () => {
    assert.deepEqual(kindsOf('{"a": "b", "c": 1}', "json", "attribute"), ['"a"', '"c"']);
    assert.deepEqual(kindsOf('{"a": "b", "c": 1}', "json", "string"), ['"b"']);
});

test("YAML 的鍵", () => {
    assert.deepEqual(kindsOf("a: 1\n- b: x\nurl: http://x\n", "yaml", "attribute"), ["a", "b", "url"]);
});

test("Bash 的 # 在單字中間不是註解", () => {
    assert.deepEqual(kindsOf("echo a#b # 註解", "bash", "comment"), ["# 註解"]);
});

test("HTML 只有標籤裡才有屬性和字串", () => {
    const text = '<a href="x">"內文"</a>';
    assert.deepEqual(kindsOf(text, "html", "attribute"), ["href"]);
    assert.deepEqual(kindsOf(text, "html", "string"), ['"x"']);
    assert.ok(kindsOf(text, "html", "plain").includes('"內文"'));
});

test("CSS 的屬性和選擇器的虛擬類別分得開", () => {
    assert.deepEqual(kindsOf("a:hover { color: #fff; }", "css", "attribute"), ["color"]);
    assert.deepEqual(kindsOf("a:hover { color: #fff; }", "css", "number"), ["#fff"]);
});

test("大量內容不會卡住", () => {
    const text = 'const a = "x"; // y\n'.repeat(20000);
    const start = performance.now();
    assert.ok(highlight(text, "typescript").length > 0);
    assert.ok(performance.now() - start < 2000);
});

test("沒有語言的筆記是純文字", () => {
    assert.equal(noteLanguage(note("x")), PLAIN_TEXT);
    assert.equal(noteLanguage(note("x", { language: "go" })), "go");
    assert.equal(languageLabel("cpp"), "C++");
    assert.equal(languageLabel("新語言"), "新語言");
});

test("Code Block 的標題是第一行有字的程式碼", () => {
    assert.equal(noteTitle(note("\n\n  fn main() {\n}")), "fn main() {");
    assert.equal(noteTitle(note("  \n")), "Code Block");
});

test("畫布上的程式碼每段保留自己的顏色，空白內容也有一行高", () => {
    const ctx = {
        font: "",
        measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D;

    const { commands, height } = layoutCode(ctx, [
        { text: "if", code: true, color: "#111111" },
        { text: " x\ny", code: true, color: "#222222" },
    ], 400);
    const texts = commands.filter((command) => command.kind === "text");
    assert.deepEqual(texts.map(({ text, color }) => [text, color]), [
        ["if", "#111111"], [" x", "#222222"], ["y", "#222222"],
    ]);
    assert.equal(height, 36);
    assert.equal(layoutCode(ctx, [], 400).height, 18);
});
