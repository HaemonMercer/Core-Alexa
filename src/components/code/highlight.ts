import { GRAMMARS, type Grammar } from "./grammars.ts";

// 語法上色只影響顯示，寫到一半或不合語法都不能出錯：
// 輸出的文字接起來一定等於輸入，文字位置才會和編輯器對齊。

export type TokenKind =
    | "plain" | "comment" | "string" | "number" | "keyword"
    | "literal" | "type" | "function" | "tag" | "attribute";

export interface Token {
    text: string;
    kind: TokenKind;
}

/** 畫布和編輯器共用，兩邊的顏色才會一樣。 */
export const TOKEN_COLORS: Record<TokenKind, string> = {
    plain: "#1f2328",
    comment: "#6e7781",
    string: "#0a3069",
    number: "#0550ae",
    keyword: "#cf222e",
    literal: "#0550ae",
    type: "#953800",
    function: "#8250df",
    tag: "#116329",
    attribute: "#0550ae",
};

const TAB = "    ";
const WORD = /[\p{L}_$][\p{L}\p{N}_$]*/u.source;

interface Compiled {
    pattern: RegExp;
    kinds: string[];
    keywords: Set<string>;
    literals: Set<string>;
    types: Set<string>;
}

const words = (list = "") => new Set(list.split(/\s+/).filter(Boolean));

const compiled = new Map<Grammar, Compiled>();

function compile(grammar: Grammar): Compiled {
    const cached = compiled.get(grammar);
    if (cached) return cached;

    const kinds = Object.keys(grammar.rules);
    const parts = Object.entries(grammar.rules).map(([kind, source]) => `(?<${kind}>${source})`);
    const result = {
        pattern: new RegExp([...parts, `(?<word>${WORD})`].join("|"), "gu"),
        kinds,
        keywords: words(grammar.keywords),
        literals: words(grammar.literals),
        types: words(grammar.types),
    };
    compiled.set(grammar, result);
    return result;
}

function isCall(text: string, from: number) {
    let index = from;
    while (text[index] === " ") index += 1;
    return text[index] === "(";
}

function wordKind(word: string, end: number, text: string, grammar: Grammar, tables: Compiled): TokenKind {
    const key = grammar.ignoreCase ? word.toLowerCase() : word;
    if (tables.keywords.has(key)) return "keyword";
    if (tables.literals.has(key)) return "literal";
    if (tables.types.has(key)) return "type";
    if (!grammar.noCalls && isCall(text, end)) return "function";
    return grammar.capitalizedTypes && /^\p{Lu}/u.test(word) ? "type" : "plain";
}

function highlightCode(text: string, grammar: Grammar): Token[] {
    const tables = compile(grammar);
    const tokens: Token[] = [];
    let cursor = 0;

    for (const match of text.matchAll(tables.pattern)) {
        const [value] = match;
        const end = match.index + value.length;
        if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), kind: "plain" });
        const kind = tables.kinds.find((name) => match.groups?.[name] !== undefined) as TokenKind | undefined;
        tokens.push({ text: value, kind: kind ?? wordKind(value, end, text, grammar, tables) });
        cursor = end;
    }
    if (cursor < text.length) tokens.push({ text: text.slice(cursor), kind: "plain" });
    return tokens;
}

const MARKUP = /<!--[^]*?(?:-->|(?![^]))|<![^>]*>?|<\/?[A-Za-z][^\s/>]*(?:"[^"]*"?|'[^']*'?|[^>"'])*>?/g;
const MARKUP_ATTRIBUTE = /("[^"]*"?|'[^']*'?)|[^\s=/<>"']+/g;

/** 標籤裡的文字才有引號和屬性，標籤外面都是一般內文。 */
function highlightTag(tag: string, tokens: Token[]) {
    if (tag.startsWith("<!")) {
        tokens.push({ text: tag, kind: "comment" });
        return;
    }
    const name = /^<\/?[^\s/>]*/.exec(tag)?.[0] ?? "";
    tokens.push({ text: name, kind: "tag" });

    let cursor = name.length;
    for (const match of tag.slice(name.length).matchAll(MARKUP_ATTRIBUTE)) {
        const start = name.length + match.index;
        if (start > cursor) tokens.push({ text: tag.slice(cursor, start), kind: "tag" });
        tokens.push({ text: match[0], kind: match[1] === undefined ? "attribute" : "string" });
        cursor = start + match[0].length;
    }
    if (cursor < tag.length) tokens.push({ text: tag.slice(cursor), kind: "tag" });
}

function highlightMarkup(text: string): Token[] {
    const tokens: Token[] = [];
    let cursor = 0;
    for (const match of text.matchAll(MARKUP)) {
        if (match.index > cursor) tokens.push({ text: text.slice(cursor, match.index), kind: "plain" });
        highlightTag(match[0], tokens);
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length) tokens.push({ text: text.slice(cursor), kind: "plain" });
    return tokens;
}

/** 不認得的語言（例如新版才有的）當成純文字。 */
export function highlight(text: string, language: string): Token[] {
    if (!text) return [];
    if (language === "html") return highlightMarkup(text);
    // 語言名稱是使用者寫的，`constructor` 這種字不能查到物件原型上。
    const known = Object.prototype.hasOwnProperty.call(GRAMMARS, language);
    return known ? highlightCode(text, GRAMMARS[language]) : [{ text, kind: "plain" }];
}

/** 畫布用的片段。fillText 把 Tab 畫成一個空格，要換成和 tab-size 一樣寬。 */
export function paintRuns(text: string, language: string) {
    return highlight(text, language).map((token) => ({
        text: token.text.replace(/\t/g, TAB),
        code: true,
        color: token.kind === "plain" ? undefined : TOKEN_COLORS[token.kind],
    }));
}
