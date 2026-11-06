import { useRef, useState } from "react";
import CodeArea, { type CodeAreaHandle } from "../code/CodeArea.tsx";
import DiagramView from "./DiagramView.tsx";
import { errorLine, TEMPLATES } from "./templates.ts";
import { useDiagram } from "./useDiagram.ts";

const PREVIEW_DELAY_MS = 300;
const EXAMPLE = TEMPLATES[0].source;

interface MermaidEditorProps {
    source: string;
    onChange: (source: string) => void;
    /** 在窄的面板裡才提供，全螢幕已經是左右並排。 */
    onExpand?: () => void;
}

/** 換到別的筆記時要用 key 重建：這裡的文字從 `source` 開始，之後由使用者輸入。 */
function MermaidEditor({ source, onChange, onExpand }: MermaidEditorProps) {
    const [text, setText] = useState(source);
    const area = useRef<CodeAreaHandle>(null);
    const { diagram, error } = useDiagram(text, PREVIEW_DELAY_MS);
    const line = error ? errorLine(error) : null;

    return (
        <div className="mermaid-editor">
            <div className="mermaid-toolbar">
                <select
                    aria-label="插入範本"
                    title="換成範本的內容，可以用 Ctrl+Z 復原"
                    value=""
                    onChange={(evt) => {
                        const template = TEMPLATES.find(({ id }) => id === evt.target.value);
                        if (template) area.current?.replaceAll(template.source);
                    }}
                >
                    <option value="" disabled hidden>插入範本…</option>
                    {TEMPLATES.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
                {onExpand && <button type="button" onClick={onExpand}>全螢幕</button>}
            </div>
            <div className="mermaid-workspace">
                <div className="mermaid-source">
                    <CodeArea
                        ref={area}
                        text={text}
                        language="mermaid"
                        label="Mermaid 原始碼"
                        placeholder={EXAMPLE}
                        numbered
                        errorLine={line}
                        onChange={(next) => {
                            setText(next);
                            onChange(next);
                        }}
                    />
                    {error && (
                        <div className="mermaid-error" role="alert">
                            {line !== null && (
                                <button type="button" onClick={() => area.current?.goToLine(line)}>
                                    跳到第 {line} 行
                                </button>
                            )}
                            <pre>{error}</pre>
                        </div>
                    )}
                </div>
                <DiagramView diagram={diagram} />
            </div>
        </div>
    );
}

export default MermaidEditor;
