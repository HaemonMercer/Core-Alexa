import { useCallback, useState, type ReactNode } from "react";
import type { Whiteboard, WorkspaceState } from "../../types.ts";
import ContextMenu from "../common/ContextMenu.tsx";
import EditableName from "./EditableName.tsx";
import { useWhiteboardDeletion } from "../common/useDeletion.tsx";
import { useListSelection } from "../common/useListSelection.ts";

/** 每一層往內縮的距離。 */
const INDENT = 24;

interface WhiteboardLibraryProps {
    whiteboards: Whiteboard[];
    rootID: string;
    onOpen: (id: string) => void;
    onRename: (id: string, name: string) => void;
    onDeleted: (workspace: WorkspaceState) => void;
    onError: (error: unknown) => void;
}

function WhiteboardLibrary({
    whiteboards, rootID, onOpen, onRename, onDeleted, onError,
}: WhiteboardLibraryProps) {
    const [foldedIDs, setFoldedIDs] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);

    const deletion = useWhiteboardDeletion((workspace) => {
        selection.selectOnly(null);
        onDeleted(workspace);
    }, onError);

    const askDelete = (ids: string[]) => {
        deletion.ask(whiteboards.filter((board) => ids.includes(board.id)));
    };

    const childrenOf = new Map<string, Whiteboard[]>();
    for (const board of whiteboards) {
        if (board.id === rootID) continue;
        const parentID = board.parentId ?? rootID;
        childrenOf.set(parentID, [...(childrenOf.get(parentID) ?? []), board]);
    }

    // 畫面上由上到下的順序，收合的子白板不算，Shift 選範圍和全選才符合看到的清單。
    const visibleIDs = (parentID: string): string[] =>
        (childrenOf.get(parentID) ?? []).flatMap((board) => [
            board.id,
            ...(foldedIDs.has(board.id) ? [] : visibleIDs(board.id)),
        ]);
    const selection = useListSelection(visibleIDs(rootID), null, askDelete);

    const toggleFold = (id: string) => {
        const next = new Set(foldedIDs);
        if (!next.delete(id)) next.add(id);
        setFoldedIDs(next);
    };

    // Root 不顯示，它的子白板就是最上層。
    const renderBranch = (parentID: string, depth: number): ReactNode =>
        childrenOf.get(parentID)?.map((board) => {
            const hasChildren = childrenOf.has(board.id);
            const folded = foldedIDs.has(board.id);
            return [
                <li
                    key={board.id}
                    data-selected={selection.selected.has(board.id)}
                    // 名稱和按鈕一般點選有自己的功能；按住 Ctrl 或 Shift 時一律是選取。
                    onClickCapture={(evt) => {
                        if (!evt.ctrlKey && !evt.metaKey && !evt.shiftKey) return;
                        evt.stopPropagation();
                        evt.preventDefault();
                        selection.click(board.id, evt);
                    }}
                    onClick={(evt) => {
                        if (!(evt.target as Element).closest("button, input")) selection.click(board.id, evt);
                    }}
                    onContextMenu={(evt) => {
                        evt.preventDefault();
                        setMenu({ x: evt.clientX, y: evt.clientY, ids: selection.forContextMenu(board.id) });
                    }}
                >
                    <div className="whiteboard-tree-name" style={{ paddingLeft: depth * INDENT }}>
                        {hasChildren ? (
                            <button
                                className="tree-toggle"
                                aria-expanded={!folded}
                                aria-label={`${folded ? "展開" : "收合"} ${board.name}`}
                                onClick={() => toggleFold(board.id)}
                            >
                                {folded ? "▸" : "▾"}
                            </button>
                        ) : (
                            <span className="tree-toggle" />
                        )}
                        <EditableName name={board.name} onRename={(name) => onRename(board.id, name)} />
                    </div>
                    <button className="open-button" onClick={() => onOpen(board.id)}>開啟</button>
                </li>,
                !folded && renderBranch(board.id, depth + 1),
            ];
        });

    return (
        <section
            className="library"
            onClick={(evt) => {
                if (evt.target === evt.currentTarget) selection.selectOnly(null);
            }}
        >
            <h1>
                Whiteboard Library
                {selection.count > 1 && <span className="library-count">已選取 {selection.count} 個</span>}
            </h1>
            {childrenOf.size === 0 ? (
                <p className="library-empty">還沒有白板。在 Root 上雙擊空白處就能建立。</p>
            ) : (
                <ul className="whiteboard-list">{renderBranch(rootID, 0)}</ul>
            )}
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={menu.ids.length > 1
                        ? [{ label: `刪除 ${menu.ids.length} 個白板`, onSelect: () => askDelete(menu.ids) }]
                        : [
                            { label: "開啟白板", onSelect: () => onOpen(menu.ids[0]) },
                            { label: "刪除白板", onSelect: () => askDelete(menu.ids) },
                        ]}
                    onClose={closeMenu}
                />
            )}
            {deletion.dialog}
        </section>
    );
}

export default WhiteboardLibrary;
