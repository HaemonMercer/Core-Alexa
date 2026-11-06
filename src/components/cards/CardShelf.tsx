import { useCallback, useRef, useState, type PointerEvent } from "react";
import type { Note, SheetContents, SheetTableInfo } from "../../types.ts";
import { CLICK_SLOP } from "../canvas/controller.ts";
import ContextMenu from "../common/ContextMenu.tsx";
import { useNoteDeletion } from "../common/useDeletion.tsx";
import { ChartLabel, SheetToggle, TableLabel } from "../office/SheetItems.tsx";
import { deleteLabel } from "../../noteTypes.ts";
import FullscreenButton from "./FullscreenButton.tsx";
import NoteSummary from "./NoteSummary.tsx";
import { useTypeFilter } from "./useTypeFilter.tsx";
import { NoteTags } from "../tags/TagChip.tsx";
import { useTagFilter } from "../tags/useTagFilter.tsx";

// 白板右側的清單：拖到白板上放置，雙擊開啟內容。
// 這裡不做多選：Delete、Ctrl+A 在白板頁屬於畫布。
// 拖曳用 pointer 事件，Tauri 在 Windows 上會攔截 HTML5 拖放。

interface CardShelfProps {
    notes: Note[] | null;
    /** Excels 收納的表格與圖表，按卡片上的按鈕展開。 */
    sheets?: Record<string, SheetContents>;
    /** 清單是空的時候的說明。 */
    empty: string;
    /** Root 只放白板，卡片不能拖出去。 */
    canPlace: boolean;
    /** 已經在這個白板上的筆記，不能再放一次。Excels 除外，不同表格可以各放一張。 */
    placedNoteIDs: ReadonlySet<string>;
    /** 這裡放得下的類型。沒有提供時全部都可以。 */
    accepts?: (note: Note) => boolean;
    /** 卡片放到哪裡，顯示在提示文字。 */
    surfaceName?: string;
    /** 拖曳中的位置，文件用來顯示會放在哪裡。 */
    onHover?: (point: { x: number; y: number } | null) => void;
    /** 放開滑鼠的位置（螢幕座標）。拖的是 Excels 裡的表格時有 `tableID`。 */
    onDrop: (id: string, clientX: number, clientY: number, tableID?: string) => void;
    onPlaceAtCenter: (id: string, tableID?: string) => void;
    onOpen: (id: string) => void;
    onOpenFullscreen: (id: string) => void;
    onOpenInTab: (id: string) => void;
    onDeleted: (ids: string[]) => void;
    onError: (error: unknown) => void;
}

