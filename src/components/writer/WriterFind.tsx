import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { rangeOf } from "./inline.ts";
import { findRanges } from "./rules.ts";

interface WriterFindProps {
    /** 紙，只在這裡面找。 */
    host: RefObject<HTMLElement | null>;
    onClose: () => void;
}

interface Match {
    element: HTMLElement;
    from: number;
    to: number;
}

const ALL = "writer-find";
const CURRENT = "writer-find-current";

function matchesIn(host: HTMLElement | null, query: string): Match[] {
    if (!host) return [];
    return [...host.querySelectorAll<HTMLElement>(".writer-text")].flatMap((element) =>
        findRanges(element.textContent ?? "", query).map((range) => ({ element, ...range })));
}

const rangeFor = ({ element, from, to }: Match) => rangeOf(element, from, to);

function clearHighlights() {
    CSS.highlights.delete(ALL);
    CSS.highlights.delete(CURRENT);
}

/** 把選取放到這個位置後用 `insertText` 取代，走一般打字的路，存檔與復原都不用另外處理。 */
function replaceMatch(match: Match, text: string) {
    match.element.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(rangeFor(match));
    document.execCommand("insertText", false, text);
}

/** 尋找與取代。醒目標示不改動文件的 DOM，打字中的內容不會受影響。 */
function WriterFind({ host, onClose }: WriterFindProps) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [index, setIndex] = useState(0);
    /** 取代之後要重新找。 */
    const [scan, setScan] = useState(0);
    const input = useRef<HTMLInputElement>(null);

    const matches = useMemo(() => matchesIn(host.current, query), [host, query, scan]);
    const at = matches.length > 0 ? Math.min(index, matches.length - 1) : -1;

    useEffect(() => {
        clearHighlights();
        if (matches.length === 0) return clearHighlights;
        CSS.highlights.set(ALL, new Highlight(...matches.map(rangeFor)));
        const current = rangeFor(matches[at]);
        CSS.highlights.set(CURRENT, new Highlight(current));
        current.startContainer.parentElement?.scrollIntoView({ block: "center" });
        return clearHighlights;
    }, [matches, at]);

    // 焦點可能在文件裡，所以 Esc 要在視窗上接，不然會關掉全螢幕。
    useEffect(() => {
        const onEscape = (evt: globalThis.KeyboardEvent) => {
            if (evt.key !== "Escape" || evt.isComposing) return;
            evt.preventDefault();
            evt.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", onEscape, true);
        return () => window.removeEventListener("keydown", onEscape, true);
    }, [onClose]);

    const step = (by: number) => {
        if (matches.length > 0) setIndex((at + by + matches.length) % matches.length);
    };

    const afterReplace = useCallback(() => {
        setScan((value) => value + 1);
        input.current?.focus();
    }, []);

    const replaceOne = () => {
        if (at < 0) return;
        replaceMatch(matches[at], replacement);
        afterReplace();
    };

    const replaceAll = () => {
        // 從後面取代回來，前面的位置才不會跑掉。
        for (const match of [...matches].reverse()) replaceMatch(match, replacement);
        afterReplace();
    };

    const onKeyDown = (evt: KeyboardEvent) => {
        if (evt.key !== "Enter" || evt.nativeEvent.isComposing) return;
        evt.preventDefault();
        step(evt.shiftKey ? -1 : 1);
    };

    return (
        <div className="sheet-find writer-find" role="search" onKeyDown={onKeyDown}>
            <input ref={input} autoFocus placeholder="尋找" aria-label="尋找" value={query} onChange={(evt) => { setQuery(evt.target.value); setIndex(0); }} />
            <span className="sheet-find-count">{query ? `${at + 1} / ${matches.length}` : ""}</span>
            <button title="上一個 (Shift+Enter)" disabled={matches.length === 0} onClick={() => step(-1)}>▲</button>
            <button title="下一個 (Enter)" disabled={matches.length === 0} onClick={() => step(1)}>▼</button>
            <input placeholder="取代為" aria-label="取代為" value={replacement} onChange={(evt) => setReplacement(evt.target.value)} />
            <button disabled={at < 0} onClick={replaceOne}>取代</button>
            <button disabled={at < 0} onClick={replaceAll}>全部取代</button>
            <button title="關閉 (Esc)" aria-label="關閉" onClick={onClose}>✕</button>
        </div>
    );
}

export default WriterFind;
