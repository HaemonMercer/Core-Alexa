import { useMemo } from "react";
import { highlight, TOKEN_COLORS } from "./highlight.ts";

/** 上色後的文字，要放在 `<pre>` 裡。 */
function CodeTokens({ text, language }: { text: string; language: string }) {
    const tokens = useMemo(() => highlight(text, language), [text, language]);
    return tokens.map((token, index) => (
        <span key={index} style={{ color: TOKEN_COLORS[token.kind] }}>{token.text}</span>
    ));
}

export default CodeTokens;
