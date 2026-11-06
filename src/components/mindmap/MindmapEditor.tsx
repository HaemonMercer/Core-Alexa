import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent,
    type PointerEvent,
} from "react";
import * as api from "../../api.ts";
import type { MindNode, MindSide } from "../../types.ts";
import { zoomAt, type View } from "../canvas/viewport.ts";
import ConfirmDialog from "../common/ConfirmDialog.tsx";
import ContextMenu, { type MenuItem } from "../common/ContextMenu.tsx";
import { FOLD_DISTANCE, measureText } from "./draw.ts";
import {
    descendantCount,
    dropZone,
    edgePath,
    edgePoint,
    fitView,
    isInside,
    layoutMindmap,
    neighbour,
    nodeLook,
    revealNode,
    type DropZone,
    type MapSize,
    type MindDirection,
    type PlacedMindNode,
} from "./layout.ts";

// 操作方式參考 Miro：Enter 同層、Tab 子節點、Shift + Enter 換行，打字時按 Enter 或 Tab 會接著新增下一個。
// 節點的增刪改都交給 Rust，回傳的清單直接取代畫面上的狀態。
// 拖曳用 pointer 事件，Tauri 在 Windows 上會攔截 HTML5 拖放。

const DRAG_SLOP = 4;
const ROOT_LABEL = "中心主題";
const PLUS_DISTANCE = 16;
const PLUS_DISTANCE_PAST_FOLD = 34;
const TOOLBAR_HALF_WIDTH = 120;
const TOOLBAR_ROOM = 48;
const TOOLBAR_GAP = 10;
const PAGE_ZOOM_STEP = 1.25;

const SHAPES = [
    { value: "none", label: "無外框" },
    { value: "pill", label: "膠囊" },
    { value: "rounded", label: "圓角" },
    { value: "rect", label: "方形" },
];
/** 和 Rust 的 `BRANCH_COLORS` 相同，顏色由 Rust 檢查格式，這裡只是可選的清單。 */
const COLORS = ["#7b3ff2", "#e0349a", "#16a6c9", "#2f9e5b", "#e8791a", "#3a6df0", "#c9a200", "#d6403a"];

/** 疊在白板的卡片上編輯：位置、縮放都跟著白板，自己不平移也不縮放。 */
export interface InlineMindmap {
    /** 根節點中心在畫布上的位置。 */
    rootLeft: number;
    rootTop: number;
    /** 量好心智圖的大小之前是 null。 */
    scale: number | null;
    /** 打開時選取的節點，null 是根節點。 */
    startNode: string | null;
    /** 打開時直接改這個節點的文字。 */
    startTyping: boolean;
    onLayout: (size: MapSize, save: boolean) => void;
    onReveal: (left: number, top: number, right: number, bottom: number) => void;
    onWheel: (evt: WheelEvent) => void;
    onExit: () => void;
}

interface MindmapEditorProps {
    noteID: string;
    inline?: InlineMindmap;
    /** 樹有變動時呼叫，白板與 Library 要重畫。 */
    onChanged: () => void;
    onError: (error: unknown) => void;
}

interface Editing {
    id: string;
    /** 剛新增的節點：取消或留空就不留下空節點。 */
    created: boolean;
}

interface Drag {
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
    /** 指標在視窗內的位置，拖曳中的節點跟著它。 */
    x: number;
    y: number;
    target: { id: string; zone: DropZone } | null;
}

interface Pan {
    pointerX: number;
    pointerY: number;
    viewX: number;
    viewY: number;
}

type Popover = "shape" | "color" | "layout";

/** 掛在節點邊緣外的小按鈕，位置相對於節點左上角。 */
function outside(node: PlacedMindNode, out: MindDirection, distance: number): CSSProperties {
    const point = edgePoint(node, out, distance);
    return { left: point.x - node.x, top: point.y - node.y };
}

