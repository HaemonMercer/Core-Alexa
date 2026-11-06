import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import * as api from "../../api.ts";
import { imageInfo, mediaUrl } from "../../media.ts";
import { cardTitle, isNewCardTitle, noteHref } from "../../markdown/noteLink.ts";
import type { BlockSide, CardMatch, CellRange, Note, WriterBlock, WriterOp, WriterPage } from "../../types.ts";
import type { EditorPlacement } from "../cards/editorPlacement.ts";
import CardPicker from "../cards/CardPicker.tsx";
import { useCardSurface, type CardSurface } from "../cards/cardSurface.ts";
import PlacedCard from "../cards/PlacedCard.tsx";
import ChartView from "../chart/ChartView.tsx";
import { fenceToLanguage, languageToFence } from "../code/languages.ts";
import LanguageSelect from "../code/LanguageSelect.tsx";
import ContextMenu from "../common/ContextMenu.tsx";
import DocumentTitle from "../office/DocumentTitle.tsx";
import NotePicker from "../office/NotePicker.tsx";
import SheetRangePicker from "../office/SheetRangePicker.tsx";
import { useEditorHistory } from "../office/useEditorHistory.ts";
import {
    caretOffset, caretOnEdgeLine, markEmpty, paintCode, rangeOf, readText, renderText, setCaret, splitAtCaret, wrapSelectionInCode,
} from "./inline.ts";
import { cellsFromHtml, isSingleCell } from "../office/cellClipboard.ts";
import EmbeddedNote from "./EmbeddedNote.tsx";
import LinkedTable from "./LinkedTable.tsx";
import PageBands from "./PageBands.tsx";
import PageSetup from "./PageSetup.tsx";
import TableBlock from "./TableBlock.tsx";
import WriterFind from "./WriterFind.tsx";
import { clipboardTable, emptyTable, type TableRows } from "./table.ts";
import { fitScale, pageBox, printBox, sheetHeight } from "./pageFormat.ts";
import { usePagination } from "./usePagination.ts";
import {
    blockGroup, blockRuns, cardDropAt, columnAt, dropSide, filterCommands, findTrigger, hasText, indentLimit, isDividerMarker, listNumbers, MAX_COLUMNS, pastedLines, shortcutKind,
    visibleBlocks, wordCount, type DropRow, type SlashCommand, type Trigger,
} from "./rules.ts";

const SAVE_DELAY_MS = 250;
const NOTIFY_DELAY_MS = 700;
const INDENT_WIDTH = 28;
const MENU_WIDTH = 260;
const MENU_HEIGHT = 300;
const NO_MENU_KINDS = ["code"];
/** 紙和編輯區左右邊緣的距離，要和 `.writer-page` 的外距一致。 */
const SHEET_GUTTER = 16;
const HEADING_ROWS = ["h1", "h2", "h3"].map((kind) => `.writer-row[data-kind="${kind}"]`).join(", ");
/** 列印時留一點，紙的高度捨入後才不會多出一張空白頁。 */
const PRINT_SLACK = 1;
const ALIGN_KEYS: Record<string, string> = { l: "", e: "center", r: "right", j: "justify" };
const ALIGNS = [
    { id: "", label: "靠左", icon: "⇤" },
    { id: "center", label: "置中", icon: "↔" },
    { id: "right", label: "靠右", icon: "⇥" },
    { id: "justify", label: "左右對齊", icon: "≡" },
];
const NEW_TABLE_ROWS = 3;
const NEW_TABLE_COLS = 3;
/** 白板上就地編輯時，點這些地方不算離開。 */
const INLINE_AREA = ".writer-editor, .writer-slash, .writer-format, .card-picker, .context-menu, .confirm-backdrop";

interface WriterEditorProps {
    noteID: string;
    /** 窄的右側面板放不下紙，不分頁，字維持原本大小。 */
    draft?: boolean;
    /** Note：沒有紙、名稱、分欄和對齊，內容會變成 Markdown。 */
    card?: boolean;
    /** 放在另一份文件裡的 Note：沒有把手和捲軸，跟著文件的分頁。 */
    embedded?: boolean;
    /** 別處改了這張 Note 時遞增。正在這裡打字時不重讀。 */
    revisionFromOutside?: number;
    /** 文件裡的 Note 改了內容。 */
    onCardChanged?: (id: string) => void;
    /** 內容讀完或打字後呼叫。外面的文件要重算目錄，Note 的標題也算在內。 */
    onContentChange?: () => void;
    /** 浮在白板的卡片上就地編輯。 */
    placement?: EditorPlacement;
    /** `placement` 的左右與下內距。 */
    padding?: number;
    /** 就地編輯時點到外面或按 Esc。 */
    onClose?: () => void;
    /** 從 `[[` 選單建立了新卡片。有這個才提供建立。 */
    onCardCreated?: () => void;
    /** 版面設定的按鈕放在這裡，不佔文件的空間。 */
    toolsSlot?: HTMLElement | null;
    /** 放在文件裡的卡片要跟著更新。 */
    cardRevision?: number;
    /** 全螢幕時像白板一樣可以放卡片。 */
    onSurface?: (surface: CardSurface | null) => void;
    /** 雙擊放在文件裡的卡片。 */
    onPeekCard?: (id: string) => void;
    /** 內容改變後通知 Library 與白板重新讀取。 */
    onChanged: () => void;
    onOpenLink: (href: string) => void;
    onError: (error: unknown) => void;
}

interface OpenTrigger {
    blockID: string;
    trigger: Trigger;
    caret: DOMRect;
}

interface TocEntry {
    id: string;
    level: string;
    text: string;
    /** 右側面板沒有分頁，就沒有頁碼。 */
    page: number | null;
}

interface EmbedRequest {
    type: "cells" | "chart" | "image" | "table" | "card";
    after: string | null;
    /** 指令打在空區塊上時，引入內容取代它。 */
    replace: boolean;
}

interface EditableTextProps {
    block: WriterBlock;
    revision: number;
    register: (id: string, element: HTMLElement | null) => void;
    placeholder: string;
    /** 程式碼離開編輯時上色。打字時顏色不動，游標才不會跳。 */
    highlighted: boolean;
    onInput: (block: WriterBlock, element: HTMLElement) => void;
    onKeyDown: (evt: KeyboardEvent<HTMLDivElement>, block: WriterBlock, element: HTMLElement) => void;
    onPaste: (evt: ClipboardEvent<HTMLDivElement>, block: WriterBlock, element: HTMLElement) => void;
}

function EditableText({ block, revision, register, placeholder, highlighted, onInput, onKeyDown, onPaste }: EditableTextProps) {
    const ref = useRef<HTMLDivElement>(null);
    const plain = block.kind === "code";

    // 要比父層的 layout effect 早註冊，新區塊建立後才放得進游標。
    useLayoutEffect(() => {
        register(block.id, ref.current);
        return () => register(block.id, null);
    }, [block.id, register]);

    // 打字時 DOM 才是最新的，只有結構改變（`revision`）才用 Rust 的內容重畫。
    useLayoutEffect(() => {
        const element = ref.current;
        if (element && readText(element, plain) !== block.text) renderText(element, block.text, plain);
        else if (element) markEmpty(element);
        if (element && highlighted && document.activeElement !== element) paintCode(element, block.language ?? "");
    }, [revision, block.text, block.language, plain, highlighted]);

    return (
        <div
            ref={ref}
            className="writer-text"
            contentEditable={plain ? "plaintext-only" : true}
            suppressContentEditableWarning
            spellCheck={false}
            role="textbox"
            aria-multiline="true"
            data-placeholder={placeholder}
            onInput={(evt) => onInput(block, evt.currentTarget)}
            onKeyDown={(evt) => onKeyDown(evt, block, evt.currentTarget)}
            onPaste={(evt) => onPaste(evt, block, evt.currentTarget)}
            onBlur={(evt) => {
                if (highlighted) paintCode(evt.currentTarget, block.language ?? "");
            }}
        />
    );
}

