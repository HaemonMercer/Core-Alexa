import { paragraph, type MarkName, type Marks } from "./ast.ts";
import {
    blockTagsAtNode,
    CARET_HOLDER,
    codeFenceAtNode,
    domPosition,
    leafElement,
    marksAtNode,
    pointFromDom,
    readBlocks,
    renderBlocks,
} from "./dom.ts";
import {
    applyInputRule,
    deleteSelection,
    insertCaretHolder,
    insertNoteLink,
    insertText,
    isAtLeafEnd,
    isCollapsed,
    mentionAtCaret,
    pasteMarkdown,
    pressBackspace,
    pressDelete,
    pressEnter,
    pressLineBreak,
    pressTab,
    selectedMarkdown,
    selectionRange,
    spansLeaves,
    toggleMark,
    type Doc,
    type Mention,
    type Point,
} from "./editing.ts";
import { parseMarkdown } from "./parse.ts";
import { serializeMarkdown } from "./serialize.ts";

const HISTORY_LIMIT = 200;
const TYPING_GROUP_MS = 800;

export interface EditorCallbacks {
    onChange: (markdown: string) => void;
    /** `codeFence` 是游標所在程式碼區塊的語言，不在程式碼區塊裡時是 null。 */
    onFormatChange: (active: Set<string>, codeFence: string | null) => void;
    onRequestLink: () => void;
    onOpenLink: (href: string) => void;
    /** 輸入 `[[` 之後呼叫，傳入搜尋文字和游標位置；`null` 表示結束。 */
    onMentionChange: (mention: { query: string; caret: DOMRect } | null) => void;
    /** 卡片選單開著時的按鍵，回傳 true 表示已處理。 */
    onMentionKey: (key: string) => boolean;
}

/**
 * 同一區塊內的文字輸入交給瀏覽器，輸入法才能正常運作；其他會改變結構的操作
 * 都先取消原生行為，改由文件模型處理再更新畫面。
 */
export class MarkdownController {
    private readonly root: HTMLElement;
    private readonly callbacks: EditorCallbacks;
    private readonly abort = new AbortController();
    private current: Doc;
    private markdown: string;
    private undoStack: Doc[] = [];
    private redoStack: Doc[] = [];
    private lastTyping = 0;
    private composing = false;
    private mention: Mention | null = null;
    /** 按 Esc 關閉過的 `[[`，留下的是一般文字，不再跳出選單。 */
    private dismissedMention: Mention | null = null;

    /** `focusOnOpen` 為 false 時不搶走焦點，放在面板裡的編輯器要等使用者點進去。 */
    constructor(root: HTMLElement, markdown: string, callbacks: EditorCallbacks, focusOnOpen = true) {
        this.root = root;
        this.callbacks = callbacks;
        this.markdown = markdown;

        const blocks = parseMarkdown(markdown);
        const caret: Point = { leaf: Number.MAX_SAFE_INTEGER, offset: Number.MAX_SAFE_INTEGER };
        this.current = { blocks: blocks.length > 0 ? blocks : [paragraph()], selection: { anchor: caret, focus: caret } };
        const [end] = selectionRange(this.current);
        this.current.selection = { anchor: end, focus: end };

        root.replaceChildren(...renderBlocks(this.current.blocks));
        if (focusOnOpen) {
            root.focus();
            this.placeSelection(this.current);
        }

        const { signal } = this.abort;
        root.addEventListener("beforeinput", (evt) => this.onBeforeInput(evt), { signal });
        root.addEventListener("input", (evt) => this.onInput(evt as InputEvent), { signal });
        root.addEventListener("keydown", (evt) => this.onKeyDown(evt), { signal });
        root.addEventListener("compositionstart", () => this.onCompositionStart(), { signal });
        root.addEventListener("compositionend", () => this.onCompositionEnd(), { signal });
        root.addEventListener("copy", (evt) => this.onCopy(evt), { signal });
        root.addEventListener("cut", (evt) => this.onCut(evt), { signal });
        root.addEventListener("paste", (evt) => this.onPaste(evt), { signal });
        root.addEventListener("drop", (evt) => evt.preventDefault(), { signal });
        root.addEventListener("click", (evt) => this.onClick(evt), { signal });
        root.addEventListener("blur", () => this.updateMention(), { signal });
        document.addEventListener("selectionchange", () => {
            this.reportFormat();
            this.updateMention();
        }, { signal });
        this.reportFormat();
    }

    destroy() {
        this.abort.abort();
    }

    /** 執行一個文件指令，並可用復原還原。 */
    run(command: (doc: Doc) => Doc) {
        if (this.composing) return;
        const before = this.capture();
        const next = command(before);
        if (next === before) return;
        this.pushUndo(before);
        // 指令之後的打字要另成一筆，復原時才不會連指令一起還原。
        this.lastTyping = 0;
        this.commit(next, true);
    }