function CardShelf({
    notes, sheets = {}, empty, canPlace, placedNoteIDs, accepts, surfaceName = "白板", onHover, onDrop, onPlaceAtCenter, onOpen, onOpenFullscreen, onOpenInTab, onDeleted, onError,
}: CardShelfProps) {
    const { visible: typed, bar: typeFilter } = useTypeFilter(notes);
    const { visible: cards, bar: tagFilter } = useTagFilter(typed);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<{ x: number; y: number; card: Note; table?: SheetTableInfo } | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);
    const deletion = useNoteDeletion(onDeleted, onError);

    const pressedAt = useRef<{ x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState<{ card: Note; table?: SheetTableInfo; x: number; y: number } | null>(null);

    const placeable = (card: Note) => canPlace && (accepts?.(card) ?? true) && (card.type === "sheet" || !placedNoteIDs.has(card.id));

    const onPointerDown = (evt: PointerEvent, card: Note) => {
        if (evt.button !== 0 || !placeable(card)) return;
        evt.currentTarget.setPointerCapture(evt.pointerId);
        pressedAt.current = { x: evt.clientX, y: evt.clientY };
    };

    const onPointerMove = (evt: PointerEvent, card: Note, table?: SheetTableInfo) => {
        const start = pressedAt.current;
        if (!start) return;
        if (dragging || Math.hypot(evt.clientX - start.x, evt.clientY - start.y) >= CLICK_SLOP) {
            setDragging({ card, table, x: evt.clientX, y: evt.clientY });
            onHover?.({ x: evt.clientX, y: evt.clientY });
        }
    };

    const onPointerEnd = (evt: PointerEvent) => {
        pressedAt.current = null;
        if (!dragging) return;
        setDragging(null);
        onHover?.(null);
        if (evt.type === "pointerup") onDrop(dragging.card.id, evt.clientX, evt.clientY, dragging.table?.id);
    };

    const toggle = (id: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    };

    const tile = (card: Note, inner = false) => (
        <li
            key={card.id}
            className={inner ? "sheet-item" : undefined}
            role="button"
            tabIndex={0}
            data-dragging={dragging?.card.id === card.id}
            data-placeable={placeable(card)}
            title={canPlace && !placeable(card) && (accepts?.(card) ?? true) ? `已在這個${surfaceName}上` : undefined}
            onPointerDown={(evt) => onPointerDown(evt, card)}
            onPointerMove={(evt) => onPointerMove(evt, card)}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            // 預覽裡的連結不能把整個 App 帶離開。
            onClick={(evt) => evt.preventDefault()}
            onDragStart={(evt) => evt.preventDefault()}
            onDoubleClick={() => onOpen(card.id)}
            onContextMenu={(evt) => {
                evt.preventDefault();
                setMenu({ x: evt.clientX, y: evt.clientY, card });
            }}
            onKeyDown={(evt) => {
                if (evt.key === "Enter") onOpen(card.id);
            }}
        >
            {inner ? <ChartLabel note={card} /> : <NoteSummary note={card} />}
            {!inner && <NoteTags note={card} />}
            {!inner && <FullscreenButton onOpen={() => onOpenFullscreen(card.id)} />}
            {!inner && sheets[card.id] && (
                <SheetToggle contents={sheets[card.id]} open={expanded.has(card.id)} onToggle={() => toggle(card.id)} />
            )}
        </li>
    );

    /** 表格直接拖到白板，不必再選一次。 */
    const tableTile = (sheet: Note, table: SheetTableInfo) => (
        <li
            key={table.id}
            className="sheet-item"
            role="button"
            tabIndex={0}
            data-dragging={dragging?.table?.id === table.id}
            data-placeable={canPlace}
            onPointerDown={(evt) => onPointerDown(evt, sheet)}
            onPointerMove={(evt) => onPointerMove(evt, sheet, table)}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onDragStart={(evt) => evt.preventDefault()}
            onDoubleClick={() => onOpenFullscreen(sheet.id)}
            onContextMenu={(evt) => {
                evt.preventDefault();
                setMenu({ x: evt.clientX, y: evt.clientY, card: sheet, table });
            }}
        >
            <TableLabel table={table} />
        </li>
    );

    const hasContent = (notes?.length ?? 0) > 0;

    return (
        <>
            {typeFilter}
            {tagFilter}
            {notes && !hasContent && <p className="library-empty right-panel-hint">{empty}</p>}
            {hasContent && (
                <p className="library-empty right-panel-hint">
                    {canPlace ? `把卡片拖到${surfaceName}上，雙擊可以編輯內容。` : "開啟白板後才能放卡片，雙擊可以編輯內容。"}
                </p>
            )}
            <ul className="card-shelf">
                {cards?.flatMap((card) => {
                    const contents = sheets[card.id];
                    const row = tile(card);
                    if (!contents || !expanded.has(card.id)) return [row];
                    return [row, (
                        <li key={`${card.id}:items`} className="shelf-items">
                            <ul>
                                {contents.tables.map((table) => tableTile(card, table))}
                                {contents.charts.map((chart) => tile(chart, true))}
                            </ul>
                        </li>
                    )];
                })}
            </ul>
            {dragging && (
                <div className="card-drag-ghost" style={{ left: dragging.x, top: dragging.y }}>
                    {dragging.table ? <TableLabel table={dragging.table} /> : <NoteSummary note={dragging.card} />}
                </div>
            )}
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menu.table ? [
                        { label: "開啟 Excels", onSelect: () => onOpenFullscreen(menu.card.id) },
                        {
                            label: `放到${surfaceName}`,
                            disabledReason: canPlace ? undefined : "Root 只能放白板",
                            onSelect: () => onPlaceAtCenter(menu.card.id, menu.table?.id),
                        },
                    ] : [
                        { label: "開啟", onSelect: () => onOpen(menu.card.id) },
                        { label: "在新分頁開啟", onSelect: () => onOpenInTab(menu.card.id) },
                        {
                            label: `放到${surfaceName}`,
                            disabledReason: !canPlace
                                ? "Root 只能放白板"
                                : placeable(menu.card) ? undefined : `已在這個${surfaceName}上`,
                            onSelect: () => onPlaceAtCenter(menu.card.id),
                        },
                        { label: deleteLabel([menu.card]), onSelect: () => deletion.ask([menu.card]) },
                    ]}
                    onClose={closeMenu}
                />
            )}
            {deletion.dialog}
        </>
    );
}

export default CardShelf;