function MindmapEditor({ noteID, inline, onChanged, onError }: MindmapEditorProps) {
    const [nodes, setNodes] = useState<MindNode[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [editing, setEditing] = useState<Editing | null>(null);
    /** 打字中的文字。節點跟著長大，所以要進版面計算。 */
    const [draft, setDraft] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
    const [popover, setPopover] = useState<Popover | null>(null);
    const [doomed, setDoomed] = useState<PlacedMindNode | null>(null);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [ownView, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
    const [size, setSize] = useState({ width: 0, height: 0 });
    const rootRef = useRef<HTMLDivElement>(null);
    const finishing = useRef(false);
    const fitted = useRef(false);
    const pan = useRef<Pan | null>(null);
    const copied = useRef<string | null>(null);
    const revealing = useRef(false);
    /** 按下時這個節點已經選取：沒有拖動就是再點一次，要改文字。 */
    const reclicked = useRef<string | null>(null);
    const inlineRef = useRef(inline);
    inlineRef.current = inline;

    useEffect(() => {
        finishing.current = false;
    }, [editing]);

    const layout = useMemo(() => {
        const shown = editing && draft !== null
            ? nodes.map((node) => (node.id === editing.id ? { ...node, text: draft } : node))
            : nodes;
        return layoutMindmap(shown, measureText);
    }, [nodes, editing, draft]);
    const selectedNode = layout.nodes.find((node) => node.id === selected) ?? null;
    const rootNode = layout.nodes.find((node) => node.parentId === null) ?? null;
    const view: View = inline
        ? { x: layout.rootX * (inline.scale ?? 1), y: layout.rootY * (inline.scale ?? 1), scale: inline.scale ?? 1 }
        : ownView;

    useEffect(() => {
        let cancelled = false;
        api.getMindmap(noteID)
            .then((next) => {
                if (cancelled) return;
                setNodes(next);
                const start = inlineRef.current?.startNode ?? next[0]?.id ?? null;
                setSelected(start);
                // 打開就能用鍵盤，不用先點一下。
                rootRef.current?.focus({ preventScroll: true });
                if (start && inlineRef.current?.startTyping) setEditing({ id: start, created: false });
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, onError]);

    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            setSize({ width: element.clientWidth, height: element.clientHeight });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 和白板相同：滾輪平移，Shift 左右，Ctrl 縮放。Ctrl + 滾輪要擋掉整頁縮放，所以不能是 passive。
    useEffect(() => {
        const element = rootRef.current;
        if (!element) return;
        const onWheel = (evt: WheelEvent) => {
            evt.preventDefault();
            if (inlineRef.current) {
                inlineRef.current.onWheel(evt);
                return;
            }
            const box = element.getBoundingClientRect();
            setView((current) => {
                if (evt.ctrlKey) return zoomAt(current, evt.clientX - box.left, evt.clientY - box.top, evt.deltaY < 0);
                if (evt.shiftKey) return { ...current, x: current.x - (evt.deltaX || evt.deltaY) };
                return { ...current, x: current.x - evt.deltaX, y: current.y - evt.deltaY };
            });
        };
        element.addEventListener("wheel", onWheel, { passive: false });
        return () => element.removeEventListener("wheel", onWheel);
    }, []);

    // 打字中只有畫面跟著變，文字存好才把卡片大小寫回去。
    const typing = editing !== null;
    useLayoutEffect(() => {
        if (layout.nodes.length > 0) inlineRef.current?.onLayout(layout, !typing);
    }, [layout, typing]);

    useLayoutEffect(() => {
        if (inline || fitted.current || layout.nodes.length === 0 || size.width === 0) return;
        fitted.current = true;
        setView(fitView(layout, size.width, size.height));
    }, [inline, layout, size]);

    // 用鍵盤一路新增時，新節點可能長到視窗外。只在換節點或版面改變時拉回來，手動平移時不動。
    useEffect(() => {
        if (!selectedNode || drag?.moved) return;
        const onCard = inlineRef.current;
        if (onCard) {
            // 打開時不動白板，也還不知道根節點的位置。
            if (!revealing.current) {
                revealing.current = true;
                return;
            }
            const scale = onCard.scale ?? 1;
            const left = onCard.rootLeft + (selectedNode.x - layout.rootX) * scale;
            const top = onCard.rootTop + (selectedNode.y - layout.rootY) * scale;
            onCard.onReveal(left, top, left + selectedNode.w * scale, top + selectedNode.h * scale);
        } else if (fitted.current) {
            setView((current) => revealNode(current, layout, selectedNode, size.width, size.height));
        }
    }, [selected, layout]);

    useEffect(() => setPopover(null), [selected]);

    const refocus = () => rootRef.current?.focus({ preventScroll: true });

    const apply = (change: Promise<MindNode[]>) => {
        change.then((next) => {
            setNodes(next);
            onChanged();
        }).catch(onError);
    };

    const applyCreated = (change: Promise<{ id: string; nodes: MindNode[] }>, startEditing: boolean) => {
        change.then(({ id, nodes: next }) => {
            setNodes(next);
            setSelected(id);
            if (startEditing) setEditing({ id, created: true });
            onChanged();
        }).catch(onError);
    };

    const addNode = (parentID: string, after: string | null, side: MindSide | null = null) => {
        applyCreated(api.addMindNode(noteID, parentID, after, side), true);
    };

    const addChild = (id: string) => addNode(id, null);
    const addSibling = (node: PlacedMindNode) => {
        if (node.parentId === null) addChild(node.id);
        else addNode(node.parentId, node.id);
    };

    const duplicate = (node: PlacedMindNode) => {
        if (node.parentId === null) return;
        applyCreated(api.duplicateMindNode(noteID, node.id, node.parentId, node.id), false);
    };

    /** 貼到選取的節點底下；還選著複製的那個節點時，貼在它旁邊。 */
    const paste = (target: PlacedMindNode) => {
        const source = nodes.find((node) => node.id === copied.current);
        if (!source) return;
        if (source.id === target.id) duplicate(target);
        else applyCreated(api.duplicateMindNode(noteID, source.id, target.id, null), false);
    };

    const removeNode = (id: string, parentID: string | null) => {
        setSelected(parentID);
        apply(api.deleteMindNode(noteID, id));
    };

    /** 有子節點時內容比較多，刪除無法復原，要先確認。 */
    const askRemove = (node: PlacedMindNode) => {
        if (node.parentId === null) return;
        if (descendantCount(nodes, node.id) > 0) setDoomed(node);
        else removeNode(node.id, node.parentId);
    };

    const toggle = (node: PlacedMindNode) => {
        if (node.childCount > 0 && node.parentId !== null) {
            apply(api.setMindCollapsed(noteID, node.id, !node.collapsed));
        }
    };

    const setStyle = (id: string, key: string, value: string) => {
        setPopover(null);
        apply(api.setMindStyle(noteID, id, key, value));
    };

    const startEditing = (id: string) => setEditing({ id, created: false });

    /** `then` 在文字存好後接著做，打字時按 Enter、Tab 就是下一個節點。 */
    const finishEditing = (text: string, then?: (node: PlacedMindNode) => void) => {
        // 輸入框移除時也會觸發 blur，同一次編輯只能結束一次。
        if (!editing || finishing.current) return;
        finishing.current = true;
        const { id, created } = editing;
        const placed = layout.nodes.find((node) => node.id === id);
        const original = nodes.find((node) => node.id === id);
        setEditing(null);
        setDraft(null);
        refocus();
        if (created && !text.trim()) {
            removeNode(id, original?.parentId ?? null);
            return;
        }
        if (text !== original?.text) {
            // 先換掉畫面上的文字，等 Rust 回來之前版面才不會跳回舊字。
            setNodes((current) => current.map((node) => (node.id === id ? { ...node, text } : node)));
            apply(api.renameMindNode(noteID, id, text));
        }
        if (placed) then?.(placed);
    };

    const onKeyDown = (evt: KeyboardEvent) => {
        if (editing || !selectedNode || evt.nativeEvent.isComposing) return;
        const command = evt.ctrlKey || evt.metaKey;
        const handled = (() => {
            if (evt.key === "Escape" && inline) {
                inline.onExit();
                return true;
            }
            if (command) {
                switch (evt.key.toLowerCase()) {
                    case "c":
                        copied.current = selectedNode.parentId === null ? null : selectedNode.id;
                        return true;
                    case "v":
                        paste(selectedNode);
                        return true;
                    case "d":
                        duplicate(selectedNode);
                        return true;
                    default:
                        return false;
                }
            }
            switch (evt.key) {
                case "Tab":
                    addChild(selectedNode.id);
                    return true;
                case "Enter":
                    addSibling(selectedNode);
                    return true;
                case "F2":
                    startEditing(selectedNode.id);
                    return true;
                case " ":
                    toggle(selectedNode);
                    return true;
                case "Delete":
                case "Backspace":
                    askRemove(selectedNode);
                    return true;
                default: {
                    const next = neighbour(layout, selectedNode.id, evt.key);
                    if (next) setSelected(next);
                    return evt.key.startsWith("Arrow");
                }
            }
        })();
        if (handled) evt.preventDefault();
    };

    const onEditorKeyDown = (evt: KeyboardEvent<HTMLTextAreaElement>) => {
        evt.stopPropagation();
        if (evt.nativeEvent.isComposing) return;
        const text = evt.currentTarget.value;
        if (evt.key === "Enter" && !evt.shiftKey) {
            evt.preventDefault();
            finishEditing(text, addSibling);
        } else if (evt.key === "Tab") {
            evt.preventDefault();
            finishEditing(text, (node) => addChild(node.id));
        } else if (evt.key === "Escape") {
            evt.preventDefault();
            finishEditing(text);
        }
    };

    const targetAt = (clientX: number, clientY: number, dragged: string): Drag["target"] => {
        const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>(".mindmap-node");
        const id = element?.dataset.id;
        if (!element || !id || isInside(nodes, dragged, id)) return null;
        const box = element.getBoundingClientRect();
        const isRoot = nodes.find((node) => node.id === id)?.parentId === null;
        const zone = layout.orientation === "horizontal"
            ? dropZone(isRoot, clientY - box.top, box.height)
            : dropZone(isRoot, clientX - box.left, box.width);
        return { id, zone };
    };

    /** 指標在根節點的哪一側。 */
    const sideOf = (clientX: number, clientY: number): MindSide => {
        const box = rootRef.current?.getBoundingClientRect();
        if (!box) return "right";
        const before = layout.orientation === "horizontal"
            ? clientX - box.left < view.x
            : clientY - box.top < view.y;
        return before ? "left" : "right";
    };

    const onNodePointerDown = (evt: PointerEvent, node: PlacedMindNode) => {
        reclicked.current = evt.button === 0 && !editing && node.id === selected ? node.id : null;
        refocus();
        setSelected(node.id);
        if (evt.button !== 0 || editing || node.parentId === null) return;
        evt.currentTarget.setPointerCapture(evt.pointerId);
        setDrag({
            id: node.id,
            startX: evt.clientX,
            startY: evt.clientY,
            moved: false,
            x: 0,
            y: 0,
            target: null,
        });
    };

    const onNodePointerMove = (evt: PointerEvent) => {
        if (!drag) return;
        const moved = drag.moved || Math.hypot(evt.clientX - drag.startX, evt.clientY - drag.startY) >= DRAG_SLOP;
        const box = rootRef.current?.getBoundingClientRect();
        setDrag({
            ...drag,
            moved,
            x: evt.clientX - (box?.left ?? 0),
            y: evt.clientY - (box?.top ?? 0),
            target: moved ? targetAt(evt.clientX, evt.clientY, drag.id) : null,
        });
    };

    const onNodePointerEnd = (evt: PointerEvent, clicked: PlacedMindNode) => {
        const finished = drag;
        const clickedAgain = reclicked.current === clicked.id;
        reclicked.current = null;
        setDrag(null);
        if (!finished?.moved) {
            if (clickedAgain) startEditing(clicked.id);
            return;
        }
        const dragged = layout.nodes.find((node) => node.id === finished.id);
        const target = finished.target;

        if (!target) {
            // 第一層分支拖到根節點的另一側。
            const side = sideOf(evt.clientX, evt.clientY);
            const empty = !document.elementFromPoint(evt.clientX, evt.clientY)?.closest(".mindmap-node");
            if (dragged?.parentId === rootNode?.id && dragged?.side !== side && empty) {
                apply(api.moveMindNode(noteID, finished.id, dragged?.parentId ?? "", null, side));
            }
            return;
        }

        const over = nodes.find((node) => node.id === target.id);
        if (!over) return;
        if (target.zone === "child") {
            const side = over.parentId === null ? sideOf(evt.clientX, evt.clientY) : null;
            apply(api.moveMindNode(noteID, finished.id, over.id, null, side));
            return;
        }
        if (over.parentId === null) return;
        const siblings = nodes.filter((node) => node.parentId === over.parentId && node.id !== finished.id);
        const index = siblings.findIndex((node) => node.id === over.id);
        const before = target.zone === "before" ? over.id : siblings[index + 1]?.id ?? null;
        apply(api.moveMindNode(noteID, finished.id, over.parentId, before, over.side));
    };

    const onBackgroundPointerDown = (evt: PointerEvent<HTMLDivElement>) => {
        if (evt.button !== 0) return;
        const target = evt.target as HTMLElement;
        if (target.closest(".mindmap-node, .mindmap-toolbar, .mindmap-zoom")) return;
        setSelected(null);
        setPopover(null);
        if (inline) return;
        pan.current = { pointerX: evt.clientX, pointerY: evt.clientY, viewX: view.x, viewY: view.y };
        evt.currentTarget.setPointerCapture(evt.pointerId);
    };

    const onBackgroundPointerMove = (evt: PointerEvent) => {
        const from = pan.current;
        if (!from) return;
        setView((current) => ({
            ...current,
            x: from.viewX + evt.clientX - from.pointerX,
            y: from.viewY + evt.clientY - from.pointerY,
        }));
    };

    const zoomBy = (zoomIn: boolean) => {
        setView((current) => {
            const factor = zoomIn ? PAGE_ZOOM_STEP : 1 / PAGE_ZOOM_STEP;
            const scale = Math.min(4, Math.max(0.1, current.scale * factor));
            const ratio = scale / current.scale;
            const middleX = size.width / 2;
            const middleY = size.height / 2;
            return { x: middleX - (middleX - current.x) * ratio, y: middleY - (middleY - current.y) * ratio, scale };
        });
    };

    const menuItems = (id: string): MenuItem[] => {
        const node = layout.nodes.find((item) => item.id === id);
        if (!node) return [];
        const isRoot = node.parentId === null;
        return [
            { label: "新增子節點", onSelect: () => addChild(id) },
            { label: "新增同層節點", disabledReason: isRoot ? "根節點沒有同層" : undefined, onSelect: () => addSibling(node) },
            { label: "編輯文字", onSelect: () => startEditing(id) },
            { label: "建立副本", disabledReason: isRoot ? "根節點不能複製" : undefined, onSelect: () => duplicate(node) },
            ...(node.childCount > 0 && !isRoot
                ? [{ label: node.collapsed ? "展開" : "摺疊", onSelect: () => toggle(node) }]
                : []),
            { label: "刪除節點", disabledReason: isRoot ? "根節點不能刪除" : undefined, onSelect: () => askRemove(node) },
        ];
    };

    const worldX = (x: number) => (x - layout.rootX) * view.scale + view.x;
    const worldY = (y: number) => (y - layout.rootY) * view.scale + view.y;
    const draggedNode = drag?.moved ? layout.nodes.find((node) => node.id === drag.id) : undefined;
    const showToolbar = selectedNode && !editing && !draggedNode;
    const toolbarScreenTop = selectedNode === null
        ? 0
        : worldY(selectedNode.y) + (inline ? inline.rootTop - view.y : 0);
    const toolbarAbove = toolbarScreenTop > TOOLBAR_ROOM;
    const toolbarLeft = selectedNode === null ? 0 : worldX(selectedNode.x + selectedNode.w / 2);

    return (
        <div className="mindmap-editor" data-inline={inline !== undefined}>
            <div
                className="mindmap-viewport"
                ref={rootRef}
                style={inline && {
                    left: inline.rootLeft - view.x,
                    top: inline.rootTop - view.y,
                    width: layout.width * view.scale,
                    height: layout.height * view.scale,
                    opacity: inline.scale === null ? 0 : 1,
                }}
                tabIndex={0}
                role="tree"
                aria-label="心智圖"
                onKeyDown={onKeyDown}
                onPointerDown={onBackgroundPointerDown}
                onPointerMove={onBackgroundPointerMove}
                onPointerUp={() => { pan.current = null; }}
                onPointerCancel={() => { pan.current = null; }}
            >
                <div
                    className="mindmap-stage"
                    style={{
                        width: layout.width,
                        height: layout.height,
                        transform: `translate(${worldX(0)}px, ${worldY(0)}px) scale(${view.scale})`,
                    }}
                >
                    <svg width={layout.width} height={layout.height} aria-hidden="true">
                        {layout.edges.map((edge) => (
                            <path key={edge.to.id} d={edgePath(edge, layout.lineStyle)} stroke={edge.to.branchColor} />
                        ))}
                    </svg>
                    {layout.nodes.map((node) => {
                        const look = nodeLook(node);
                        const isRoot = node.parentId === null;
                        const canFold = node.childCount > 0 && !isRoot;
                        const plusSides: { out: MindDirection; side: MindSide | null }[] = node.out
                            ? [{ out: node.out, side: null }]
                            : layout.orientation === "horizontal"
                                ? [{ out: "left", side: "left" }, { out: "right", side: "right" }]
                                : [{ out: "top", side: "left" }, { out: "bottom", side: "right" }];
                        return (
                            <div
                                key={node.id}
                                className="mindmap-node"
                                role="treeitem"
                                aria-selected={node.id === selected}
                                data-id={node.id}
                                data-root={isRoot}
                                data-dragging={drag?.moved && drag.id === node.id}
                                data-drop={drag?.target?.id === node.id ? drag.target.zone : undefined}
                                data-axis={layout.orientation}
                                style={{
                                    left: node.x,
                                    top: node.y,
                                    width: node.w,
                                    height: node.h,
                                    padding: `${node.paddingY}px ${node.paddingX}px`,
                                    font: node.font,
                                    lineHeight: `${node.lineHeight}px`,
                                    background: look.fill,
                                    borderColor: look.border,
                                    borderRadius: look.radius,
                                }}
                                onPointerDown={(evt) => onNodePointerDown(evt, node)}
                                onPointerMove={onNodePointerMove}
                                onPointerUp={(evt) => onNodePointerEnd(evt, node)}
                                onPointerCancel={() => setDrag(null)}
                                onDoubleClick={() => startEditing(node.id)}
                                onContextMenu={(evt) => {
                                    evt.preventDefault();
                                    setMenu({ x: evt.clientX, y: evt.clientY, id: node.id });
                                }}
                            >
                                {editing?.id === node.id ? (
                                    <textarea
                                        autoFocus
                                        aria-label="節點文字"
                                        defaultValue={node.text}
                                        placeholder={isRoot ? ROOT_LABEL : "新節點"}
                                        spellCheck={false}
                                        style={{ padding: `${node.paddingY}px ${node.paddingX}px` }}
                                        onFocus={(evt) => evt.currentTarget.select()}
                                        onInput={(evt) => setDraft(evt.currentTarget.value)}
                                        onBlur={(evt) => finishEditing(evt.currentTarget.value)}
                                        onPointerDown={(evt) => evt.stopPropagation()}
                                        onDoubleClick={(evt) => evt.stopPropagation()}
                                        onKeyDown={onEditorKeyDown}
                                    />
                                ) : node.lines.map((line, index) => <span key={index}>{line || "​"}</span>)}
                                {!editing && canFold && node.out && (
                                    <button
                                        type="button"
                                        className="mindmap-fold"
                                        data-collapsed={node.collapsed}
                                        aria-label={node.collapsed ? "展開" : "摺疊"}
                                        title={node.collapsed ? `展開 ${node.hiddenCount} 個節點` : "摺疊"}
                                        style={{
                                            ...outside(node, node.out, FOLD_DISTANCE),
                                            background: node.collapsed ? node.branchColor : "#fff",
                                            borderColor: node.branchColor,
                                            color: node.collapsed ? "#fff" : node.branchColor,
                                        }}
                                        onPointerDown={(evt) => evt.stopPropagation()}
                                        onDoubleClick={(evt) => evt.stopPropagation()}
                                        onClick={() => toggle(node)}
                                    >
                                        {node.collapsed ? node.hiddenCount : "−"}
                                    </button>
                                )}
                                {!editing && plusSides.map(({ out, side }) => (
                                    <button
                                        key={out}
                                        type="button"
                                        className="mindmap-plus"
                                        aria-label="新增子節點"
                                        title="新增子節點"
                                        style={outside(node, out, canFold ? PLUS_DISTANCE_PAST_FOLD : PLUS_DISTANCE)}
                                        onPointerDown={(evt) => evt.stopPropagation()}
                                        onDoubleClick={(evt) => evt.stopPropagation()}
                                        onClick={() => addNode(node.id, null, side)}
                                    >
                                        +
                                    </button>
                                ))}
                            </div>
                        );
                    })}
                </div>

                {draggedNode && drag && (
                    <div className="mindmap-ghost" style={{ left: drag.x, top: drag.y, borderColor: draggedNode.branchColor }}>
                        {draggedNode.lines[0] || "新節點"}
                    </div>
                )}

                {showToolbar && (
                    <div
                        className="mindmap-toolbar"
                        data-above={toolbarAbove}
                        style={{
                            left: inline
                                ? toolbarLeft
                                : Math.max(TOOLBAR_HALF_WIDTH, Math.min(size.width - TOOLBAR_HALF_WIDTH, toolbarLeft)),
                            top: toolbarAbove
                                ? worldY(selectedNode.y) - TOOLBAR_GAP
                                : worldY(selectedNode.y + selectedNode.h) + TOOLBAR_GAP,
                        }}
                        onMouseDown={(evt) => evt.preventDefault()}
                    >
                        <button
                            type="button"
                            aria-expanded={popover === "shape"}
                            onClick={() => setPopover(popover === "shape" ? null : "shape")}
                        >
                            形狀
                        </button>
                        <button
                            type="button"
                            aria-label="顏色"
                            title="顏色"
                            aria-expanded={popover === "color"}
                            onClick={() => setPopover(popover === "color" ? null : "color")}
                        >
                            <i className="mindmap-swatch" style={{ background: selectedNode.branchColor }} />
                        </button>
                        {selectedNode.parentId === null && (
                            <button
                                type="button"
                                aria-expanded={popover === "layout"}
                                onClick={() => setPopover(popover === "layout" ? null : "layout")}
                            >
                                版面
                            </button>
                        )}
                        <button
                            type="button"
                            aria-label="更多"
                            title="更多"
                            onClick={(evt) => {
                                const box = evt.currentTarget.getBoundingClientRect();
                                setMenu({ x: box.left, y: box.bottom + 4, id: selectedNode.id });
                            }}
                        >
                            ⋯
                        </button>

                        {popover === "shape" && (
                            <div className="mindmap-popover">
                                {SHAPES.map(({ value, label }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        aria-pressed={selectedNode.shapeKind === value}
                                        onClick={() => setStyle(selectedNode.id, "shape", value)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {popover === "color" && (
                            <div className="mindmap-popover" data-grid="true">
                                {COLORS.map((color) => (
                                    <button
                                        key={color}
                                        type="button"
                                        aria-label={color}
                                        aria-pressed={selectedNode.branchColor === color}
                                        onClick={() => setStyle(selectedNode.id, "color", color)}
                                    >
                                        <i className="mindmap-swatch" style={{ background: color }} />
                                    </button>
                                ))}
                            </div>
                        )}
                        {popover === "layout" && (
                            <div className="mindmap-popover">
                                <button
                                    type="button"
                                    aria-pressed={layout.orientation === "horizontal"}
                                    onClick={() => setStyle(selectedNode.id, "orientation", "horizontal")}
                                >
                                    水平
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={layout.orientation === "vertical"}
                                    onClick={() => setStyle(selectedNode.id, "orientation", "vertical")}
                                >
                                    垂直
                                </button>
                                <hr />
                                <button
                                    type="button"
                                    aria-pressed={layout.lineStyle === "curved"}
                                    onClick={() => setStyle(selectedNode.id, "lineStyle", "curved")}
                                >
                                    曲線
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={layout.lineStyle === "elbow"}
                                    onClick={() => setStyle(selectedNode.id, "lineStyle", "elbow")}
                                >
                                    折線
                                </button>
                                <hr />
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPopover(null);
                                        apply(api.randomizeMindColors(noteID));
                                    }}
                                >
                                    隨機配色
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {!inline && (
                    <div className="mindmap-zoom" onMouseDown={(evt) => evt.preventDefault()}>
                        <button type="button" aria-label="縮小" onClick={() => zoomBy(false)}>−</button>
                        <span>{Math.round(view.scale * 100)}%</span>
                        <button type="button" aria-label="放大" onClick={() => zoomBy(true)}>+</button>
                        <button
                            type="button"
                            aria-label="符合畫面"
                            title="符合畫面"
                            onClick={() => setView(fitView(layout, size.width, size.height))}
                        >
                            ⤢
                        </button>
                    </div>
                )}
            </div>
            {!inline && (
                <p className="mindmap-hint">
                    Tab 子節點 · Enter 同層 · Shift+Enter 換行 · 再點一次改字 · 空白鍵 摺疊 · Ctrl+C/V 複製 · Ctrl+滾輪 縮放 · 拖曳空白處 平移
                </p>
            )}
            {menu && (
                <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />
            )}
            {doomed && (
                <ConfirmDialog
                    title={`刪除「${doomed.text || "新節點"}」？`}
                    detail={`底下的 ${descendantCount(nodes, doomed.id)} 個節點也會一起刪除。這個動作無法復原。`}
                    onConfirm={() => {
                        const { id, parentId } = doomed;
                        setDoomed(null);
                        removeNode(id, parentId);
                        refocus();
                    }}
                    onCancel={() => {
                        setDoomed(null);
                        refocus();
                    }}
                />
            )}
        </div>
    );
}

export default MindmapEditor;
