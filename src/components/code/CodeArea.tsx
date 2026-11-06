import { useImperativeHandle, useMemo, useRef, type KeyboardEvent, type Ref } from "react";
import CodeTokens from "./CodeTokens.tsx";
import { indentLines, INDENT, lineRange, newLineWithIndent } from "./editing.ts";

/** 要和 App.css 的 --code-font、.code-stack 一致。 */
const LINE_HEIGHT = 18;
const PADDING = 8;

export interface CodeAreaHandle {
    /** 整份換掉，可以用 Ctrl+Z 復原。 */
    replaceAll: (text: string) => void;
    goToLine: (line: number) => void;
}

interface CodeAreaProps {
    text: string;
    language: string;
    label: string;
    placeholder?: string;
    /** 顯示行號並關掉自動換行，一行程式碼才會對到一個行號。 */
    numbered?: boolean;
    errorLine?: number | null;
    onChange: (text: string) => void;
    ref?: Ref<CodeAreaHandle>;
}

/** 用 execCommand 改內容才留得住復原紀錄，也會觸發 onChange。 */
const insert = (text: string) => document.execCommand("insertText", false, text);

function pressTab(textarea: HTMLTextAreaElement, outdent: boolean) {
    const { value, selectionStart, selectionEnd } = textarea;
    if (!outdent && selectionStart === selectionEnd) {
        insert(INDENT);
        return;
    }
    const change = indentLines(value, selectionStart, selectionEnd, outdent);
    if (!change) return;
    textarea.setSelectionRange(change.from, change.to);
    insert(change.text);
    textarea.setSelectionRange(change.selectionStart, change.selectionEnd);
}

function onKeyDown(evt: KeyboardEvent<HTMLTextAreaElement>) {
    if (evt.nativeEvent.isComposing) return;
    const textarea = evt.currentTarget;
    if (evt.key === "Tab") {
        evt.preventDefault();
        pressTab(textarea, evt.shiftKey);
    } else if (evt.key === "Enter" && !evt.shiftKey && !evt.ctrlKey) {
        evt.preventDefault();
        insert(newLineWithIndent(textarea.value, textarea.selectionStart));
    }
}

/**
 * 透明的 textarea 疊在上色的 `<pre>` 上。兩者在同一個格子裡，高度由 `<pre>` 撐開、外層捲動，
 * 不用同步捲動位置，換行也一定對齊。
 */
function CodeArea({ text, language, label, placeholder, numbered, errorLine, onChange, ref }: CodeAreaProps) {
    const textarea = useRef<HTMLTextAreaElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const lineCount = useMemo(() => text.split("\n").length, [text]);
    // 檔尾的語法錯誤可能回報在最後一行之後。
    const markedLine = errorLine ? Math.min(errorLine, lineCount) : null;

    useImperativeHandle(ref, () => ({
        replaceAll(next) {
            textarea.current?.focus();
            textarea.current?.select();
            insert(next);
        },
        goToLine(line) {
            const target = textarea.current;
            if (!target) return;
            const { start, end } = lineRange(target.value, line);
            target.focus();
            target.setSelectionRange(start, end);
            scroller.current?.scrollTo({ top: (line - 1) * LINE_HEIGHT - LINE_HEIGHT * 3 });
        },
    }), []);

    return (
        <div ref={scroller} className={numbered ? "code-scroll code-numbered" : "code-scroll"}>
            {numbered && (
                <div className="code-gutter" aria-hidden="true">
                    {Array.from({ length: lineCount }, (_, index) => (
                        <span key={index} data-error={index + 1 === markedLine || undefined}>{index + 1}</span>
                    ))}
                </div>
            )}
            <div className="code-stack">
                {markedLine !== null && (
                    <div
                        className="code-error-line"
                        style={{ top: PADDING + (markedLine - 1) * LINE_HEIGHT }}
                    />
                )}
                {/* textarea 最後的換行也佔一行，<pre> 要多一行才一樣高。 */}
                <pre aria-hidden="true"><CodeTokens text={text} language={language} />{"\n"}</pre>
                <textarea
                    ref={textarea}
                    aria-label={label}
                    spellCheck={false}
                    wrap={numbered ? "off" : "soft"}
                    placeholder={placeholder}
                    value={text}
                    onKeyDown={onKeyDown}
                    onChange={(evt) => onChange(evt.target.value)}
                />
            </div>
        </div>
    );
}

export default CodeArea;
