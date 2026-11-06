// 執行方式：npm test（使用 Node 內建的測試工具，不需要額外套件）
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardTitle, isNewCardTitle, noteHref, noteIDFromHref } from "../src/markdown/noteLink.ts";
import { parseInline, parseMarkdown } from "../src/markdown/parse.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";
import {
    applyInputRule,
    deleteSelection,
    insertNoteLink,
    mentionAtCaret,
    pasteMarkdown,
    pressBackspace,
    pressDelete,
    pressEnter,
    pressTab,
    selectedMarkdown,
    setCodeLanguage,
    setHeading,
    setLink,
    toggleCodeBlock,
    toggleList,
    toggleMark,
    toggleQuote,
    type Doc,
} from "../src/markdown/editing.ts";

const doc = (source: string, leaf = 0, offset = 0, focus?: [number, number]): Doc => ({
    blocks: parseMarkdown(source),
    selection: {
        anchor: { leaf, offset },
        focus: focus ? { leaf: focus[0], offset: focus[1] } : { leaf, offset },
    },
});
const md = (value: Doc) => serializeMarkdown(value.blocks);

test("行內語法", () => {
    assert.deepEqual(parseInline("**a** *b* ~~c~~ `d`"), [
        { text: "a", bold: true },
        { text: " " },
        { text: "b", italic: true },
        { text: " " },
        { text: "c", strike: true },
        { text: " " },
        { text: "d", code: true },
    ]);
    assert.deepEqual(parseInline("***a***"), [{ text: "a", bold: true, italic: true }]);
    assert.deepEqual(parseInline("[a **b**](http://x.y/(z))"), [
        { text: "a ", href: "http://x.y/(z)" },
        { text: "b", href: "http://x.y/(z)", bold: true },
    ]);
    assert.deepEqual(parseInline("2 * 3 * 4 snake_case_name \\*x\\*"), [
        { text: "2 * 3 * 4 snake_case_name *x*" },
    ]);
    assert.deepEqual(parseInline("`**x**`"), [{ text: "**x**", code: true }]);
    assert.deepEqual(parseInline("**未關閉"), [{ text: "**未關閉" }]);
});

test("區塊語法", () => {
    assert.deepEqual(parseMarkdown("# 標題\n\n段落一\n第二行\n\n---\n\n> 引言\n\n```js\nlet a;\n```"), [
        { type: "heading", level: 1, runs: [{ text: "標題" }] },
        { type: "paragraph", runs: [{ text: "段落一\n第二行" }] },
        { type: "rule" },
        { type: "quote", blocks: [{ type: "paragraph", runs: [{ text: "引言" }] }] },
        { type: "code", language: "js", text: "let a;" },
    ]);
    assert.deepEqual(parseMarkdown("- a\n  - b\n- c"), [{
        type: "list",
        ordered: false,
        start: 1,
        items: [
            [
                { type: "paragraph", runs: [{ text: "a" }] },
                {
                    type: "list",
                    ordered: false,
                    start: 1,
                    items: [[{ type: "paragraph", runs: [{ text: "b" }] }]],
                },
            ],
            [{ type: "paragraph", runs: [{ text: "c" }] }],
        ],
    }]);
});

test("序列化後內容不變", () => {
    const samples = [
        "",
        "純文字\n第二行",
        "2*3=6, a_b_c, 1 * 2 * 3",
        "# 標題\n\n## **粗**標題",
        "a\n\n\nb",
        "**粗** *斜* ~~刪~~ `碼` [連結](https://example.com)",
        "***粗斜***",
        "- 一\n- 二\n  - 巢狀\n    - 更深\n- 三",
        "1. 一\n2. 二\n   - 混合",
        "5. 從五開始\n6. 六",
        "> 引言\n>\n> - 清單\n>\n> ```\n> code\n> ```",
        "- 項目\n\n  第二段",
        "- 外層\n\n  5. 巢狀從五開始",
        "- 外層\n\n  -",
        "```ts\nconst a = `x`;\n\n```\n\n段落",
        "````\n```\n````",
        "---\n\n後文",
        "\\# 不是標題\n\\- 不是清單\n1\\. 不是編號\n\\---\n\\> 不是引言",
        "``a`b``",
        "\\*不是斜體\\*",
    ];
    for (const sample of samples) {
        assert.equal(serializeMarkdown(parseMarkdown(sample)), sample);
    }
});

