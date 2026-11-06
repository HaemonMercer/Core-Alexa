import "../../App.css";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import * as api from "../../api.ts";
import type { Arrow, ArrowDirection, Note, PlacedNote, SheetState, WorkspaceState } from "../../types.ts";
import WriterEditor from "../writer/WriterEditor.tsx";
import MindmapEditor from "../mindmap/MindmapEditor.tsx";
import ContextMenu from "../common/ContextMenu.tsx";
import { useNoteDeletion, useWhiteboardDeletion } from "../common/useDeletion.tsx";
import { deleteLabel } from "../../noteTypes.ts";
import VideoPlayer from "../media/VideoPlayer.tsx";
import TablePicker from "../office/TablePicker.tsx";
import WhiteboardNameInput from "../whiteboards/WhiteboardNameInput.tsx";
import ArrangeBar from "./ArrangeBar.tsx";
import {
    BoardController,
    type ArrowLabelDraft,
    type CardAnchor,
    type MapEditAnchor,
    type Editing,
    type MenuAnchor,
    type Renaming,
    type VideoAnchor,
} from "./controller.ts";
import { TILE_TITLE_HEIGHT } from "./gestures.ts";
import { NOTE_PADDING } from "./noteRenderer.ts";

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm"];

const ARROW_DIRECTIONS: { direction: ArrowDirection; label: string }[] = [
    { direction: "forward", label: "單向 →" },
    { direction: "backward", label: "單向 ←" },
    { direction: "both", label: "雙向 ↔" },
    { direction: "none", label: "無箭頭 —" },
];

/** 正在選表格：放新卡片（`at`），或替既有的卡片換表格（`placed`）。 */
type TablePick = {
    note: Note;
    sheet: SheetState;
    taken: Set<string>;
} & ({ at: { x: number; y: number } } | { placed: PlacedNote });

/** 畫布之外的元件能對白板做的事。 */
export interface BoardHandle {
    placeCardAt: (noteID: string, clientX: number, clientY: number, tableID?: string) => void;
    placeCardAtCenter: (noteID: string, tableID?: string) => void;
    refresh: () => void;
}

interface CanvasProps {
    ref: Ref<BoardHandle>;
    whiteboardID: string;
    /** Root 只放白板：雙擊空白處新增白板，也不能貼上筆記。 */
    isRoot: boolean;
    onOpenWhiteboard: (id: string) => void;
    onOpenWhiteboardInTab: (id: string) => void;
    onOpenNoteInTab: (noteID: string) => void;
    onWorkspaceChange: (workspace: WorkspaceState) => void;
    /** 雙擊卡片：右側面板換成它的內容。 */
    onOpenCard: (noteID: string) => void;
    onOpenFullscreen: (noteID: string) => void;
    /** 換到這個白板：右側面板回到 Card Library。 */
    onCardCreated: () => void;
    onPlacedNotes: (noteIDs: ReadonlySet<string>) => void;
    onInlineEditChange: (noteID: string | null) => void;
    /** 卡片的內容在 Rust，改完要讀回來。 */
    onCardChanged: (noteID: string) => void;
    /** 箭頭改變時呼叫，卡片的連結清單要重新計算。 */
    onLinksChange: () => void;
    onCardDeleted: (ids: string[]) => void;
    onWhiteboardDeleted: (workspace: WorkspaceState) => void;
    onOpenLink: (href: string) => void;
    /** 其他地方改過的卡片內容，要反映到畫布上。 */
    syncedCard: { id: string; content: string } | null;
    onError: (error: unknown) => void;
}

