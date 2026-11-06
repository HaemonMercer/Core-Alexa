// 各語言的文法。規則依序比對，寫在前面的優先；沒有被規則接走的單字才查關鍵字表。
// 這裡只求顯示，遇到需要完整剖析才分得出來的語法（例如 JavaScript 的 regex）就當成一般文字。
// 所有 regex 都會用 `u` 旗標組合，不能有 `\"` 這種多餘的跳脫。

export interface Grammar {
    /** 種類對應 regex 原始碼。同一種類只能出現一次，多個寫法用 `|` 接起來。 */
    rules: Record<string, string>;
    keywords?: string;
    literals?: string;
    types?: string;
    /** 大寫開頭的單字當成型別。 */
    capitalizedTypes?: boolean;
    /** 關鍵字表要全部小寫。 */
    ignoreCase?: boolean;
    /** 括號不代表函式呼叫，例如 Mermaid 的 `A(文字)` 是節點。 */
    noCalls?: boolean;
}

const END = /(?![^])/.source;
const DOUBLE = /"(?:[^"\\\n]|\\[^])*"?/.source;
const SINGLE = /'(?:[^'\\\n]|\\[^])*'?/.source;
const BACKTICK = /`(?:[^`\\]|\\[^])*`?/.source;
const BLOCK_COMMENT = `/\\*[^]*?(?:\\*/|${END})`;
const SLASH_COMMENT = `//[^\\n]*|${BLOCK_COMMENT}`;
/** `#` 在單字中間不是註解，例如網址的片段。 */
const HASH_COMMENT = /(?<![^\s])#[^\n]*/.source;
const NUMBER = /0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?[A-Za-z]*/.source;
const C_PREPROCESSOR = /(?<![^\n])[ \t]*#[ \t]*\w+/.source;
/** 名稱後面的冒號要在這一行的 `{` 之前，`a:hover {` 才不會被當成屬性。 */
const CSS_PROPERTY = /-{0,2}[A-Za-z][\w-]*(?=\s*:[^{};\n]*(?:[;}\n]|(?![^])))/.source;

const C_KEYWORDS = `auto break case const continue default do else enum extern for goto if inline
    register restrict return sizeof static struct switch typedef union volatile while`;
const C_TYPES = `bool char double float int long short signed unsigned void size_t
    int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t`;

const JS_KEYWORDS = `as async await break case catch class const continue debugger default delete do else
    export extends finally for from function get if import in instanceof let new of return set static
    super switch this throw try typeof var void while with yield`;

const javascript: Grammar = {
    rules: { comment: SLASH_COMMENT, string: `${DOUBLE}|${SINGLE}|${BACKTICK}`, number: NUMBER },
    keywords: JS_KEYWORDS,
    literals: "true false null undefined NaN Infinity",
    capitalizedTypes: true,
};

