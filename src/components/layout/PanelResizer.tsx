import { useRef, useState, type PointerEvent } from "react";

const STORAGE_PREFIX = "code-alexa.panel-width.";

/** 拖曳時不能把操作區擠掉。 */
const MIN_WORKSPACE = 320;

interface WidthRange {
    initial: number;
    min: number;
    max: number;
}

function readWidth(side: string, { initial, min, max }: WidthRange) {
    try {
        const saved = Number(localStorage.getItem(STORAGE_PREFIX + side));
        return saved ? Math.min(max, Math.max(min, saved)) : initial;
    } catch {
        return initial;
    }
}

/** 面板寬度是這台裝置的顯示偏好，不是工作區資料，所以不進 SQLite。 */
export function usePanelWidth(side: "left" | "right", range: WidthRange) {
    const [width, setWidth] = useState(() => readWidth(side, range));
    const update = (next: number) => {
        setWidth(next);
        try {
            localStorage.setItem(STORAGE_PREFIX + side, String(next));
        } catch {
            // 存不下只是下次回到預設寬度。
        }
    };
    return [width, update] as const;
}

interface PanelResizerProps {
    side: "left" | "right";
    width: number;
    range: WidthRange;
    /** 另一個面板的寬度，兩邊加起來要留下操作區。 */
    otherWidth: number;
    onChange: (width: number) => void;
}

function PanelResizer({ side, width, range, otherWidth, onChange }: PanelResizerProps) {
    const start = useRef<{ x: number; width: number } | null>(null);

    const onPointerMove = (evt: PointerEvent) => {
        if (!start.current) return;
        const moved = evt.clientX - start.current.x;
        const max = Math.min(range.max, window.innerWidth - otherWidth - MIN_WORKSPACE);
        const next = start.current.width + (side === "left" ? moved : -moved);
        onChange(Math.round(Math.max(range.min, Math.min(max, next))));
    };

    return (
        <div
            className="panel-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={side === "left" ? "調整左側面板寬度" : "調整右側面板寬度"}
            // 拖曳時不能選到文字。
            onMouseDown={(evt) => evt.preventDefault()}
            onPointerDown={(evt) => {
                if (evt.button !== 0) return;
                evt.currentTarget.setPointerCapture(evt.pointerId);
                start.current = { x: evt.clientX, width };
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => {
                start.current = null;
            }}
            onPointerCancel={() => {
                start.current = null;
            }}
        />
    );
}

export default PanelResizer;
