// 執行方式：npm test（使用 Node 內建的測試工具，不需要額外套件）
import assert from "node:assert/strict";
import { test } from "node:test";
import { cardTitle, isNewCardTitle, noteHref, noteIDFromHref } from "../src/markdown/noteLink.ts";
import { parseInline, parseMarkdown } from "../src/markdown/parse.ts";
import { serializeMarkdown } from "../src/markdown/serialize.ts";

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

test("待辦和折疊項目用自己的符號，打勾的文字有刪除線", () => {
    assert.deepEqual(parseMarkdown("- [ ] a\n- [x] b\n- 一般"), [{
        type: "list",
        ordered: false,
        start: 1,
        items: [
            [{ type: "paragraph", runs: [{ text: "a" }] }],
            [{ type: "paragraph", runs: [{ text: "b", strike: true }] }],
            [{ type: "paragraph", runs: [{ text: "一般" }] }],
        ],
        markers: ["☐", "☑", null],
    }]);
});

test("收合的項目不顯示底下的內容", () => {
    const [open] = parseMarkdown("- ▾ 展開\n  - 子項目");
    const [closed] = parseMarkdown("- ▸ 收合\n  - 子項目");
    assert.equal(open.type === "list" && open.items[0].length, 2);
    assert.equal(closed.type === "list" && closed.items[0].length, 1);
});

test("表格的第一列是表頭，有分隔列才算表格", () => {
    assert.deepEqual(parseMarkdown("| a | **b**\\|c |\n| --- | :-: |\n| 1 |"), [{
        type: "table",
        rows: [
            [[{ text: "a" }], [{ text: "b", bold: true }, { text: "|c" }]],
            [[{ text: "1" }], []],
        ],
    }]);
    assert.equal(parseMarkdown("| a |\n| b |")[0].type, "paragraph");
});

test("卡片圖片帶著原始大小和寬度比例", () => {
    assert.deepEqual(parseMarkdown("![](media:ab.png?w=300&h=150&p=50)"), [
        { type: "image", file: "ab.png", width: 300, height: 150, percent: 50 },
    ]);
    assert.deepEqual(parseMarkdown("![](media:ab.png?w=300&h=150)")[0], { type: "image", file: "ab.png", width: 300, height: 150, percent: null });
});

test("待辦和圖片不會斷掉卡片標題", () => {
    assert.equal(cardTitle("![](media:ab.png?w=1&h=1)\n\n- [ ] 第一項"), "第一項");
});