export const GRAMMARS: Record<string, Grammar> = {
    javascript,
    typescript: {
        ...javascript,
        keywords: `${JS_KEYWORDS} abstract declare enum implements infer interface is keyof module
            namespace override private protected public readonly satisfies type`,
        types: "any bigint boolean never number object string symbol unknown",
    },
    python: {
        rules: {
            comment: HASH_COMMENT,
            string: `[rRbBfFuU]{0,2}(?:"""[^]*?(?:"""|${END})|'''[^]*?(?:'''|${END})|${DOUBLE}|${SINGLE})`,
            attribute: /@[\w.]+/.source,
            number: NUMBER,
        },
        keywords: `and as assert async await break class continue def del elif else except finally for from
            global if import in is lambda match nonlocal not or pass raise return try while with yield`,
        literals: "True False None self cls",
        types: "bool bytes dict float frozenset int list object set str tuple",
        capitalizedTypes: true,
    },
    rust: {
        rules: {
            comment: SLASH_COMMENT,
            string: `b?r(?<hashes>#*)"[^]*?(?:"\\k<hashes>|${END})|b?${DOUBLE}|${/b?'(?:[^'\\\n]|\\[^\n]{1,10}?)'/.source}`,
            type: /'[A-Za-z_]\w*/.source,
            attribute: /#!?\[[^\]\n]*\]?/.source,
            function: /[A-Za-z_]\w*!/.source,
            number: NUMBER,
        },
        keywords: `as async await break const continue crate dyn else enum extern fn for if impl in let loop
            match mod move mut pub ref return self Self static struct super trait type unsafe use where while`,
        literals: "true false None Some Ok Err",
        types: "bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize",
        capitalizedTypes: true,
    },
    go: {
        rules: { comment: SLASH_COMMENT, string: `${DOUBLE}|${SINGLE}|${BACKTICK}`, number: NUMBER },
        keywords: `break case chan const continue default defer else fallthrough for func go goto if import
            interface map package range return select struct switch type var`,
        literals: "true false nil iota",
        types: `any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64
            rune string uint uint8 uint16 uint32 uint64 uintptr`,
    },
    java: {
        rules: {
            comment: SLASH_COMMENT,
            string: `"""[^]*?(?:"""|${END})|${DOUBLE}|${SINGLE}`,
            attribute: /@\w+/.source,
            number: NUMBER,
        },
        keywords: `abstract assert break case catch class const continue default do else enum extends final
            finally for goto if implements import instanceof interface native new package private protected
            public record return static strictfp super switch synchronized this throw throws transient try
            var void volatile while yield`,
        literals: "true false null",
        types: "boolean byte char double float int long short",
        capitalizedTypes: true,
    },
    c: {
        rules: { comment: SLASH_COMMENT, string: `${DOUBLE}|${SINGLE}`, keyword: C_PREPROCESSOR, number: NUMBER },
        keywords: C_KEYWORDS,
        literals: "true false NULL",
        types: C_TYPES,
    },
    cpp: {
        rules: { comment: SLASH_COMMENT, string: `${DOUBLE}|${SINGLE}`, keyword: C_PREPROCESSOR, number: NUMBER },
        keywords: `${C_KEYWORDS} alignas alignof catch class concept consteval constexpr constinit co_await
            co_return co_yield decltype delete dynamic_cast explicit export final friend mutable namespace new
            noexcept operator override private protected public reinterpret_cast requires static_assert
            static_cast template this throw try typeid typename using virtual`,
        literals: "true false nullptr NULL",
        types: `${C_TYPES} wchar_t char8_t char16_t char32_t string vector map set`,
        capitalizedTypes: true,
    },
    csharp: {
        rules: {
            comment: SLASH_COMMENT,
            string: `@"(?:[^"]|"")*"?|\\$?${DOUBLE}|${SINGLE}`,
            attribute: /(?<![^\s])\[\w[^\]\n]*\]/.source,
            number: NUMBER,
        },
        keywords: `abstract as async await base break case catch checked class const continue default delegate
            do else enum event explicit extern finally fixed for foreach get goto if implicit in interface
            internal is lock namespace new operator out override params partial private protected public
            readonly record ref return sealed set sizeof static struct switch this throw try typeof unchecked
            unsafe using var virtual void volatile when where while yield`,
        literals: "true false null",
        types: "bool byte char decimal double dynamic float int long object sbyte short string uint ulong ushort",
        capitalizedTypes: true,
    },
    css: {
        rules: {
            comment: BLOCK_COMMENT,
            string: `${DOUBLE}|${SINGLE}`,
            keyword: /@[\w-]+/.source,
            attribute: CSS_PROPERTY,
            number: /#[\da-fA-F]{3,8}\b|\d*\.?\d+(?:%|[A-Za-z]+)?/.source,
        },
        literals: "inherit initial unset none auto",
    },
    json: {
        rules: {
            attribute: `${DOUBLE}(?=\\s*:)`,
            string: DOUBLE,
            number: /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.source,
        },
        literals: "true false null",
    },
    yaml: {
        rules: {
            comment: HASH_COMMENT,
            attribute: /(?<=(?:^|\n)[ \t-]*)[^\s#:"'-][^\n:#]*(?=:(?:\s|(?![^])))/.source,
            string: `${DOUBLE}|${SINGLE}`,
            number: /(?<![\w.-])-?\d+(?:\.\d+)?(?![\w.-])/.source,
        },
        literals: "true false null yes no on off",
    },
    sql: {
        rules: {
            comment: `--[^\\n]*|${BLOCK_COMMENT}`,
            string: `'(?:[^']|'')*'?|${DOUBLE}`,
            number: NUMBER,
        },
        keywords: `add all alter and as asc begin between by case check column commit constraint create cross
            database default delete desc distinct drop else end exists foreign from full group having if in
            index inner insert intersect into is join key left like limit not offset on or order outer primary
            references replace returning right rollback select set table then transaction trigger union unique
            update values view when where with`,
        literals: "null true false",
        types: `bigint binary bit blob boolean char date datetime decimal double float int integer json numeric
            real smallint text time timestamp tinyint varchar`,
        ignoreCase: true,
    },
    bash: {
        rules: {
            comment: HASH_COMMENT,
            string: `${DOUBLE}|'[^']*'?`,
            attribute: /\$\{[^}\n]*\}?|\$[\w@#?*!$-]\w*/.source,
            number: /(?<![\w.-])\d+(?![\w.-])/.source,
        },
        keywords: `case do done elif else esac export fi for function if in local readonly return select shift
            then trap unset until while`,
        literals: "true false",
    },
    mermaid: {
        rules: {
            comment: /%%[^\n]*/.source,
            string: DOUBLE,
            keyword: /stateDiagram-v2/.source,
            // 各種連線：-->、---、-.->、==>、->>、<|--、||--o{。
            tag: /[<*ox|}]{0,3}(?:-{2,}|={2,}|\.{2,}|-\.+-)(?:[ox](?=[\s{|]))?[>*|{]{0,3}|-{1,2}(?:>>|>|x\b|\))/.source,
            number: NUMBER,
        },
        keywords: `graph flowchart subgraph end direction TB TD BT RL LR sequenceDiagram participant actor
            activate deactivate autonumber note Note over loop alt else opt par and rect critical break
            classDiagram class namespace stateDiagram state erDiagram gantt title dateFormat axisFormat section
            pie mindmap root timeline journey gitGraph commit branch checkout merge
            style classDef linkStyle click as of left right`,
        noCalls: true,
    },
    powershell: {
        rules: {
            comment: `<#[^]*?(?:#>|${END})|${HASH_COMMENT}`,
            string: `@"[^]*?(?:"@|${END})|@'[^]*?(?:'@|${END})|${DOUBLE}|'(?:[^']|'')*'?`,
            attribute: /\$[\w:]+|\$\{[^}\n]*\}?/.source,
            type: /\[[A-Za-z_][\w.]*(?:\[\])?\]/.source,
            keyword: /(?<![\w-])-[A-Za-z]+/.source,
            number: NUMBER,
        },
        keywords: `begin break catch class continue data default do dynamicparam else elseif end enum exit filter
            finally for foreach from function if in param process return switch throw trap try until using
            var while workflow`,
        ignoreCase: true,
    },
};