    toggleMark(mark: MarkName) {
        const node = document.getSelection()?.focusNode ?? null;
        const caretMarks: Marks = marksAtNode(this.root, node);
        this.run((doc) => toggleMark(doc, mark, caretMarks));
    }

    /** 把正在輸入的 `[[搜尋文字` 換成卡片連結。 */
    insertNoteLink(noteID: string, title: string) {
        const { mention } = this;
        if (mention) this.run((doc) => insertNoteLink(doc, mention, noteID, title));
    }

    /** 工具列的連結輸入框會搶走焦點，先記下選取範圍，之後用 `restoreSelection` 還原。 */
    selectionSnapshot(): Doc {
        return this.capture();
    }

    restoreSelection(doc: Doc) {
        this.root.focus();
        this.placeSelection(doc);
    }

    private readSelection(): Doc["selection"] {
        const selection = document.getSelection();
        if (
            !selection?.anchorNode || !selection.focusNode ||
            !this.root.contains(selection.anchorNode) || !this.root.contains(selection.focusNode)
        ) {
            return this.current.selection;
        }
        return {
            anchor: pointFromDom(this.root, selection.anchorNode, selection.anchorOffset),
            focus: pointFromDom(this.root, selection.focusNode, selection.focusOffset),
        };
    }

    private capture(): Doc {
        return { blocks: this.current.blocks, selection: this.readSelection() };
    }

    private pushUndo(doc: Doc) {
        this.undoStack.push({ blocks: doc.blocks, selection: doc.selection });
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
    }

    private placeSelection(doc: Doc) {
        const shift = doc.pending ? 1 : 0;
        const position = ({ leaf, offset }: Point) => domPosition(this.root, { leaf, offset: offset + shift });
        const anchor = position(doc.selection.anchor);
        const focus = position(doc.selection.focus);
        document.getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
        leafElement(this.root, doc.selection.focus)?.scrollIntoView({ block: "nearest" });
    }

    /** 把文件畫到編輯區；畫面已經相同時不動 DOM，游標和輸入狀態才不會被打斷。 */
    private commit(doc: Doc, moveCaret: boolean) {
        const displayed = doc.pending ? insertCaretHolder(doc, CARET_HOLDER) : doc;
        const fresh = this.root.cloneNode(false) as HTMLElement;
        fresh.append(...renderBlocks(displayed.blocks));
        // 程式碼上色時一般文字是分開的節點，合併後才比得出畫面有沒有變。
        fresh.normalize();

        this.root.normalize();
        const changed = !this.root.isEqualNode(fresh);
        if (changed) {
            const { scrollTop } = this.root;
            this.root.replaceChildren(...fresh.childNodes);
            this.root.scrollTop = scrollTop;
        }
        if (changed || moveCaret) this.placeSelection(doc);

        this.current = { blocks: doc.blocks, selection: doc.selection };
        const markdown = serializeMarkdown(doc.blocks);
        if (markdown !== this.markdown) {
            this.markdown = markdown;
            this.callbacks.onChange(markdown);
        }
        this.reportFormat();
        this.updateMention();
    }

    private updateMention() {
        if (this.composing) return;
        const found = document.activeElement === this.root ? mentionAtCaret(this.capture()) : null;
        if (!found) this.dismissedMention = null;
        const dismissed = found !== null && this.dismissedMention?.leaf === found.leaf
            && this.dismissedMention.from === found.from;
        const next = dismissed ? null : found;

        const current = this.mention;
        if (next?.query === current?.query && next?.leaf === current?.leaf && next?.from === current?.from) return;
        this.mention = next;
        const range = document.getSelection()?.getRangeAt(0);
        this.callbacks.onMentionChange(next && range ? { query: next.query, caret: range.getBoundingClientRect() } : null);
    }

    private reportFormat() {
        const selection = document.getSelection();
        const node = selection?.focusNode ?? null;
        if (!node || !this.root.contains(node)) return;

        const active = new Set<string>(blockTagsAtNode(this.root, node));
        const marks = marksAtNode(this.root, node);
        if (marks.bold) active.add("bold");
        if (marks.italic) active.add("italic");
        if (marks.strike) active.add("strike");
        if (marks.code) active.add("code");
        if (marks.href !== undefined) active.add("link");
        this.callbacks.onFormatChange(active, codeFenceAtNode(this.root, node));
    }

    private undo() {
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.redoStack.push(this.capture());
        this.commit(previous, true);
    }

    private redo() {
        const next = this.redoStack.pop();
        if (!next) return;
        this.undoStack.push(this.capture());
        this.commit(next, true);
    }

