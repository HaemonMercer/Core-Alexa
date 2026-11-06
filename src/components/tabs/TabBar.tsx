import { useCallback, useRef, useState } from "react";
import ContextMenu from "../common/ContextMenu.tsx";
import type { Tab, TabState } from "./tabs.ts";

interface TabBarProps {
    state: TabState;
    titleOf: (tab: Tab) => string;
    onActivate: (id: string) => void;
    onAdd: () => void;
    onClose: (id: string) => void;
    onCloseOthers: (id: string) => void;
    /** `index` 是拿掉這個分頁之後的位置。 */
    onMove: (id: string, index: number) => void;
}

/** 操作區上方的分頁列。拖曳用 pointer 事件，Tauri 在 Windows 上會攔截 HTML5 拖放。 */
function TabBar({ state, titleOf, onActivate, onAdd, onClose, onCloseOthers, onMove }: TabBarProps) {
    const list = useRef<HTMLDivElement>(null);
    const latest = useRef({ state, onMove });
    latest.current = { state, onMove };
    const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);
    const closable = state.tabs.length > 1;

    /** 滑鼠越過另一個分頁的中線就交換，分頁寬度不同時才不會來回跳動。 */
    const dragAt = (clientX: number, id: string) => {
        if (!list.current) return;
        const others = [...list.current.querySelectorAll<HTMLElement>("[role=tab]")]
            .filter((element) => element.dataset.tabId !== id);
        const index = others.filter((element) => {
            const box = element.getBoundingClientRect();
            return box.left + box.width / 2 < clientX;
        }).length;
        const { state: current, onMove: move } = latest.current;
        if (current.tabs.findIndex((tab) => tab.id === id) !== index) move(id, index);
    };

    /** 聽在 window：重新排序會搬動 DOM 節點，pointer capture 會跟著消失。 */
    const startDrag = (id: string) => {
        const onMovePointer = (evt: PointerEvent) => dragAt(evt.clientX, id);
        const stop = () => {
            window.removeEventListener("pointermove", onMovePointer);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
        window.addEventListener("pointermove", onMovePointer);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    };

    return (
        <div className="tab-bar">
            <div ref={list} className="tab-list" role="tablist" aria-label="操作區分頁">
                {state.tabs.map((tab) => {
                    const title = titleOf(tab);
                    return (
                        <div
                            key={tab.id}
                            className="tab"
                            role="tab"
                            data-tab-id={tab.id}
                            aria-selected={tab.id === state.activeID}
                            tabIndex={0}
                            title={title}
                            onPointerDown={(evt) => {
                                if (evt.button !== 0) return;
                                startDrag(tab.id);
                                onActivate(tab.id);
                            }}
                            onAuxClick={(evt) => {
                                if (evt.button === 1 && closable) onClose(tab.id);
                            }}
                            onContextMenu={(evt) => {
                                evt.preventDefault();
                                setMenu({ x: evt.clientX, y: evt.clientY, id: tab.id });
                            }}
                            onKeyDown={(evt) => {
                                if (evt.key === "Enter") onActivate(tab.id);
                            }}
                        >
                            <span className="tab-title">{title}</span>
                            {closable && (
                                <button
                                    type="button"
                                    className="tab-close"
                                    aria-label={`關閉分頁 ${title}`}
                                    title="關閉分頁 (Ctrl+W)"
                                    onPointerDown={(evt) => evt.stopPropagation()}
                                    onClick={() => onClose(tab.id)}
                                >
                                    ×
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
            <button type="button" className="tab-add" aria-label="新增分頁" title="新增分頁 (Ctrl+T)" onClick={onAdd}>+</button>
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={[
                        {
                            label: "關閉分頁",
                            disabledReason: closable ? undefined : "至少要留一個分頁",
                            onSelect: () => onClose(menu.id),
                        },
                        {
                            label: "關閉其他分頁",
                            disabledReason: closable ? undefined : "沒有其他分頁",
                            onSelect: () => onCloseOthers(menu.id),
                        },
                    ]}
                    onClose={closeMenu}
                />
            )}
        </div>
    );
}

export default TabBar;
