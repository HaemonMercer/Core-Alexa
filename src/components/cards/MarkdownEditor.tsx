import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import * as api from "../../api.ts";
import type { MarkName } from "../../markdown/ast.ts";
import { MarkdownController } from "../../markdown/controller.ts";
import {
    insertRule,
    linkAtCaret,
    setCodeLanguage,
    setHeading,
    setLink,
    toggleCodeBlock,
    toggleList,
    toggleQuote,
    type Doc,
} from "../../markdown/editing.ts";
import { cardTitle, isNewCardTitle } from "../../markdown/noteLink.ts";
import type { CardMatch, Note } from "../../types.ts";
import { fenceToLanguage, languageToFence } from "../code/languages.ts";
import LanguageSelect from "../code/LanguageSelect.tsx";
import CardPicker from "./CardPicker.tsx";
import type { EditorPlacement } from "./editorPlacement.ts";

const TOOLBAR_HEIGHT = 40;

interface MarkdownEditorProps {
    /** 正在編輯的卡片，連結卡片時不列出自己。 */
    noteID: string;
    markdown: string;
    placement?: EditorPlacement;
    padding: number;
    onChange: (markdown: string) => void;
    onOpenLink: (href: string) => void;
    /** 從 `[[` 選單建立了新卡片。 */
    onCardCreated: () => void;
    onClose?: () => void;
    onError: (error: unknown) => void;
}

interface LinkDraft {
    doc: Doc;
    href: string;
}

