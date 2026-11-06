import type { Note } from "../../types.ts";

export const PLAIN_TEXT = "plaintext";

/** 語言切換選單的項目，`id` 就是存進 `context.language` 的值。 */
export const LANGUAGES = [
    { id: PLAIN_TEXT, label: "純文字" },
    { id: "javascript", label: "JavaScript" },
    { id: "typescript", label: "TypeScript" },
    { id: "python", label: "Python" },
    { id: "rust", label: "Rust" },
    { id: "go", label: "Go" },
    { id: "java", label: "Java" },
    { id: "c", label: "C" },
    { id: "cpp", label: "C++" },
    { id: "csharp", label: "C#" },
    { id: "html", label: "HTML / XML" },
    { id: "css", label: "CSS" },
    { id: "json", label: "JSON" },
    { id: "yaml", label: "YAML" },
    { id: "sql", label: "SQL" },
    { id: "bash", label: "Bash" },
    { id: "powershell", label: "PowerShell" },
    { id: "mermaid", label: "Mermaid" },
];

/** Markdown 圍欄常見的寫法。 */
const ALIASES: Record<string, string> = {
    "": PLAIN_TEXT, text: PLAIN_TEXT, txt: PLAIN_TEXT,
    js: "javascript", jsx: "javascript", mjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rs: "rust", golang: "go",
    h: "c", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
    cs: "csharp", "c#": "csharp",
    htm: "html", xml: "html", svg: "html",
    jsonc: "json", yml: "yaml",
    sh: "bash", shell: "bash", zsh: "bash",
    ps1: "powershell", pwsh: "powershell",
};

/** 圍欄後面的文字（例如 `py`、`js title=a`）是哪個語言。清單裡沒有的就原樣回傳。 */
export function fenceToLanguage(fence: string) {
    const name = fence.trim().split(/\s+/)[0].toLowerCase();
    return Object.prototype.hasOwnProperty.call(ALIASES, name) ? ALIASES[name] : name;
}

/** 純文字的圍欄不寫語言。 */
export const languageToFence = (language: string) => (language === PLAIN_TEXT ? "" : language);

/** 新建的筆記沒有語言，視為純文字。 */
export function noteLanguage(note: Note) {
    const { language } = note.context;
    return typeof language === "string" && language ? language : PLAIN_TEXT;
}

export const languageLabel = (id: string) => LANGUAGES.find((language) => language.id === id)?.label ?? id;
