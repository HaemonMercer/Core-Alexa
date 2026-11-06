import { useState } from "react";
import CodeArea from "./CodeArea.tsx";
import LanguageSelect from "./LanguageSelect.tsx";

interface CodeEditorProps {
    source: string;
    language: string;
    onChange: (source: string) => void;
    onLanguageChange: (language: string) => void;
}

/** 換到別的筆記時要用 key 重建：這裡的內容從 props 開始，之後由使用者輸入。 */
function CodeEditor({ source, language, onChange, onLanguageChange }: CodeEditorProps) {
    const [text, setText] = useState(source);
    const [current, setCurrent] = useState(language);

    return (
        <div className="code-editor">
            <label className="code-language">
                語言
                <LanguageSelect
                    value={current}
                    onChange={(next) => {
                        setCurrent(next);
                        onLanguageChange(next);
                    }}
                />
            </label>
            <CodeArea
                text={text}
                language={current}
                label="程式碼"
                onChange={(next) => {
                    setText(next);
                    onChange(next);
                }}
            />
        </div>
    );
}

export default CodeEditor;