function Canvas({
    ref,
    whiteboardID,
    isRoot,
    onOpenWhiteboard,
    onOpenWhiteboardInTab,
    onOpenNoteInTab,
    onWorkspaceChange,
    onOpenCard,
    onOpenFullscreen,
    onCardCreated,
    onPlacedNotes,
    onInlineEditChange,
    onCardChanged,
    onLinksChange,
    onCardDeleted,
    onWhiteboardDeleted,
    onOpenLink,
    syncedCard,
    onError,
}: CanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const controllerRef = useRef<BoardController | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    const [renaming, setRenaming] = useState<Renaming | null>(null);
    const [arrowLabel, setArrowLabel] = useState<ArrowLabelDraft | null>(null);
    const [menu, setMenu] = useState<MenuAnchor | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);
    const [selectedCount, setSelectedCount] = useState(0);
    const [cardAnchor, setCardAnchor] = useState<CardAnchor | null>(null);
    const [videoAnchor, setVideoAnchor] = useState<VideoAnchor | null>(null);
    const [mapEdit, setMapEdit] = useState<MapEditAnchor | null>(null);
    const [importing, setImporting] = useState(0);
    const trackImporting = useCallback((delta: number) => setImporting((count) => count + delta), []);
    const [tablePick, setTablePick] = useState<TablePick | null>(null);
    const cancelTablePick = useCallback(() => setTablePick(null), []);

    const takenTables = useCallback((noteID: string, sheet: SheetState) => {
        const shown = controllerRef.current?.shownTables(noteID) ?? [];
        const first = sheet.tables[0]?.id;
        return new Set(shown.map((id) => id ?? first).filter((id): id is string => id !== undefined));
    }, []);

    /** 有多個表格的 Excels 要先選表格，已經指定表格或其他內容直接放。 */
    const place = useCallback(async (noteID: string, at: { x: number; y: number } | null | undefined, tableID?: string) => {
        if (!at) return;
        if (tableID) {
            controllerRef.current?.placeAt(noteID, at.x, at.y, tableID);
            return;
        }
        try {
            const note = await api.getNote(noteID);
            if (note?.type === "sheet") {
                const sheet = await api.getSheet(noteID);
                if (sheet.tables.length > 1) {
                    setTablePick({ note, sheet, taken: takenTables(noteID, sheet), at });
                    return;
                }
            }
            controllerRef.current?.placeAt(noteID, at.x, at.y);
        } catch (error) {
            onError(error);
        }
    }, [onError, takenTables]);

    const changeTable = async (placed: PlacedNote, note: Note) => {
        try {
            const sheet = await api.getSheet(note.id);
            setTablePick({ note, sheet, taken: takenTables(note.id, sheet), placed });
        } catch (error) {
            onError(error);
        }
    };

    const pickTable = (tableID: string) => {
        const pick = tablePick;
        setTablePick(null);
        if (!pick) return;
        if ("at" in pick) controllerRef.current?.placeAt(pick.note.id, pick.at.x, pick.at.y, tableID);
        else controllerRef.current?.setPlacedTable(pick.placed.id, tableID);
    };

    useImperativeHandle(ref, () => ({
        placeCardAt: (noteID, clientX, clientY, tableID) => void place(noteID, controllerRef.current?.worldPointAt(clientX, clientY), tableID),
        placeCardAtCenter: (noteID, tableID) => void place(noteID, controllerRef.current?.centerPoint(), tableID),
        refresh: () => controllerRef.current?.refresh(),
    }), [place]);

    const imageInput = useRef<HTMLInputElement>(null);
    const imageTarget = useRef({ x: 0, y: 0 });

    const noteDeletion = useNoteDeletion(onCardDeleted, onError);
    const whiteboardDeletion = useWhiteboardDeletion((workspace) => {
        onWhiteboardDeleted(workspace);
        controllerRef.current?.refresh();
    }, onError);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const controller = new BoardController(canvas, ctx, whiteboardID, isRoot, {
            onOpenWhiteboard,
            onWorkspaceChange,
            onOpenCard,
            onOpenFullscreen,
            onCardCreated,
            onLinksChange,
            onSelectionCount: setSelectedCount,
            onCardAnchor: setCardAnchor,
            onMapEdit: setMapEdit,
            onVideoAnchor: setVideoAnchor,
            onImporting: trackImporting,
            onPlacedNotes,
            onEdit: setEditing,
            onRename: setRenaming,
            onEditArrowLabel: setArrowLabel,
            onMenu: setMenu,
            onError,
        });
        controllerRef.current = controller;
        return () => controller.dispose();
    }, [
        whiteboardID, isRoot, onOpenWhiteboard, onWorkspaceChange,
        onOpenCard, onOpenFullscreen, onCardCreated, onPlacedNotes, onLinksChange, onError, trackImporting,
    ]);

    const noteMenuItems = (placed: PlacedNote) => {
        const { id, noteID, autoFit } = placed;
        const note = controllerRef.current?.noteOf(noteID) ?? null;
        const remove = { label: "從白板移除", onSelect: () => controllerRef.current?.removeNote(id) };
        if (note?.type === "whiteboard") {
            return [
                { label: "開啟白板", onSelect: () => onOpenWhiteboard(noteID) },
                { label: "在新分頁開啟", onSelect: () => onOpenWhiteboardInTab(noteID) },
                {
                    label: "刪除白板",
                    onSelect: () => whiteboardDeletion.ask([{ id: noteID, name: note.content }]),
                },
            ];
        }
        if (!note) return [remove];
        const fit = {
            label: autoFit ? "✓ 自適應高度" : "自適應高度",
            onSelect: () => controllerRef.current?.setAutoFit(id, !autoFit),
        };
        return [
            { label: "在新分頁開啟", onSelect: () => onOpenNoteInTab(noteID) },
            ...(note.type === "card" || note.type === "code" ? [fit] : []),
            ...(note.type === "sheet" ? [{ label: "更換表格", onSelect: () => void changeTable(placed, note) }] : []),
            remove,
            { label: deleteLabel([note]), onSelect: () => noteDeletion.ask([note]) },
        ];
    };

    useEffect(() => {
        if (!syncedCard) return;
        controllerRef.current?.setNoteContent(syncedCard.id, syncedCard.content);
    }, [syncedCard]);

    const inlineNoteID = editing?.noteID ?? mapEdit?.noteID ?? null;
    useEffect(() => {
        onInlineEditChange(inlineNoteID);
        return () => onInlineEditChange(null);
    }, [inlineNoteID, onInlineEditChange]);

    const arrowMenuItems = (arrow: Arrow) => [
        ...ARROW_DIRECTIONS.map(({ direction, label }) => ({
            label,
            disabledReason: direction === arrow.direction ? "目前的方向" : undefined,
            onSelect: () => controllerRef.current?.updateArrow(arrow.id, { direction }),
        })),
        { label: "編輯標籤", onSelect: () => controllerRef.current?.editArrowLabel(arrow) },
        { label: "刪除箭頭", onSelect: () => controllerRef.current?.removeArrow(arrow.id) },
    ];

    return (
        <>
            <canvas ref={canvasRef} />
            <input
                ref={imageInput}
                className="image-input"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                multiple
                aria-label="選擇圖片"
                onChange={(evt) => {
                    const files = [...(evt.target.files ?? [])];
                    // 清掉才能再選一次同一個檔案。
                    evt.target.value = "";
                    const { x, y } = imageTarget.current;
                    void controllerRef.current?.importImages(files, x, y);
                }}
            />
            {isRoot && (
                <div className="root-actions">
                    <button onClick={() => controllerRef.current?.createWhiteboardAtCenter()}>新增白板</button>
                </div>
            )}
            {menu && (
                <ContextMenu
                    x={menu.clientX}
                    y={menu.clientY}
                    items={menu.arrow ? arrowMenuItems(menu.arrow) : menu.placed ? noteMenuItems(menu.placed) : [
                        {
                            label: "新增 Card",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createCard(menu.x, menu.y),
                        },
                        {
                            label: "新增圖片",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => {
                                imageTarget.current = { x: menu.x, y: menu.y };
                                imageInput.current?.click();
                            },
                        },
                        {
                            label: "新增影片",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => {
                                const { x, y } = menu;
                                open({ multiple: true, filters: [{ name: "影片", extensions: VIDEO_EXTENSIONS }] })
                                    .then((paths) => controllerRef.current?.importPaths(paths ?? [], x, y))
                                    .catch(onError);
                            },
                        },
                        {
                            label: "新增 Code Block",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("code", menu.x, menu.y),
                        },
                        {
                            label: "新增 Mermaid",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("mermaid", menu.x, menu.y),
                        },
                        {
                            label: "新增 Mind map",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("mindmap", menu.x, menu.y),
                        },
                        {
                            label: "新增 Draw.io",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("drawio", menu.x, menu.y),
                        },
                        {
                            label: "新增 Writer",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("writer", menu.x, menu.y),
                        },
                        {
                            label: "新增 Excels",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("sheet", menu.x, menu.y),
                        },
                        {
                            label: "新增 Slides",
                            disabledReason: isRoot ? "Root 只能放白板" : undefined,
                            onSelect: () => void controllerRef.current?.createNote("slides", menu.x, menu.y),
                        },
                        {
                            label: "新增 Whiteboard",
                            onSelect: () => void controllerRef.current?.createWhiteboard(menu.x, menu.y),
                        },
                    ]}
                    onClose={closeMenu}
                />
            )}
            {tablePick && (
                <TablePicker
                    note={tablePick.note}
                    sheet={tablePick.sheet}
                    taken={tablePick.taken}
                    lockTaken={"placed" in tablePick}
                    current={"placed" in tablePick ? tablePick.placed.tableID ?? tablePick.sheet.tables[0]?.id : undefined}
                    onPick={pickTable}
                    onCancel={cancelTablePick}
                />
            )}
            {noteDeletion.dialog}
            {whiteboardDeletion.dialog}
            {arrowLabel && (
                <WhiteboardNameInput
                    key={arrowLabel.id}
                    className="arrow-label-input"
                    ariaLabel="箭頭標籤"
                    allowEmpty
                    name={arrowLabel.label}
                    style={{ left: arrowLabel.left, top: arrowLabel.top }}
                    onSubmit={(label) => {
                        setArrowLabel(null);
                        controllerRef.current?.updateArrow(arrowLabel.id, { label });
                    }}
                    onCancel={() => setArrowLabel(null)}
                />
            )}
            {renaming && (
                <WhiteboardNameInput
                    key={renaming.whiteboardID}
                    className="tile-name-input"
                    name={renaming.name}
                    style={{
                        left: renaming.left,
                        top: renaming.top,
                        width: renaming.width,
                        height: TILE_TITLE_HEIGHT,
                        transform: `scale(${renaming.scale})`,
                    }}
                    onSubmit={(name) => {
                        setRenaming(null);
                        controllerRef.current?.submitRename(renaming.whiteboardID, name);
                    }}
                    onCancel={() => setRenaming(null)}
                />
            )}
            {videoAnchor && (
                <VideoPlayer
                    anchor={videoAnchor}
                    onClose={() => controllerRef.current?.stopVideo()}
                    onWheel={(evt) => controllerRef.current?.forwardWheel(evt)}
                    onFailed={() => onError("這部影片無法播放，可能是不支援的編碼。")}
                />
            )}
            {importing > 0 && <div className="import-status" role="status">正在匯入…</div>}
            {cardAnchor && !editing && (
                <div
                    className="card-chrome"
                    style={{
                        left: cardAnchor.left,
                        top: cardAnchor.top,
                        width: cardAnchor.width,
                        transform: `scale(${cardAnchor.scale})`,
                    }}
                >
                    <div className="card-chrome-group">
                        <button
                            aria-label={cardAnchor.placed.collapsed ? "展開" : "摺疊"}
                            title={cardAnchor.placed.collapsed ? "展開" : "摺疊"}
                            onClick={() => controllerRef.current?.toggleCollapsed(cardAnchor.placed)}
                        >
                            {cardAnchor.placed.collapsed ? "▸" : "▾"}
                        </button>
                        {controllerRef.current?.noteOf(cardAnchor.placed.noteID)?.type === "video"
                            && !cardAnchor.placed.collapsed && (
                            <button
                                aria-label="播放"
                                title="播放"
                                onClick={() => controllerRef.current?.playVideo(cardAnchor.placed.id)}
                            >
                                ▶
                            </button>
                        )}
                        <button
                            aria-label="全螢幕"
                            title="全螢幕"
                            onClick={() => onOpenFullscreen(cardAnchor.placed.noteID)}
                        >
                            ⛶
                        </button>
                    </div>
                    <button
                        aria-label="選單"
                        title="選單"
                        onClick={(evt) => {
                            const { bottom, left } = evt.currentTarget.getBoundingClientRect();
                            setMenu({ clientX: left, clientY: bottom + 4, x: 0, y: 0, placed: cardAnchor.placed });
                        }}
                    >
                        ⋯
                    </button>
                </div>
            )}
            {selectedCount >= 2 && (
                <ArrangeBar
                    count={selectedCount}
                    onArrange={(arrangement) => controllerRef.current?.arrangeSelection(arrangement)}
                />
            )}
            {mapEdit && (
                <MindmapEditor
                    key={mapEdit.noteID}
                    noteID={mapEdit.noteID}
                    inline={{
                        rootLeft: mapEdit.rootLeft,
                        rootTop: mapEdit.rootTop,
                        scale: mapEdit.scale,
                        startNode: mapEdit.startNode,
                        startTyping: mapEdit.startTyping,
                        onLayout: (size, save) => controllerRef.current?.fitMapCard(size, save),
                        onReveal: (left, top, right, bottom) => {
                            controllerRef.current?.revealOnCanvas(left, top, right, bottom);
                        },
                        onWheel: (evt) => controllerRef.current?.forwardWheel(evt),
                        onExit: () => controllerRef.current?.closeMapEditor(true),
                    }}
                    onChanged={() => {
                        controllerRef.current?.refresh();
                        onCardCreated();
                    }}
                    onError={onError}
                />
            )}
            {editing && (
                <WriterEditor
                    key={editing.noteID}
                    noteID={editing.noteID}
                    card
                    placement={editing}
                    padding={NOTE_PADDING}
                    onChanged={() => onCardChanged(editing.noteID)}
                    onOpenLink={onOpenLink}
                    onCardCreated={onCardCreated}
                    onClose={() => setEditing(null)}
                    onError={onError}
                />
            )}
        </>
    );
}

export default Canvas;