    private onBeforeInput(evt: InputEvent) {
        if (evt.isComposing || this.composing) return;
        const { inputType } = evt;
        const doc = this.capture();
        const collapsed = isCollapsed(doc);
        const handle = (command: (value: Doc) => Doc) => {
            evt.preventDefault();
            this.run(command);
        };

        if (inputType === "historyUndo") {
            evt.preventDefault();
            this.undo();
        } else if (inputType === "historyRedo") {
            evt.preventDefault();
            this.redo();
        } else if (inputType.startsWith("format") || inputType === "insertFromDrop") {
            evt.preventDefault();
        } else if (inputType === "insertFromPaste" || inputType === "deleteByCut") {
            // 由 paste、cut 事件處理。
            evt.preventDefault();
        } else if (inputType === "insertParagraph") {
            handle(pressEnter);
        } else if (inputType === "insertLineBreak") {
            handle(pressLineBreak);
        } else if (inputType.startsWith("delete") && spansLeaves(doc)) {
            handle(deleteSelection);
        } else if (inputType.startsWith("delete") && inputType.endsWith("Backward")
            && collapsed && selectionRange(doc)[0].offset === 0) {
            handle(pressBackspace);
        } else if (inputType.startsWith("delete") && inputType.endsWith("Forward")
            && collapsed && isAtLeafEnd(doc)) {
            handle(pressDelete);
        } else if (spansLeaves(doc)) {
            const text = evt.data ?? evt.dataTransfer?.getData("text/plain") ?? "";
            handle((value) => insertText(value, text));
        } else {
            // 連續打字併成一筆復原，瀏覽器原生的復原在畫面重建後已不可靠。
            const now = Date.now();
            if (now - this.lastTyping > TYPING_GROUP_MS) this.pushUndo(doc);
            this.lastTyping = now;
        }
    }

    private syncFromDom(allowRules: boolean) {
        const typed: Doc = { blocks: readBlocks(this.root), selection: this.readSelection() };
        const ruled = allowRules ? applyInputRule(typed) : null;
        if (ruled) {
            this.commit(typed, false);
            this.pushUndo(typed);
            this.commit(ruled, true);
        } else {
            this.commit(typed, false);
        }
    }

    private onInput(evt: InputEvent) {
        if (evt.isComposing || this.composing) return;
        this.syncFromDom(evt.inputType === "insertText" || evt.inputType === "insertCompositionText");
    }

    private onCompositionStart() {
        if (spansLeaves(this.capture())) this.run(deleteSelection);
        this.pushUndo(this.capture());
        this.composing = true;
    }

    private onCompositionEnd() {
        this.composing = false;
        this.syncFromDom(true);
    }

    private onKeyDown(evt: KeyboardEvent) {
        if (evt.isComposing) return;
        if (this.mention && evt.key === "Escape") {
            evt.preventDefault();
            this.dismissedMention = this.mention;
            this.updateMention();
            return;
        }
        if (this.mention && this.callbacks.onMentionKey(evt.key)) {
            evt.preventDefault();
            return;
        }
        if (evt.key === "Escape") {
            this.root.blur();
            return;
        }
        if (evt.key === "Tab") {
            evt.preventDefault();
            this.run((doc) => pressTab(doc, evt.shiftKey));
            return;
        }
        if (!evt.ctrlKey && !evt.metaKey) return;

        const key = evt.key.toLowerCase();
        const shortcuts: Record<string, () => void> = {
            b: () => this.toggleMark("bold"),
            i: () => this.toggleMark("italic"),
            e: () => this.toggleMark("code"),
            k: () => this.callbacks.onRequestLink(),
            y: () => this.redo(),
            z: () => (evt.shiftKey ? this.redo() : this.undo()),
        };
        if (evt.shiftKey && key === "x") {
            evt.preventDefault();
            this.toggleMark("strike");
        } else if (shortcuts[key] && (!evt.shiftKey || key === "z")) {
            evt.preventDefault();
            shortcuts[key]();
        }
    }

    private onCopy(evt: ClipboardEvent) {
        const doc = this.capture();
        if (isCollapsed(doc)) return;
        evt.preventDefault();
        evt.clipboardData?.setData("text/plain", selectedMarkdown(doc));
    }

    private onCut(evt: ClipboardEvent) {
        this.onCopy(evt);
        if (evt.defaultPrevented) this.run(deleteSelection);
    }

    private onPaste(evt: ClipboardEvent) {
        evt.preventDefault();
        const text = evt.clipboardData?.getData("text/plain");
        if (text) this.run((doc) => pasteMarkdown(doc, text));
    }

    private onClick(evt: MouseEvent) {
        if (!evt.ctrlKey && !evt.metaKey) return;
        const link = (evt.target as Element).closest("a");
        const href = link?.getAttribute("href");
        if (href) {
            evt.preventDefault();
            this.callbacks.onOpenLink(href);
        }
    }
}