function MarkdownEditor({
    noteID, markdown, placement, padding, onChange, onOpenLink, onCardCreated, onClose, onError,
}: MarkdownEditorProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<MarkdownController | null>(null);
    const callbacksRef = useRef({
        onChange, onOpenLink, requestLink: () => {}, mentionKey: (_key: string): boolean => false,
    });
    const [active, setActive] = useState<Set<string>>(new Set());
    const [codeFence, setCodeFence] = useState<string | null>(null);
    /** 語言選單會搶走焦點，選單打開前的選取範圍要記下來。 */
    const selectionBeforeMenu = useRef<Doc | null>(null);
    const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
    const [mention, setMention] = useState<{ query: string; caret: DOMRect } | null>(null);
    const [matches, setMatches] = useState<CardMatch[]>([]);
    const [activeMatch, setActiveMatch] = useState(0);
    const query = mention?.query ?? null;

    useEffect(() => {
        if (query === null) return;
        let cancelled = false;
        api.searchCards(query, noteID)
            .then((cards) => {
                if (cancelled) return;
                setMatches(cards);
                setActiveMatch(0);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [query, noteID, onError]);

    const pickCard = (card: Note) => {
        controllerRef.current?.insertNoteLink(card.id, cardTitle(card.content));
    };

    const titles = matches.map((match) => cardTitle(match.note.content));
    const newTitle = query !== null && isNewCardTitle(query, titles) ? query.trim() : null;
    const optionCount = matches.length + (newTitle === null ? 0 : 1);

    const createCard = () => {
        if (newTitle === null) return;
        api.createCard(newTitle)
            .then((card) => {
                onCardCreated();
                pickCard(card);
            })
            .catch(onError);
    };

    const pickOption = (index: number) => {
        if (index < matches.length) pickCard(matches[index].note);
        else createCard();
    };

    const mentionKey = (key: string) => {
        if (optionCount === 0) return false;
        if (key === "ArrowDown") setActiveMatch((activeMatch + 1) % optionCount);
        else if (key === "ArrowUp") setActiveMatch((activeMatch - 1 + optionCount) % optionCount);
        else if (key === "Enter" || key === "Tab") pickOption(Math.min(activeMatch, optionCount - 1));
        else return false;
        return true;
    };

    const requestLink = () => {
        const controller = controllerRef.current;
        if (!controller) return;
        const doc = controller.selectionSnapshot();
        setLinkDraft({ doc, href: linkAtCaret(doc) });
    };
    callbacksRef.current = { onChange, onOpenLink, requestLink, mentionKey };

    useEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        // 編輯器開著時內容由自己管理，父層傳來的 markdown 只用來初始化。
        const controller = new MarkdownController(root, markdown, {
            onChange: (next) => callbacksRef.current.onChange(next),
            onFormatChange: (next, fence) => {
                setActive(next);
                setCodeFence(fence);
            },
            onRequestLink: () => callbacksRef.current.requestLink(),
            onOpenLink: (href) => callbacksRef.current.onOpenLink(href),
            onMentionChange: setMention,
            onMentionKey: (key) => callbacksRef.current.mentionKey(key),
        }, placement !== undefined);
        controllerRef.current = controller;
        return () => {
            controller.destroy();
            controllerRef.current = null;
        };
    }, []);

    const finishLink = (apply: boolean) => {
        const controller = controllerRef.current;
        const draft = linkDraft;
        setLinkDraft(null);
        if (!controller || !draft) return;
        controller.restoreSelection(draft.doc);
        if (apply) controller.run((doc) => setLink(doc, draft.href.trim()));
    };

    const switchLanguage = (language: string) => {
        const controller = controllerRef.current;
        const doc = selectionBeforeMenu.current;
        if (!controller) return;
        if (doc) controller.restoreSelection(doc);
        controller.run((value) => setCodeLanguage(value, languageToFence(language)));
    };

    const onBlur = (evt: FocusEvent<HTMLDivElement>) => {
        // 焦點移到工具列（連結輸入框）時不算結束編輯。
        if (!wrapperRef.current?.contains(evt.relatedTarget)) onClose?.();
    };

    const toolbarStyle = placement && {
        left: placement.left,
        top: placement.top - TOOLBAR_HEIGHT >= 8
            ? placement.top - TOOLBAR_HEIGHT
            : placement.top + placement.height * placement.scale + 8,
    };
    const editorStyle = placement
        ? {
            left: placement.left,
            top: placement.top,
            width: placement.width,
            height: placement.fitContent ? undefined : placement.height,
            padding,
            paddingTop: placement.paddingTop,
            transform: `scale(${placement.scale})`,
        }
        : { padding };

    const markButton = (mark: MarkName, label: ReactNode, title: string) => (
        <ToolButton
            label={label}
            title={title}
            pressed={active.has(mark)}
            onPress={() => controllerRef.current?.toggleMark(mark)}
        />
    );

    const blockButton = (tag: string, label: ReactNode, title: string, command: (doc: Doc) => Doc) => (
        <ToolButton
            label={label}
            title={title}
            pressed={active.has(tag)}
            onPress={() => controllerRef.current?.run(command)}
        />
    );

    return (
        <div ref={wrapperRef} className={placement ? undefined : "panel-editor"} onBlur={onBlur}>
            <div
                className="note-format-bar"
                role="toolbar"
                aria-label="文字格式"
                style={toolbarStyle}
            >
                {linkDraft ? (
                    <input
                        className="note-link-input"
                        aria-label="連結網址"
                        placeholder="https://…（留空可移除連結）"
                        autoFocus
                        value={linkDraft.href}
                        onChange={(evt) => setLinkDraft({ ...linkDraft, href: evt.target.value })}
                        onKeyDown={(evt) => {
                            if (evt.key === "Enter") {
                                evt.preventDefault();
                                finishLink(true);
                            } else if (evt.key === "Escape") {
                                evt.preventDefault();
                                finishLink(false);
                            }
                        }}
                    />
                ) : (
                    <>
                        {markButton("bold", <b>B</b>, "粗體 (Ctrl+B)")}
                        {markButton("italic", <i>I</i>, "斜體 (Ctrl+I)")}
                        {markButton("strike", <s>S</s>, "刪除線 (Ctrl+Shift+X)")}
                        {markButton("code", <code>{"<>"}</code>, "行內程式碼 (Ctrl+E)")}
                        <ToolButton
                            label="連結"
                            title="連結 (Ctrl+K)"
                            pressed={active.has("link")}
                            onPress={requestLink}
                        />
                        <span className="note-format-divider" />
                        {blockButton("h1", "H1", "標題一", (doc) => setHeading(doc, 1))}
                        {blockButton("h2", "H2", "標題二", (doc) => setHeading(doc, 2))}
                        {blockButton("h3", "H3", "標題三", (doc) => setHeading(doc, 3))}
                        {blockButton("ul", "•", "項目清單", (doc) => toggleList(doc, false))}
                        {blockButton("ol", "1.", "編號清單", (doc) => toggleList(doc, true))}
                        {blockButton("blockquote", "❝", "引言", toggleQuote)}
                        {blockButton("pre", "{ }", "程式碼區塊", toggleCodeBlock)}
                        {blockButton("hr", "—", "分隔線", insertRule)}
                        {codeFence !== null && (
                            <>
                                <span className="note-format-divider" />
                                <LanguageSelect
                                    value={fenceToLanguage(codeFence)}
                                    onFocus={() => {
                                        selectionBeforeMenu.current = controllerRef.current?.selectionSnapshot() ?? null;
                                    }}
                                    onChange={switchLanguage}
                                />
                            </>
                        )}
                    </>
                )}
            </div>
            <div
                ref={rootRef}
                className="note-editor"
                role="textbox"
                aria-multiline="true"
                aria-label="筆記內容"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                style={editorStyle}
            />
            {mention && (
                <CardPicker
                    caret={mention.caret}
                    matches={matches}
                    newTitle={newTitle}
                    activeIndex={Math.min(activeMatch, Math.max(optionCount - 1, 0))}
                    onActivate={setActiveMatch}
                    onPick={pickOption}
                />
            )}
        </div>
    );
}

interface ToolButtonProps {
    label: ReactNode;
    title: string;
    pressed: boolean;
    onPress: () => void;
}

function ToolButton({ label, title, pressed, onPress }: ToolButtonProps) {
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={pressed}
            // 按下時不能搶走編輯區的焦點，否則選取範圍會消失。
            onMouseDown={(evt) => evt.preventDefault()}
            onClick={onPress}
        >
            {label}
        </button>
    );
}

export default MarkdownEditor;