const PLACEHOLDERS: Record<string, string> = {
    paragraph: "輸入文字，或按 / 選擇區塊類型",
    h1: "標題 1",
    h2: "標題 2",
    h3: "標題 3",
    bullet: "清單",
    number: "清單",
    todo: "待辦事項",
    toggle: "折疊清單",
    quote: "引言",
    callout: "輸入提示內容",
    code: "程式碼",
};

/** 版面像 Word：內容排在選定大小的紙上。編輯方式參考 Notion：每一段都是區塊，用 / 換類型，用左邊的把手拖曳。 */
function WriterEditor({
    noteID, draft: narrow = false, card = false, embedded = false, revisionFromOutside, placement, padding, toolsSlot, cardRevision, onSurface, onPeekCard, onCardChanged, onContentChange, onChanged, onOpenLink, onClose, onCardCreated, onError,
}: WriterEditorProps) {
    const draft = narrow || card;
    const inline = placement !== undefined;
    /** 就地編輯：開啟就有游標，點到外面或按 Esc 離開。 */
    const closable = inline || (embedded && onClose !== undefined);
    const changedRef = useRef(onChanged);
    changedRef.current = onChanged;
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    /** 父層可以每次傳新的函式，這裡的回呼不能因此重建，否則每次重畫都會存檔。 */
    const changed = useCallback(() => changedRef.current(), []);
    const [blocks, setBlocks] = useState<WriterBlock[] | null>(null);
    const [revision, setRevision] = useState(0);
    const [menu, setMenu] = useState<OpenTrigger | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const [linkMatches, setLinkMatches] = useState<CardMatch[]>([]);
    const [blockMenu, setBlockMenu] = useState<{ x: number; y: number; id: string } | null>(null);
    const [embed, setEmbed] = useState<EmbedRequest | null>(null);
    const [toolbar, setToolbar] = useState<{ left: number; top: number } | null>(null);
    const [linkDraft, setLinkDraft] = useState<string | null>(null);
    const [drop, setDrop] = useState<{ top: number; left: number; width: number; height?: number } | null>(null);
    const [images, setImages] = useState<Map<string, Note>>(new Map());
    const [page, setPage] = useState<WriterPage | null>(null);
    const [fit, setFit] = useState(1);
    const [words, setWords] = useState(0);
    const [toc, setToc] = useState<TocEntry[]>([]);
    const [finding, setFinding] = useState(false);
    const [printing, setPrinting] = useState(false);
    /** 在這裡改了 Excels，同一份來源的表格都要重讀。 */
    const [sheetRevision, setSheetRevision] = useState(0);

    const root = useRef<HTMLDivElement>(null);
    const sheet = useRef<HTMLDivElement>(null);
    /** 重算字數與目錄。打字時 DOM 才是最新的，所以從畫面上讀。 */
    const refreshContent = useRef<() => void>(() => undefined);
    const elements = useRef(new Map<string, HTMLElement>());
    const pending = useRef(new Map<string, string>());
    const pendingTables = useRef(new Map<string, TableRows>());
    const pendingPage = useRef<WriterPage | null>(null);
    const saveTimer = useRef<number | undefined>(undefined);
    const notifyTimer = useRef<number | undefined>(undefined);
    const focusRequest = useRef<{ id: string; offset: number | "end" } | null>(null);
    const savedRange = useRef<Range | null>(null);
    const opened = useRef(false);
    const dragState = useRef<{
        id: string;
        startY: number;
        moved: boolean;
        before: string | null;
        indent: number;
        /** 放開時要進的分欄，null 是分欄外。 */
        place: { group: string; column: number } | null;
        /** 放到這個區塊旁邊，開一個新欄。 */
        beside: { target: string; side: BlockSide } | null;
        /** 沒有移動就放開時開啟區塊選單。圖片本身沒有選單。 */
        menu: boolean;
    } | null>(null);

    const register = useCallback((id: string, element: HTMLElement | null) => {
        if (element) elements.current.set(id, element);
        else elements.current.delete(id);
    }, []);

    const notify = useCallback(() => {
        window.clearTimeout(notifyTimer.current);
        notifyTimer.current = window.setTimeout(() => {
            changed();
            refreshContent.current();
        }, NOTIFY_DELAY_MS);
    }, [changed]);

    /** 把還沒送出的文字先寫回去，結構操作才不會用到舊內容。 */
    const flush = useCallback(() => {
        window.clearTimeout(saveTimer.current);
        for (const [id, text] of pending.current) {
            api.editWriter(noteID, { op: "setText", id, text }).catch(onError);
        }
        pending.current.clear();
        for (const [id, rows] of pendingTables.current) {
            api.editWriter(noteID, { op: "setTable", id, rows, typing: true }).catch(onError);
        }
        pendingTables.current.clear();
        if (pendingPage.current) api.setWriterPage(noteID, pendingPage.current, true).catch(onError);
        pendingPage.current = null;
    }, [noteID, onError]);

    const load = useCallback(() => {
        Promise.all([api.getWriter(noteID), card ? null : api.getWriterPage(noteID)])
            .then(([next, nextPage]) => {
                // 就地編輯一打開就能打字。
                if (closable && !opened.current) {
                    const last = next.filter((block) => hasText(block.kind)).pop();
                    if (last) focusRequest.current = { id: last.id, offset: "end" };
                }
                opened.current = true;
                setBlocks(next);
                setPage(nextPage);
                setRevision((value) => value + 1);
            })
            .catch(onError);
    }, [noteID, card, closable, onError]);

    useEffect(load, [load]);

    const outsideRevision = useRef(revisionFromOutside);
    useEffect(() => {
        if (outsideRevision.current === revisionFromOutside) return;
        outsideRevision.current = revisionFromOutside;
        if (!root.current?.contains(document.activeElement)) load();
    }, [revisionFromOutside, load]);

    useEffect(() => {
        if (!blocks?.some((block) => block.kind === "image")) return;
        api.getNoteLibrary()
            .then((notes) => setImages(new Map(notes.filter((note) => note.type === "image").map((note) => [note.id, note]))))
            .catch(onError);
    }, [onError, blocks?.length]);

    useEffect(() => () => {
        flush();
        window.clearTimeout(notifyTimer.current);
        changed();
    }, [flush, changed]);

    // 焦點會在區塊之間移動，點圖片也沒有焦點，所以用點到外面判斷離開。
    useEffect(() => {
        if (!closable) return;
        const onPointerDown = (evt: globalThis.PointerEvent) => {
            if (!(evt.target as Element).closest?.(INLINE_AREA)) closeRef.current?.();
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        return () => window.removeEventListener("pointerdown", onPointerDown, true);
    }, [closable]);

    const apply = useCallback((op: WriterOp, focus?: { id: string; offset: number | "end" }) => {
        flush();
        return api.editWriter(noteID, op)
            .then((edit) => {
                const target = focus ?? (edit.focus ? { id: edit.focus.id, offset: "end" as const } : null);
                if (target) focusRequest.current = target;
                setBlocks(edit.blocks);
                setRevision((value) => value + 1);
                notify();
                return edit;
            })
            .catch((error: unknown) => {
                onError(error);
                return null;
            });
    }, [noteID, flush, notify, onError]);

    const history = useEditorHistory(noteID, load, flush, onError);

    // 右鍵選單用完後焦點不在任何元素上，全螢幕時 Ctrl+Z 仍然要有作用。
    useEffect(() => {
        if (draft) return;
        const onKeyDown = (evt: globalThis.KeyboardEvent) => {
            if (evt.target === document.body) history(evt);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [draft, history]);

    // 打頁首時 `page` 每個字都會換，紙的尺寸沒變就不用重新分頁。
    const box = useMemo(
        () => {
            if (!page || draft) return null;
            const screen = pageBox(page);
            return printing ? printBox(screen) : screen;
        },
        [page?.size, page?.landscape, page?.margin, draft, printing],
    );
    const scale = printing ? 1 : fit;
    const ready = blocks !== null;

    // 紙比編輯區寬時（右側面板、A3）整份縮小到看得見整頁寬。
    useLayoutEffect(() => {
        const host = root.current;
        if (!host || !box) return;
        const measure = () => setFit(fitScale(box, host.clientWidth - SHEET_GUTTER * 2));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(host);
        return () => observer.disconnect();
    }, [box, ready]);

    // 要在放游標之前排好，游標才會落在分頁後的位置。
    const afterLayout = useCallback(() => refreshContent.current(), []);
    const pages = usePagination(sheet, box, scale, [blocks, revision], afterLayout);

    refreshContent.current = () => {
        const host = sheet.current;
        if (!host || !blocks) return;
        onContentChange?.();
        const text = [...host.querySelectorAll(".writer-text, .writer-cell")].map((element) => element.textContent ?? "").join(" ");
        setWords(wordCount(text));
        if (!blocks.some((block) => block.kind === "toc")) return;
        const top = host.getBoundingClientRect().top;
        // 從畫面上讀，放進來的 Note 的標題才會照順序排進來。
        const entries = [...host.querySelectorAll<HTMLElement>(HEADING_ROWS)].map((row) => ({
            id: row.dataset.id ?? "",
            level: row.dataset.kind ?? "",
            text: row.querySelector(".writer-text")?.textContent ?? "",
            page: box ? Math.floor((row.getBoundingClientRect().top - top) / scale / box.pitch) + 1 : null,
        }));
        setToc((current) => (JSON.stringify(current) === JSON.stringify(entries) ? current : entries));
    };

    // 右側面板沒有分頁，也要算。
    useEffect(() => refreshContent.current(), [blocks, revision]);

    useEffect(() => {
        if (draft) return;
        const onKeyDown = (evt: globalThis.KeyboardEvent) => {
            if (!(evt.ctrlKey || evt.metaKey) || evt.shiftKey) return;
            const key = evt.key.toLowerCase();
            if (key !== "f" && key !== "p") return;
            evt.preventDefault();
            if (key === "f") setFinding(true);
            else setPrinting(true);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [draft]);

    // 先用沒有間距的紙排好，下一個畫面才列印，印完換回來。
    useEffect(() => {
        if (!printing || !box) return;
        const style = document.createElement("style");
        style.textContent = `@page { size: ${box.width}px ${box.height}px; margin: 0; }`;
        document.head.append(style);
        const done = () => setPrinting(false);
        window.addEventListener("afterprint", done);
        const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("afterprint", done);
            style.remove();
        };
    }, [printing, box]);

    const changePage = (next: WriterPage) => {
        flush();
        setPage(next);
        api.setWriterPage(noteID, next).catch(onError);
    };

    const onBandType = useCallback((next: WriterPage) => {
        setPage(next);
        pendingPage.current = next;
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    }, [flush]);

    useLayoutEffect(() => {
        const request = focusRequest.current;
        if (!request) return;
        const element = elements.current.get(request.id);
        if (!element) return;
        focusRequest.current = null;
        setCaret(element, request.offset);
    }, [blocks, revision]);

    const closeMenu = useCallback(() => setMenu(null), []);

    const updateTrigger = useCallback((block: WriterBlock, element: HTMLElement) => {
        if (NO_MENU_KINDS.includes(block.kind)) return closeMenu();
        const offset = caretOffset(element);
        if (offset === null) return closeMenu();
        const before = (element.textContent ?? "").slice(0, offset);
        const trigger = findTrigger(before);
        const caret = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
        if (!trigger || !caret) return closeMenu();
        setMenu({ blockID: block.id, trigger, caret });
        setMenuIndex(0);
        if (trigger.type === "link") {
            api.searchCards(trigger.query, noteID).then(setLinkMatches).catch(onError);
        }
    }, [noteID, closeMenu, onError]);

    const onInput = useCallback((block: WriterBlock, element: HTMLElement) => {
        markEmpty(element);
        const plain = block.kind === "code";
        const text = readText(element, plain);
        if (block.kind !== "code") {
            const kind = shortcutKind(element.textContent ?? "");
            if (kind) {
                renderText(element, "", false);
                pending.current.set(block.id, "");
                void apply({ op: "patch", id: block.id, kind }, { id: block.id, offset: 0 });
                return;
            }
        }
        pending.current.set(block.id, text);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, SAVE_DELAY_MS);
        notify();
        updateTrigger(block, element);
    }, [apply, flush, notify, updateTrigger]);

    /** 把打到一半的 `/指令`、`[[連結` 從內文拿掉。 */
    const removeTrigger = (open: OpenTrigger, element: HTMLElement) => {
        const end = caretOffset(element) ?? (element.textContent?.length ?? 0);
        rangeOf(element, open.trigger.from, end).deleteContents();
        element.normalize();
        markEmpty(element);
        pending.current.set(open.blockID, readText(element, false));
    };

    const onLinkedEdit = useCallback(() => {
        setSheetRevision((value) => value + 1);
        notify();
    }, [notify]);

    const onTableType = useCallback((id: string, rows: TableRows) => {
        pendingTables.current.set(id, rows);
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(flush, SAVE_DELAY_MS);
        notify();
    }, [flush, notify]);

    const onTableChange = useCallback((id: string, rows: TableRows) => {
        pendingTables.current.delete(id);
        void apply({ op: "setTable", id, rows });
    }, [apply]);

    const onTableDelete = useCallback((id: string) => {
        pendingTables.current.delete(id);
        void apply({ op: "delete", ids: [id] });
    }, [apply]);

    const pickCommand = (command: SlashCommand) => {
        const open = menu;
        closeMenu();
        if (!open) return;
        const element = elements.current.get(open.blockID);
        if (!element) return;
        removeTrigger(open, element);
        const id = open.blockID;
        const empty = !element.textContent;
        if (command.id === "divider" || command.id === "pagebreak" || command.id === "toc") {
            void apply({ op: "addBlock", after: id, kind: command.id }).then(async (edit) => {
                if (!edit) return;
                const divider = edit.focus?.id ?? null;
                const next = await apply({ op: "addBlock", after: divider, kind: "paragraph" });
                // 刪掉空行時游標要留在新段落，不是跳回上一段。
                const stay = next?.focus ? { id: next.focus.id, offset: 0 } : undefined;
                if (empty) await apply({ op: "delete", ids: [id] }, stay);
            });
            return;
        }
        if (command.id === "table") {
            void insertEmbed({ type: "table", after: id, replace: empty }, { table: emptyTable(NEW_TABLE_ROWS, NEW_TABLE_COLS) });
            return;
        }
        if (command.id === "cells" || command.id === "chart" || command.id === "image") {
            flush();
            setEmbed({ type: command.id, after: id, replace: empty });
            return;
        }
        void apply({ op: "patch", id, kind: command.id }, { id, offset: "end" });
    };

    const insertEmbed = async (request: EmbedRequest, target: { source?: CellRange; target?: string; table?: TableRows; indent?: number; leaveColumns?: boolean }) => {
        setEmbed(null);
        const edit = await apply({ op: "addBlock", after: request.after, kind: request.type, ...target });
        if (!edit?.focus) return;
        const added = edit.focus.id;
        const last = edit.blocks[edit.blocks.length - 1];
        // 引入內容不能放游標，最後要留一段可以繼續打字。
        const tail = last.id === added ? await apply({ op: "addBlock", after: last.id, kind: "paragraph", indent: 0 }) : null;
        const stay = tail?.focus ? { id: tail.focus.id, offset: 0 } : undefined;
        if (request.replace && request.after) await apply({ op: "delete", ids: [request.after] }, stay);
        if (request.type === "table") {
            focusRequest.current = { id: added, offset: 0 };
            setRevision((value) => value + 1);
        }
    };

    /** 把剪貼簿的圖片存進媒體庫，放在 `block` 後面。空的區塊會被取代。 */
    const pasteImages = async (files: File[], block: WriterBlock, empty: boolean) => {
        let after = block.id;
        let replace = empty;
        for (const file of files) {
            try {
                const note = await api.importWriterImage(file);
                // 先放進清單，區塊畫出來時才找得到圖片。
                setImages((current) => new Map(current).set(note.id, note));
                const edit = await apply({ op: "addBlock", after, kind: "image", target: note.id });
                if (!edit?.focus) return;
                if (replace) await apply({ op: "delete", ids: [after] });
                replace = false;
                after = edit.focus.id;
            } catch (error) {
                onError(error);
                return;
            }
        }
        const blocksNow = await api.getWriter(noteID);
        if (blocksNow[blocksNow.length - 1]?.id === after) await apply({ op: "addBlock", after, kind: "paragraph", indent: 0 });
    };

    const pickLink = (match: Pick<CardMatch, "note">) => {
        const open = menu;
        closeMenu();
        if (!open) return;
        const element = elements.current.get(open.blockID);
        if (!element) return;
        const end = caretOffset(element) ?? 0;
        const range = rangeOf(element, open.trigger.from, end);
        range.deleteContents();
        const anchor = document.createElement("a");
        anchor.href = noteHref(match.note.id);
        anchor.textContent = cardTitle(match.note.content);
        range.insertNode(anchor);
        const selection = window.getSelection();
        selection?.collapse(anchor.parentNode, [...(anchor.parentNode?.childNodes ?? [])].indexOf(anchor) + 1);
        element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    };

    const commands = useMemo(() => (menu?.trigger.type === "slash" ? filterCommands(menu.trigger.query, card) : []), [menu, card]);
    const linkTitles = linkMatches.map((match) => cardTitle(match.note.content));
    const newLinkTitle = onCardCreated && menu?.trigger.type === "link" && isNewCardTitle(menu.trigger.query, linkTitles)
        ? menu.trigger.query.trim()
        : null;
    const optionCount = menu?.trigger.type === "link" ? linkMatches.length + (newLinkTitle === null ? 0 : 1) : commands.length;

    const pickLinkOption = (index: number) => {
        const match = linkMatches[index];
        if (match) {
            pickLink(match);
        } else if (newLinkTitle !== null) {
            api.createCard(newLinkTitle)
                .then((note) => {
                    onCardCreated?.();
                    pickLink({ note });
                })
                .catch(onError);
        } else {
            closeMenu();
        }
    };

    const pickActive = () => {
        if (menu?.trigger.type === "link") {
            pickLinkOption(menuIndex);
            return;
        }
        const command = commands[menuIndex];
        if (command) pickCommand(command);
        else closeMenu();
    };

    const neighbour = (id: string, step: -1 | 1) => {
        const list = visibleBlocks(blocks ?? []);
        let index = list.findIndex((block) => block.id === id) + step;
        while (list[index] && !hasText(list[index].kind)) index += step;
        return list[index] ?? null;
    };

    const onKeyDown = (evt: KeyboardEvent<HTMLDivElement>, block: WriterBlock, element: HTMLElement) => {
        if (evt.nativeEvent.isComposing) return;
        const plain = block.kind === "code";
        if (history(evt)) return;

        if (menu && optionCount > 0) {
            if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
                evt.preventDefault();
                const step = evt.key === "ArrowDown" ? 1 : optionCount - 1;
                setMenuIndex((index) => (index + step) % optionCount);
                return;
            }
            if (evt.key === "Enter" || evt.key === "Tab") {
                evt.preventDefault();
                pickActive();
                return;
            }
        }
        if (menu && evt.key === "Escape") {
            evt.preventDefault();
            closeMenu();
            return;
        }

        if (closable && evt.key === "Escape") {
            evt.preventDefault();
            evt.stopPropagation();
            closeRef.current?.();
            return;
        }

        const ctrl = evt.ctrlKey || evt.metaKey;
        if (!card && ctrl && evt.key === "Enter") {
            evt.preventDefault();
            void insertPageBreak(block, element);
            return;
        }
        if (!card && ctrl && evt.shiftKey && evt.key.toLowerCase() in ALIGN_KEYS) {
            evt.preventDefault();
            void apply({ op: "patch", id: block.id, align: ALIGN_KEYS[evt.key.toLowerCase()] }, { id: block.id, offset: caretOffset(element) ?? "end" });
            return;
        }
        if (ctrl && !plain) {
            const key = evt.key.toLowerCase();
            const command = key === "b" ? "bold" : key === "i" ? "italic" : null;
            if (command) {
                evt.preventDefault();
                document.execCommand(command);
                return;
            }
            if (evt.shiftKey && (key === "s" || key === "x")) {
                evt.preventDefault();
                document.execCommand("strikeThrough");
                return;
            }
            if (key === "k" && !window.getSelection()?.isCollapsed) {
                evt.preventDefault();
                startLink();
                return;
            }
            if (key === "e") {
                evt.preventDefault();
                wrapSelectionInCode();
                onInput(block, element);
                return;
            }
        }

        if (evt.key === "Tab") {
            evt.preventDefault();
            if (plain) {
                document.execCommand("insertText", false, "    ");
                return;
            }
            const next = evt.shiftKey ? Math.max(block.indent - 1, 0) : Math.min(block.indent + 1, indentLimit(blocks ?? [], block.id));
            if (next !== block.indent) void apply({ op: "patch", id: block.id, indent: next });
            return;
        }
        if (evt.key === "Enter") {
            if (evt.shiftKey) return;
            if (plain) {
                evt.preventDefault();
                document.execCommand("insertText", false, "\n");
                return;
            }
            evt.preventDefault();
            if (isDividerMarker(element.textContent ?? "")) {
                renderText(element, "", false);
                pending.current.set(block.id, "");
                void apply({ op: "patch", id: block.id, kind: "divider" }).then((edit) => {
                    if (edit) void apply({ op: "addBlock", after: block.id, kind: "paragraph" });
                });
                return;
            }
            const [before, after] = splitAtCaret(element, plain);
            pending.current.delete(block.id);
            void apply({ op: "split", id: block.id, before, after }).then((edit) => {
                if (edit?.focus) focusRequest.current = { id: edit.focus.id, offset: 0 };
                setRevision((value) => value + 1);
            });
            return;
        }
        if (evt.key === "Backspace" && caretOffset(element) === 0 && window.getSelection()?.isCollapsed) {
            evt.preventDefault();
            const previous = neighbour(block.id, -1);
            const length = previous ? elements.current.get(previous.id)?.textContent?.length ?? 0 : 0;
            const merges = block.kind === "paragraph" && block.indent === 0 && previous;
            pending.current.set(block.id, readText(element, plain));
            void apply({ op: "merge", id: block.id }).then((edit) => {
                if (!edit?.focus) return;
                focusRequest.current = { id: edit.focus.id, offset: merges && edit.focus.id !== block.id ? length : 0 };
                setRevision((value) => value + 1);
            });
            return;
        }
        if (evt.key === "ArrowUp" && caretOnEdgeLine(element, "top")) {
            const target = neighbour(block.id, -1);
            const next = target && elements.current.get(target.id);
            if (next) {
                evt.preventDefault();
                setCaret(next, "end");
            }
        }
        if (evt.key === "ArrowDown" && caretOnEdgeLine(element, "bottom")) {
            const target = neighbour(block.id, 1);
            const next = target && elements.current.get(target.id);
            if (next) {
                evt.preventDefault();
                setCaret(next, 0);
            }
        }
    };

    const startLink = () => {
        const selection = window.getSelection();
        savedRange.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        setLinkDraft("");
    };

    /** 從游標的地方換頁：前半留在這一頁，後半到下一頁。 */
    const insertPageBreak = async (block: WriterBlock, element: HTMLElement) => {
        const [before, after] = splitAtCaret(element, block.kind === "code");
        pending.current.delete(block.id);
        const edit = await apply({ op: "split", id: block.id, before, after });
        const next = edit?.focus?.id;
        if (!next) return;
        await apply({ op: "addBlock", after: block.id, kind: "pagebreak", indent: 0 }, { id: next, offset: 0 });
    };

    /** 拖曳圖片右下角改大小，放開才存。比例存成可用寬度的百分比，換紙張也合適。 */
    const startResize = (evt: PointerEvent<HTMLElement>, block: WriterBlock) => {
        if (evt.button !== 0) return;
        evt.preventDefault();
        evt.stopPropagation();
        const frame = evt.currentTarget.parentElement;
        const row = frame?.closest<HTMLElement>(".writer-row");
        if (!frame || !row) return;
        const startX = evt.clientX;
        const startWidth = frame.getBoundingClientRect().width;
        const area = row.getBoundingClientRect().width;
        // 置中時兩邊一起動；靠右時控制點在左邊。
        const speed = block.align === "center" ? 2 : block.align === "right" ? -1 : 1;
        let percent = (startWidth / area) * 100;
        const onMove = (move: globalThis.PointerEvent) => {
            percent = Math.min(100, Math.max(10, ((startWidth + (move.clientX - startX) * speed) / area) * 100));
            frame.style.width = `${percent}%`;
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            void apply({ op: "patch", id: block.id, width: Math.round(percent) });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    /** 選取文字時按工具列的對齊：對齊整個區塊。 */
    const alignSelection = (align: string) => {
        const node = window.getSelection()?.anchorNode;
        const row = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(".writer-row");
        if (row?.dataset.id) void apply({ op: "patch", id: row.dataset.id, align });
    };

    const goToHeading = (id: string) => {
        const element = sheet.current?.querySelector<HTMLElement>(`.writer-row[data-id="${id}"] .writer-text`);
        if (!element) return;
        setCaret(element, "end");
        element.scrollIntoView({ block: "center" });
    };

    const onPaste = async (evt: ClipboardEvent<HTMLDivElement>, block: WriterBlock, element: HTMLElement) => {
        evt.preventDefault();
        const empty = !element.textContent;
        if (block.kind !== "code") {
            // 從 Excels 複製的多格內容連回來源。
            const linked = cellsFromHtml(evt.clipboardData.getData("text/html"));
            if (!card && linked && !isSingleCell(linked)) {
                void insertEmbed({ type: "cells", after: block.id, replace: empty }, { source: linked });
                return;
            }
            // Excel 同時放了表格的圖片，所以要比圖片先看。
            const table = clipboardTable(evt.clipboardData);
            if (table) {
                void insertEmbed({ type: "table", after: block.id, replace: empty }, { table });
                return;
            }
            const files = [...evt.clipboardData.files].filter((file) => file.type.startsWith("image/"));
            if (files.length > 0) {
                flush();
                void pasteImages(files, block, empty);
                return;
            }
        }
        const lines = pastedLines(evt.clipboardData.getData("text/plain"));
        const [first, ...rest] = lines;
        document.execCommand("insertText", false, block.kind === "code" ? lines.join("\n") : first);
        if (block.kind === "code") return;
        let after = block.id;
        for (const line of rest) {
            const edit = await apply({ op: "addBlock", after, kind: block.kind === "bullet" || block.kind === "number" || block.kind === "todo" ? block.kind : "paragraph", text: line });
            if (!edit?.focus) return;
            after = edit.focus.id;
        }
    };

    // 選取文字時顯示格式工具列。
    useEffect(() => {
        const onSelection = () => {
            if (linkDraft !== null) return;
            const selection = window.getSelection();
            const anchor = selection?.anchorNode;
            const holder = anchor instanceof Element ? anchor : anchor?.parentElement;
            // 文件裡的 Note 有自己的編輯器和工具列。
            const inside = holder?.closest(".writer-editor") === root.current && holder?.closest(".writer-text");
            if (!selection || !inside || selection.isCollapsed || !selection.rangeCount) {
                setToolbar(null);
                return;
            }
            const rect = selection.getRangeAt(0).getBoundingClientRect();
            setToolbar({ left: rect.left + rect.width / 2, top: rect.top - 8 });
        };
        document.addEventListener("selectionchange", onSelection);
        return () => document.removeEventListener("selectionchange", onSelection);
    }, [linkDraft]);

    const applyLink = () => {
        const range = savedRange.current;
        const href = linkDraft?.trim();
        setLinkDraft(null);
        if (!range) return;
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (href) document.execCommand("createLink", false, href);
    };

    const startDrag = (evt: PointerEvent<HTMLElement>, id: string, menu = true) => {
        if (evt.button !== 0) return;
        evt.currentTarget.setPointerCapture(evt.pointerId);
        dragState.current = { id, startY: evt.clientY, moved: false, before: null, indent: 0, place: null, beside: null, menu };
    };

    /** 游標在哪個區塊或哪一組分欄的高度範圍裡。 */
    const rowAtHeight = (list: HTMLElement, y: number) => ([...list.children] as HTMLElement[]).find((child) => {
        const box = child.getBoundingClientRect();
        return y >= box.top && y <= box.bottom;
    });

    const moveDrag = (evt: PointerEvent<HTMLElement>) => {
        const state = dragState.current;
        const host = root.current;
        if (!state || !host || !blocks) return;
        if (!state.moved && Math.abs(evt.clientY - state.startY) < 4) return;
        state.moved = true;
        const group = new Set(blockGroup(blocks, state.id));
        const list = host.querySelector<HTMLElement>(".writer-blocks");
        if (!list) return;
        const hostBox = host.getBoundingClientRect();
        const hovered = rowAtHeight(list, evt.clientY);
        // 右側面板的分欄是上下排的，左右沒有意義，整組當成一塊。
        const columns = !draft && hovered?.classList.contains("writer-columns") ? [...hovered.children] as HTMLElement[] : null;
        const column = columns ? columnAt(evt.clientX, columns.map((item) => item.getBoundingClientRect())) : null;

        // 拖到旁邊：畫一條直線，放開就開新欄。
        const inside = column ? columns?.[column.index] : hovered;
        const otherRows = inside && ([...(columns ? inside.children : [inside])] as HTMLElement[]).filter((row) => !group.has(row.dataset.id ?? ""));
        const movingInside = columns !== null && columns.some((item) => [...item.children].every((row) => group.has((row as HTMLElement).dataset.id ?? "")));
        const room = !columns || columns.length < MAX_COLUMNS || movingInside;
        if (!draft && inside && otherRows && otherRows.length > 0 && room && !column?.inGap) {
            const box = inside.getBoundingClientRect();
            const side = dropSide(evt.clientX, box.left, box.right);
            if (side) {
                state.beside = { target: otherRows[0].dataset.id ?? "", side };
                const edge = side === "left" ? box.left - 3 : box.right + 1;
                setDrop({ top: box.top - hostBox.top + host.scrollTop, left: edge - hostBox.left, width: 3, height: box.height });
                return;
            }
        }
        state.beside = null;

        const area = columns && column ? columns[column.index] : null;
        const place = area ? { group: area.dataset.group ?? "", column: Number(area.dataset.column) } : null;
        // 欄裡排在欄內的區塊之間；欄外把整組分欄當成一塊。
        const rows = ([...(area ?? list).children] as HTMLElement[]).filter((row) => !group.has(row.dataset.id ?? ""));
        const firstID = (row: HTMLElement) => (row.classList.contains("writer-columns") ? row.querySelector<HTMLElement>(".writer-row") : row)?.dataset.id ?? null;
        const next = rows.find((row) => {
            const box = row.getBoundingClientRect();
            return evt.clientY < box.top + box.height / 2;
        });
        const nextIndex = next ? rows.indexOf(next) : rows.length;
        const previous = rows[nextIndex - 1];
        const previousBlock = blocks.find((block) => block.id === previous?.dataset.id);
        const line = next ? next.getBoundingClientRect().top : (previous?.getBoundingClientRect().bottom ?? hostBox.top);
        const box = (area ?? list).getBoundingClientRect();
        const limit = previousBlock ? previousBlock.indent + 1 : 0;
        const zoom = placement?.scale ?? 1;
        const indent = Math.max(0, Math.min(limit, Math.round((evt.clientX - box.left) / zoom / INDENT_WIDTH)));
        const lastInColumn = place ? blocks.map((block) => block.group === place.group && block.column === place.column).lastIndexOf(true) : -1;
        const afterColumn = blocks.slice(lastInColumn + 1).find((block) => !group.has(block.id))?.id ?? null;
        state.before = next ? firstID(next) : (place ? afterColumn : null);
        state.indent = indent;
        state.place = place;
        setDrop({
            top: (line - hostBox.top) / zoom + host.scrollTop,
            left: (box.left - hostBox.left) / zoom + indent * INDENT_WIDTH,
            width: box.width / zoom - indent * INDENT_WIDTH,
        });
    };

    const endDrag = (evt: PointerEvent<HTMLElement>, id: string) => {
        const state = dragState.current;
        dragState.current = null;
        setDrop(null);
        if (!state || !blocks) return;
        if (state.moved) {
            const ids = blockGroup(blocks, id);
            const { before, indent, place, beside } = state;
            if (beside) void apply({ op: "moveBeside", ids, ...beside });
            else void apply({ op: "move", ids, before, indent, group: place?.group ?? null, column: place?.column });
            return;
        }
        if (state.menu) setBlockMenu({ x: evt.clientX, y: evt.clientY, id });
    };

    const addBelow = (block: WriterBlock) => {
        void apply({ op: "addBlock", after: block.id, kind: "paragraph", text: "/" }).then((edit) => {
            const element = edit?.focus && elements.current.get(edit.focus.id);
            const target = edit?.blocks.find((item) => item.id === edit.focus?.id);
            if (element && target) window.requestAnimationFrame(() => updateTrigger(target, element));
        });
    };

    /** 點文件下方的空白處：回到最後一段，最後不是文字時多開一段。 */
    const onBottomClick = () => {
        const last = blocks?.[blocks.length - 1];
        if (!last) return;
        if (last.group) {
            void apply({ op: "addBlock", after: last.id, kind: "paragraph", indent: 0, leaveColumns: true });
            return;
        }
        const element = elements.current.get(last.id);
        if (element && !(last.kind !== "paragraph" && element.textContent)) setCaret(element, "end");
        else void apply({ op: "addBlock", after: last.id, kind: "paragraph", indent: 0 });
    };

    /** 版面上的每一列，由上到下。 */
    const dropRows = (): DropRow[] => {
        const list = root.current?.querySelector(".writer-blocks");
        return ([...(list?.children ?? [])] as HTMLElement[]).map((row) => {
            const inner = row.classList.contains("writer-columns") ? [...row.querySelectorAll<HTMLElement>(".writer-row")] : [row];
            const box = row.getBoundingClientRect();
            const first = inner[0]?.dataset.id ?? "";
            const text = elements.current.get(first);
            return {
                first,
                last: inner[inner.length - 1]?.dataset.id ?? "",
                top: box.top,
                bottom: box.bottom,
                empty: row.dataset.kind === "paragraph" && text !== undefined && !text.textContent,
                columns: inner.length > 1 || row.classList.contains("writer-columns"),
            };
        });
    };

    const insideEditor = (x: number, y: number) => {
        const host = root.current;
        return host !== null && host.contains(document.elementFromPoint(x, y));
    };

    /** 表格連回 Excels，圖表跟著來源，其他是卡片。整份 Excels 放第一個表格。 */
    const dropCard = async (noteID: string, y: number, tableID?: string) => {
        const { after, replace, leaveColumns } = cardDropAt(dropRows(), y);
        const place = { indent: 0, leaveColumns };
        try {
            const note = await api.getNote(noteID);
            if (note?.type === "chart") {
                await insertEmbed({ type: "chart", after, replace }, { target: noteID, ...place });
            } else if (note?.type === "sheet") {
                const { tables } = await api.getSheet(noteID);
                const table = tables.find((item) => item.id === tableID) ?? tables[0];
                if (!table) return;
                const source = { noteId: noteID, tableId: table.id, rows: table.rows.map((row) => row.id), cols: table.cols.map((col) => col.id) };
                await insertEmbed({ type: "cells", after, replace }, { source, ...place });
            } else {
                await insertEmbed({ type: "card", after, replace }, { target: noteID, ...place });
            }
        } catch (error) {
            onError(error);
        }
    };

    const placedCards = useMemo(
        () => new Set((blocks ?? []).flatMap((block) => (block.kind === "card" && block.noteId ? [block.noteId] : []))),
        [blocks],
    );

    useCardSurface(onSurface, "文件", placedCards, {
        placeAt: (id, x, y, tableID) => {
            if (insideEditor(x, y)) void dropCard(id, y, tableID);
        },
        placeAtCenter: (id, tableID) => void dropCard(id, Number.POSITIVE_INFINITY, tableID),
        hover: (point) => {
            const host = root.current;
            const list = host?.querySelector(".writer-blocks");
            if (!point || !host || !list || !insideEditor(point.x, point.y)) {
                setDrop(null);
                return;
            }
            const hostBox = host.getBoundingClientRect();
            const box = list.getBoundingClientRect();
            setDrop({
                top: cardDropAt(dropRows(), point.y).line - hostBox.top + host.scrollTop,
                left: box.left - hostBox.left,
                width: box.width,
            });
        },
    }, true);

    if (!blocks || (!page && !card)) return inline ? null : <div className="writer-editor" />;
    const numbers = listNumbers(blocks);
    const visible = visibleBlocks(blocks);

    const columnItems = (id: string) => (blocks.find((block) => block.id === id)?.group
        ? [{ label: "取消分欄", onSelect: () => void apply({ op: "uncolumn", id }) }]
        : []);

    /** 文字和圖片可以對齊。 */
    const alignItems = (id: string) => {
        const kind = blocks.find((block) => block.id === id)?.kind ?? "";
        if (card || (!hasText(kind) && kind !== "image" && kind !== "card")) return [];
        return ALIGNS.filter((item) => hasText(kind) || item.id !== "justify").map(({ id: align, label }) => ({
            label,
            onSelect: () => void apply({ op: "patch", id, align }),
        }));
    };

    const renderRow = (block: WriterBlock) => (
        <div
            key={block.id}
            className="writer-row"
            data-id={block.id}
            data-kind={block.kind}
            data-align={block.align ?? undefined}
            style={{ marginLeft: `calc(var(--writer-indent, ${INDENT_WIDTH}px) * ${block.indent})` }}
        >
            <div className="writer-handles" contentEditable={false}>
                <button title="在下方新增區塊" onClick={() => addBelow(block)}>+</button>
                <button
                    title="拖曳搬移，點一下開啟選單"
                    onPointerDown={(evt) => startDrag(evt, block.id)}
                    onPointerMove={moveDrag}
                    onPointerUp={(evt) => endDrag(evt, block.id)}
                    onContextMenu={(evt) => {
                        evt.preventDefault();
                        setBlockMenu({ x: evt.clientX, y: evt.clientY, id: block.id });
                    }}
                >
                    ⠿
                </button>
            </div>
            {block.kind === "todo" && (
                <input
                    type="checkbox"
                    className="writer-check"
                    aria-label="完成"
                    checked={block.checked}
                    onChange={(evt) => void apply({ op: "patch", id: block.id, checked: evt.target.checked })}
                />
            )}
            {block.kind === "toggle" && (
                <button
                    className="writer-toggle"
                    aria-expanded={!block.collapsed}
                    aria-label={block.collapsed ? "展開" : "收合"}
                    onClick={() => void apply({ op: "patch", id: block.id, collapsed: !block.collapsed })}
                >
                    {block.collapsed ? "▸" : "▾"}
                </button>
            )}
            {block.kind === "bullet" && <span className="writer-marker">•</span>}
            {block.kind === "number" && <span className="writer-marker">{numbers.get(block.id)}.</span>}
            {block.kind === "callout" && <span className="writer-marker">💡</span>}
            {hasText(block.kind) && (
                <EditableText
                    block={block}
                    revision={revision}
                    register={register}
                    placeholder={PLACEHOLDERS[block.kind] ?? ""}
                    highlighted={card && block.kind === "code"}
                    onInput={onInput}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                />
            )}
            {card && block.kind === "code" && (
                <span className="writer-language" contentEditable={false}>
                    <LanguageSelect
                        value={fenceToLanguage(block.language ?? "")}
                        onChange={(language) => void apply({ op: "patch", id: block.id, language: languageToFence(language) })}
                    />
                </span>
            )}
            {block.kind === "divider" && <hr className="writer-divider" />}
            {block.kind === "pagebreak" && <div className="writer-pagebreak"><span>換頁</span></div>}
            {block.kind === "toc" && (
                <div className="writer-toc">
                    <p className="writer-toc-title">目錄</p>
                    {toc.length === 0 && <p className="writer-toc-empty">加上標題後會出現在這裡。</p>}
                    {toc.map((entry) => (
                        <button key={entry.id} className="writer-toc-row" data-level={entry.level} onClick={() => goToHeading(entry.id)}>
                            <span className="writer-toc-text">{entry.text || "未命名標題"}</span>
                            {entry.page !== null && <span className="writer-toc-page">{entry.page}</span>}
                        </button>
                    ))}
                </div>
            )}
            {block.kind === "table" && (
                <TableBlock
                    block={block}
                    revision={revision}
                    register={register}
                    onType={onTableType}
                    onChange={onTableChange}
                    onDelete={onTableDelete}
                    onHistory={history}
                />
            )}
            {block.kind === "cells" && block.source && (
                <LinkedTable source={block.source} revision={sheetRevision} onEdited={onLinkedEdit} onError={onError} />
            )}
            {block.kind === "chart" && block.noteId && (
                <div className="writer-embed writer-chart"><ChartView noteID={block.noteId} revision={sheetRevision} onError={onError} /></div>
            )}
            {block.kind === "card" && block.noteId && (
                <div
                    className="writer-image-frame writer-card"
                    data-sized={block.width !== null}
                    style={block.width !== null ? { width: `${block.width}%` } : undefined}
                    // Note 裡要能選字，只有其他類型靠拖曳本身搬移。Note 用左邊的把手。
                    onPointerDown={(evt) => {
                        if (!(evt.target as Element).closest(".writer-editor")?.isSameNode(root.current)) return;
                        startDrag(evt, block.id, false);
                    }}
                    onPointerMove={moveDrag}
                    onPointerUp={(evt) => endDrag(evt, block.id)}
                    onDoubleClick={(evt) => {
                        if ((evt.target as Element).closest(".writer-editor")?.isSameNode(root.current)) onPeekCard?.(block.noteId ?? "");
                    }}
                >
                    <PlacedCard
                        noteID={block.noteId}
                        revision={cardRevision}
                        renderNote={(id) => (
                            <EmbeddedNote
                                noteID={id}
                                revision={cardRevision}
                                onChanged={(changed) => onCardChanged?.(changed)}
                                onContentChange={() => refreshContent.current()}
                                onOpenLink={onOpenLink}
                                onCardCreated={onCardCreated}
                                onError={onError}
                            />
                        )}
                        onError={onError}
                    />
                    <span className="writer-image-resize" title="拖曳調整大小" onPointerDown={(evt) => startResize(evt, block)} />
                </div>
            )}
            {block.kind === "image" && block.noteId && (() => {
                const note = images.get(block.noteId);
                const info = note ? imageInfo(note) : null;
                return info
                    ? (
                        <div className="writer-image-frame" data-sized={block.width !== null} style={block.width !== null ? { width: `${block.width}%` } : undefined}>
                            <img
                                className="writer-image"
                                src={mediaUrl(info.file)}
                                alt={info.name}
                                draggable={false}
                                onPointerDown={(evt) => startDrag(evt, block.id, false)}
                                onPointerMove={moveDrag}
                                onPointerUp={(evt) => endDrag(evt, block.id)}
                            />
                            <span className="writer-image-resize" title="拖曳調整大小" onPointerDown={(evt) => startResize(evt, block)} />
                        </div>
                    )
                    : <p className="cells-error">圖片已被刪除</p>;
            })()}
        </div>
    );

    /** 白板的編輯器有縮放，選單用的是視窗座標，要放到外面。 */
    const floating = (content: React.ReactNode) => (inline || embedded ? createPortal(content, document.body) : content);

    return (
        <div
            ref={root}
            className="writer-editor"
            data-card={card || undefined}
            data-inline={inline || undefined}
            data-embedded={embedded || undefined}
            data-fit={placement?.fitContent || undefined}
            style={placement && {
                left: placement.left,
                top: placement.top,
                width: placement.width,
                height: placement.fitContent ? undefined : placement.height,
                padding,
                paddingTop: placement.paddingTop,
                transform: `scale(${placement.scale})`,
            }}
            onKeyDown={(evt) => {
                if ((evt.target as HTMLElement).closest(".writer-text, .writer-cell, input, textarea")) return;
                history(evt);
            }}
            onClick={(evt) => {
                const anchor = (evt.target as Element).closest?.(".writer-text a");
                if (!anchor) return;
                evt.preventDefault();
                onOpenLink(anchor.getAttribute("href") ?? "");
            }}
        >
            {box && page && toolsSlot && createPortal(
                <>
                    <span className="writer-stats">{pages} 頁 · {words.toLocaleString()} 字</span>
                    <button className="panel-back writer-tool" title="尋找與取代 (Ctrl+F)" onClick={() => setFinding(true)}>尋找</button>
                    <button className="panel-back writer-tool" title="列印或存成 PDF (Ctrl+P)" onClick={() => setPrinting(true)}>列印</button>
                    <PageSetup page={page} pages={pages} onChange={changePage} />
                </>,
                toolsSlot,
            )}
            {finding && <WriterFind host={sheet} onClose={() => setFinding(false)} />}
            <div
                ref={sheet}
                className="writer-page"
                data-draft={!box}
                style={box ? {
                    width: box.width,
                    height: sheetHeight(box, pages) - (printing ? PRINT_SLACK : 0),
                    padding: box.margin,
                    zoom: scale,
                    "--writer-page-content": `${box.contentHeight}px`,
                } as CSSProperties : undefined}
            >
                {!card && <DocumentTitle noteID={noteID} placeholder="未命名文件" onChanged={changed} onError={onError} />}
                <div className="writer-blocks">
                    {blockRuns(visible).map((run) => (run.type === "block" ? renderRow(run.block) : (
                        <div key={run.group} className="writer-columns" data-id={run.group}>
                            {run.columns.map((column, index) => (
                                <div key={index} className="writer-column" data-group={run.group} data-column={index}>
                                    {column.map(renderRow)}
                                </div>
                            ))}
                        </div>
                    )))}
                </div>
                <div className="writer-bottom" onClick={onBottomClick} />
                {box && Array.from({ length: pages - 1 }, (_, index) => (
                    <div
                        key={index}
                        className="writer-break"
                        style={{ top: index * box.pitch + box.height - box.margin, height: box.margin * 2 + box.pitch - box.height }}
                    />
                ))}
                {box && page && <PageBands page={page} box={box} pages={pages} onType={onBandType} />}
            </div>
            {drop && <div className="writer-drop" style={drop} />}
            {toolbar && floating(
                <div
                    className="note-format-bar writer-format"
                    style={{ left: toolbar.left, top: toolbar.top }}
                    onMouseDown={(evt) => {
                        if (!(evt.target instanceof HTMLInputElement)) evt.preventDefault();
                    }}
                >
                    {linkDraft !== null ? (
                        <input
                            className="note-link-input"
                            autoFocus
                            placeholder="輸入網址後按 Enter"
                            value={linkDraft}
                            onChange={(evt) => setLinkDraft(evt.target.value)}
                            onKeyDown={(evt) => {
                                if (evt.key === "Enter") {
                                    evt.preventDefault();
                                    applyLink();
                                }
                                if (evt.key === "Escape") {
                                    evt.preventDefault();
                                    evt.stopPropagation();
                                    setLinkDraft(null);
                                }
                            }}
                        />
                    ) : (
                        <>
                            {!card && ALIGNS.map(({ id, label, icon }) => (
                                <button key={label} title={`${label} (Ctrl+Shift+${"LERJ"[ALIGNS.findIndex((item) => item.id === id)]})`} onClick={() => alignSelection(id)}>{icon}</button>
                            ))}
                            {!card && <span className="note-format-divider" />}
                            <button title="粗體 (Ctrl+B)" onClick={() => document.execCommand("bold")}><b>B</b></button>
                            <button title="斜體 (Ctrl+I)" onClick={() => document.execCommand("italic")}><i>I</i></button>
                            <button title="刪除線 (Ctrl+Shift+S)" onClick={() => document.execCommand("strikeThrough")}><s>S</s></button>
                            <button
                                title="行內程式碼 (Ctrl+E)"
                                onClick={() => {
                                    const node = window.getSelection()?.anchorNode;
                                    const host = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(".writer-text");
                                    wrapSelectionInCode();
                                    host?.dispatchEvent(new InputEvent("input", { bubbles: true }));
                                }}
                            >
                                <code>{"<>"}</code>
                            </button>
                            <button title="連結 (Ctrl+K)" onClick={startLink}>🔗</button>
                        </>
                    )}
                </div>,
            )}
            {menu?.trigger.type === "slash" && commands.length > 0 && floating(
                <div
                    className="writer-slash"
                    role="listbox"
                    aria-label="區塊類型"
                    style={{
                        left: Math.min(menu.caret.left, window.innerWidth - MENU_WIDTH - 8),
                        ...(menu.caret.bottom + MENU_HEIGHT < window.innerHeight
                            ? { top: menu.caret.bottom + 4 }
                            : { bottom: window.innerHeight - menu.caret.top + 4 }),
                    }}
                    onMouseDown={(evt) => evt.preventDefault()}
                >
                    {commands.map((command, index) => (
                        <button
                            key={command.id}
                            role="option"
                            aria-selected={index === menuIndex}
                            onMouseEnter={() => setMenuIndex(index)}
                            onClick={() => pickCommand(command)}
                        >
                            <span>{command.label}</span>
                            <span className="card-link-source">{command.hint}</span>
                        </button>
                    ))}
                </div>,
            )}
            {menu?.trigger.type === "link" && floating(
                <CardPicker
                    caret={menu.caret}
                    matches={linkMatches}
                    newTitle={newLinkTitle}
                    activeIndex={Math.min(menuIndex, Math.max(optionCount - 1, 0))}
                    onActivate={setMenuIndex}
                    onPick={pickLinkOption}
                />,
            )}
            {blockMenu && floating(
                <ContextMenu
                    x={blockMenu.x}
                    y={blockMenu.y}
                    items={[
                        ...(blocks.find((block) => block.id === blockMenu.id)?.kind === "card"
                            ? []
                            : [{ label: "複製區塊", onSelect: () => void apply({ op: "duplicate", id: blockMenu.id }) }]),
                        { label: "刪除區塊", onSelect: () => void apply({ op: "delete", ids: [blockMenu.id] }) },
                        ...columnItems(blockMenu.id),
                        ...alignItems(blockMenu.id),
                        { label: "轉成文字", onSelect: () => void apply({ op: "patch", id: blockMenu.id, kind: "paragraph" }) },
                        { label: "轉成標題 1", onSelect: () => void apply({ op: "patch", id: blockMenu.id, kind: "h1" }) },
                        { label: "轉成待辦清單", onSelect: () => void apply({ op: "patch", id: blockMenu.id, kind: "todo" }) },
                    ].filter((item) => hasText(blocks.find((block) => block.id === blockMenu.id)?.kind ?? "") || !item.label.startsWith("轉成"))}
                    onClose={() => setBlockMenu(null)}
                />,
            )}
            {embed?.type === "cells" && (
                <SheetRangePicker
                    onPick={(source) => void insertEmbed(embed, { source })}
                    onCancel={() => setEmbed(null)}
                    onError={onError}
                />
            )}
            {(embed?.type === "chart" || embed?.type === "image") && floating(
                <NotePicker
                    type={embed.type}
                    onPick={(note) => void insertEmbed(embed, { target: note.id })}
                    onCancel={() => setEmbed(null)}
                    onError={onError}
                />,
            )}
        </div>
    );
}

export default WriterEditor;
