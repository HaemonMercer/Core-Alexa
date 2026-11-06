import { useEffect, useRef } from "react";

const MENU_WIDTH = 170;
const ITEM_HEIGHT = 32;
const MENU_PADDING = 20;
const VIEWPORT_MARGIN = 8;

export interface MenuItem {
    label: string;
    disabledReason?: string;
    onSelect: () => void;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: MenuItem[];
    onClose: () => void;
}

function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const onPointerDown = (evt: PointerEvent) => {
            if (!menuRef.current?.contains(evt.target as Node)) onClose();
        };
        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key === "Escape") onClose();
        };
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("wheel", onClose);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("wheel", onClose);
        };
    }, [onClose]);

    // 靠近視窗邊緣時往內移，選單才不會被切掉。
    const left = Math.min(x, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);
    const height = items.length * ITEM_HEIGHT + MENU_PADDING;
    const top = Math.min(y, window.innerHeight - height - VIEWPORT_MARGIN);

    return (
        <div ref={menuRef} className="context-menu" role="menu" style={{ left, top, width: MENU_WIDTH }}>
            {items.map((item) => (
                <button
                    key={item.label}
                    role="menuitem"
                    disabled={item.disabledReason !== undefined}
                    title={item.disabledReason}
                    onClick={() => {
                        onClose();
                        item.onSelect();
                    }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}

export default ContextMenu;
