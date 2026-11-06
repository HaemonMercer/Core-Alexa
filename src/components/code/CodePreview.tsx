import CodeTokens from "./CodeTokens.tsx";

/** 唯讀的程式碼。 */
function CodePreview({ text, language }: { text: string; language: string }) {
    return <pre className="code-preview"><CodeTokens text={text} language={language} /></pre>;
}

export default CodePreview;