test("結尾的空行存檔後還在", () => {
    for (const source of ["甲\n\n", "甲\n\n\n\n", "# 標題\n\n\n", "- 項目\n\n", "```\ncode\n```\n\n", "> 引言\n\n\n"]) {
        assert.equal(serializeMarkdown(parseMarkdown(source)), source);
    }
    assert.equal(parseMarkdown("甲\n\n\n").length, 3);
});

test("段落結尾的換行存成空段落", () => {
    assert.equal(serializeMarkdown([{ type: "paragraph", runs: [{ text: "甲\n" }] }]), "甲\n\n");
});

test("序列化會修正格式邊界的空白", () => {
    assert.equal(
        serializeMarkdown([{ type: "paragraph", runs: [{ text: "a ", bold: true }, { text: "b" }] }]),
        "**a** b",
    );
    assert.equal(
        serializeMarkdown([{ type: "paragraph", runs: [{ text: "粗", bold: true }, { text: "粗斜", bold: true, italic: true }] }]),
        "**粗*粗斜***",
    );
});

test("Enter", () => {
    assert.equal(md(pressEnter(doc("abcd", 0, 2))), "ab\n\ncd");
    assert.equal(md(pressEnter(doc("# 標題文字", 0, 2))), "# 標題\n\n文字");
    assert.equal(md(pressEnter(doc("# 標題", 0, 0))), "\n# 標題");
    assert.equal(pressEnter(doc("# 標題", 0, 0)).blocks[0].type, "paragraph");
    assert.equal(md(pressEnter(doc("- ab", 0, 1))), "- a\n- b");
    // 空項目按 Enter 離開清單
    assert.equal(md(pressEnter(doc("- a\n-", 1, 0))), "- a\n\n");
    assert.equal(pressEnter(doc("- a\n-", 1, 0)).blocks[1].type, "paragraph");
    assert.equal(md(pressEnter(doc("- a\n\n  -", 1, 0))), "- a\n-");
    assert.equal(md(pressEnter(doc("---", 0, 3))), "---\n\n");
    assert.equal(pressEnter(doc("```ts", 0, 5)).blocks[0].type, "code");
    assert.equal(md(pressEnter(doc("\\---", 0, 3))), "---\n\n");
});

test("程式碼區塊內的 Enter", () => {
    const first = pressEnter(doc("```\nab\n```", 0, 2));
    assert.deepEqual(first.selection.focus, { leaf: 0, offset: 3 });
    const second = pressEnter(first);
    assert.equal(md(second), "```\nab\n```\n\n");
    assert.equal(second.blocks[1].type, "paragraph");
    assert.deepEqual(second.selection.focus, { leaf: 1, offset: 0 });
});

test("Backspace 與 Delete", () => {
    assert.equal(md(pressBackspace(doc("a\n\nb", 1, 0))), "ab");
    assert.equal(pressBackspace(doc("# a", 0, 0)).blocks[0].type, "paragraph");
    assert.equal(md(pressBackspace(doc("- a\n- b", 1, 0))), "- a\n\nb");
    assert.equal(md(pressBackspace(doc("- a\n  - b", 1, 0))), "- a\n- b");
    assert.equal(md(pressBackspace(doc("> a", 0, 0))), "a");
    assert.equal(md(pressBackspace(doc("a\n\n---\n\nb", 2, 0))), "a\n\nb");
    assert.equal(md(pressDelete(doc("a\n\nb", 0, 1))), "ab");
    assert.equal(md(pressDelete(doc("a\n\n---\n\nb", 0, 1))), "a\n\nb");
    assert.equal(md(pressDelete(doc("a\n- b", 0, 1))), "ab");
});

test("跨區塊刪除", () => {
    const selected = doc("# 一二\n\n- 三四\n- 五六\n\n七八", 0, 1, [3, 1]);
    assert.equal(md(deleteSelection(selected)), "# 一八");
    assert.equal(md(deleteSelection(doc("a\n\nb", 0, 0, [1, 1]))), "");
    assert.deepEqual(deleteSelection(doc("# a\n\nb", 0, 0, [1, 1])).blocks, [{ type: "paragraph", runs: [] }]);
});

test("清單縮排", () => {
    const indented = pressTab(doc("- a\n- b\n- c", 1, 0), false);
    assert.equal(md(indented), "- a\n  - b\n- c");
    assert.equal(md(pressTab(indented, true)), "- a\n- b\n- c");
    assert.equal(md(pressTab(doc("- a\n  - b\n  - c", 1, 0), true)), "- a\n- b\n  - c");
    assert.equal(md(pressTab(doc("- a", 0, 0), false)), "- a");
});

test("打字規則", () => {
    assert.equal(md(applyInputRule(doc("\\# 文字", 0, 2))!), "# 文字");
    assert.equal(md(applyInputRule(doc("\\- ", 0, 2))!), "-");
    assert.equal(applyInputRule(doc("\\- ", 0, 2))!.blocks[0].type, "list");
    assert.equal(md(applyInputRule(doc("3\\. ", 0, 3))!), "3.");
    assert.equal(applyInputRule(doc("\\> ", 0, 2))!.blocks[0].type, "quote");

    const typed = (text: string) => {
        const blocks = [{ type: "paragraph" as const, runs: [{ text }] }];
        const point = { leaf: 0, offset: text.length };
        return applyInputRule({ blocks, selection: { anchor: point, focus: point } });
    };
    assert.equal(md(typed("前面 **粗體**")!), "前面 **粗體**");
    assert.equal(md(typed("*斜體*")!), "*斜體*");
    assert.equal(md(typed("***粗斜***")!), "***粗斜***");
    assert.equal(md(typed("~~刪除~~")!), "~~刪除~~");
    assert.equal(md(typed("`code`")!), "`code`");
    assert.equal(md(typed("[連結](https://a.b)")!), "[連結](https://a.b)");
    assert.equal(typed("**a*"), null);
    assert.equal(typed("snake_case_"), null);
    assert.equal(typed("* 項目*"), null);
    assert.deepEqual(typed("**粗**")!.selection.focus, { leaf: 0, offset: 1 });
    assert.deepEqual(typed("**粗**")!.pending, {});
});

test("格式切換", () => {
    const selected = doc("abcd", 0, 1, [0, 3]);
    assert.equal(md(toggleMark(selected, "bold", {})), "a**bc**d");
    assert.equal(md(toggleMark(doc("a**bc**d", 0, 1, [0, 3]), "bold", {})), "abcd");
    assert.equal(md(toggleMark(doc("a\n\nb", 0, 0, [1, 1]), "italic", {})), "*a*\n\n*b*");
    assert.deepEqual(toggleMark(doc("a", 0, 1), "bold", { italic: true }).pending, { italic: true, bold: true });
    assert.deepEqual(toggleMark(doc("a", 0, 1), "bold", { bold: true }).pending, {});
    assert.equal(md(setLink(doc("abc", 0, 0, [0, 3]), "https://a.b")), "[abc](https://a.b)");
    assert.equal(md(setLink(doc("[abc](https://a.b)", 0, 1), "")), "abc");
});

test("區塊切換", () => {
    assert.equal(md(setHeading(doc("a"), 2)), "## a");
    assert.equal(md(setHeading(doc("## a"), 2)), "a");
    assert.equal(md(toggleList(doc("a\n\nb", 0, 0, [1, 0]), false)), "- a\n- b");
    assert.equal(md(toggleList(doc("- a\n- b", 0, 0, [1, 0]), false)), "a\n\nb");
    assert.equal(md(toggleList(doc("- a\n- b", 0, 0, [1, 0]), true)), "1. a\n2. b");
    assert.equal(md(toggleQuote(doc("a\n\nb", 0, 0, [1, 0]))), "> a\n>\n> b");
    assert.equal(md(toggleQuote(doc("> a\n>\n> b", 0, 0, [1, 0]))), "a\n\nb");
    assert.equal(md(toggleCodeBlock(doc("a\n\nb", 0, 0, [1, 1]))), "```\na\nb\n```");
    assert.equal(md(toggleCodeBlock(doc("```\na\n```"))), "a");
});

test("切換程式碼區塊的語言", () => {
    const source = "```\na\n```";
    assert.equal(md(setCodeLanguage(doc(source), "rust")), "```rust\na\n```");
    assert.equal(md(setCodeLanguage(doc("```rust\na\n```"), "")), source);

    // 語言存在圍欄裡，存檔再讀回來還在。
    assert.deepEqual(parseMarkdown(md(setCodeLanguage(doc(source), "go"))), [
        { type: "code", language: "go", text: "a" },
    ]);
});

test("選取範圍跨區塊時只有程式碼區塊換語言，選取範圍不變", () => {
    const value = doc("```\na\n```\n\nb\n\n```py\nc\n```\n\n```\nd\n```", 0, 0, [2, 1]);
    const next = setCodeLanguage(value, "go");
    assert.equal(md(next), "```go\na\n```\n\nb\n\n```go\nc\n```\n\n```\nd\n```");
    assert.deepEqual(next.selection, value.selection);
    // 原本的文件要留著，復原才用得到。
    assert.equal(md(value), "```\na\n```\n\nb\n\n```py\nc\n```\n\n```\nd\n```");
});

test("貼上與複製", () => {
    assert.equal(md(pasteMarkdown(doc("ab", 0, 1), "**x**")), "a**x**b");
    assert.equal(md(pasteMarkdown(doc("ab", 0, 1), "# x\n\n- y")), "a\n\n# x\n\n- y\n\nb");
    assert.equal(md(pasteMarkdown(doc("", 0, 0), "# x\n\ny")), "# x\n\ny");
    assert.equal(md(pasteMarkdown(doc("```\nab\n```", 0, 1), "# x")), "```\na# xb\n```");
    assert.equal(selectedMarkdown(doc("a**bc**d", 0, 1, [0, 2])), "**b**");
    assert.equal(selectedMarkdown(doc("# 一二\n\n- 三\n- 四", 0, 1, [1, 1])), "# 二\n\n- 三");
});

test("輸入 [[ 時找出正在搜尋的文字", () => {
    assert.deepEqual(mentionAtCaret(doc("看 [[會議", 0, 6)), { leaf: 0, from: 2, query: "會議" });
    assert.deepEqual(mentionAtCaret(doc("[[", 0, 2)), { leaf: 0, from: 0, query: "" });
    assert.equal(mentionAtCaret(doc("看 [會議", 0, 5)), null);
    assert.equal(mentionAtCaret(doc("[[已結束]]", 0, 7)), null);
});

test("程式碼和既有連結裡的 [[ 不是卡片搜尋", () => {
    assert.equal(mentionAtCaret(doc("`[[a`", 0, 3)), null);
    assert.equal(mentionAtCaret(doc("```\n[[a\n```", 0, 3)), null);
    assert.equal(mentionAtCaret(doc("[[[a](https://x.y)", 0, 3)), null);
});

test("選取文字時不是卡片搜尋", () => {
    assert.equal(mentionAtCaret(doc("[[abc", 0, 2, [0, 5])), null);
});

test("選好卡片後換成連結，游標在連結之後", () => {
    const start = doc("看 [[會議 結論", 0, 6);
    const next = insertNoteLink(start, mentionAtCaret(start)!, "id-1", "週會紀錄");
    assert.equal(serializeMarkdown(next.blocks), "看 [週會紀錄](note:id-1) 結論");
    assert.deepEqual(next.selection.focus, { leaf: 0, offset: 6 });
    assert.deepEqual(next.pending, {});
});

test("卡片連結保留外層格式，標題裡的括號不會破壞語法", () => {
    const start = doc("**粗[[a**", 0, 5);
    const next = insertNoteLink(start, mentionAtCaret(start)!, "id-1", "[重要] 專案");
    const markdown = serializeMarkdown(next.blocks);
    const [block] = parseMarkdown(markdown);
    assert.ok(block.type === "paragraph");
    const link = block.runs.find((run) => run.href === "note:id-1");
    assert.equal(link?.text, "[重要] 專案");
    assert.equal(link?.bold, true);
});

test("卡片連結的網址可以來回轉換", () => {
    assert.equal(noteIDFromHref(noteHref("id-1")), "id-1");
    assert.equal(noteIDFromHref("https://example.com"), null);
});

test("卡片標題是第一行文字，不含 Markdown 記號", () => {
    assert.equal(cardTitle("# **週會** 紀錄\n內容"), "週會 紀錄");
    assert.equal(cardTitle("\n\n- 第一項\n- 第二項"), "第一項");
    assert.equal(cardTitle("> 引言\n"), "引言");
    assert.equal(cardTitle(""), "（空白卡片）");
    assert.equal(cardTitle("---"), "（空白卡片）");
    assert.equal(cardTitle("字".repeat(100)).length, 60);
});

test("打的文字不是現有卡片的標題時，才提供建立新卡片", () => {
    assert.equal(isNewCardTitle("ffas", ["ffgsd"]), true);
    assert.equal(isNewCardTitle(" FFGSD ", ["ffgsd"]), false);
    assert.equal(isNewCardTitle("   ", []), false);
    assert.equal(isNewCardTitle("", ["ffgsd"]), false);
});
