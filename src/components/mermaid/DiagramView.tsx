import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { zoomAt, type View } from "../canvas/viewport.ts";
import type { Diagram } from "./render.ts";
import { fitView } from "./size.ts";

const INITIAL_VIEW: View = { x: 0, y: 0, scale: 1 };

/** 滾輪縮放、拖曳平移。動過之前都維持「符合大小」，改內容或調整視窗時會重新置中。 */
function DiagramView({ diagram }: { diagram: Diagram | null }) {
    const container = useRef<HTMLDivElement>(null);
    const fitted = useRef(true);
    const drag = useRef<{ x: number; y: number } | null>(null);
    const [view, setView] = useState(INITIAL_VIEW);

    const fit = useCallback(() => {
        const box = container.current;
        if (!box || !diagram) return;
        fitted.current = true;
        setView(fitView(box.clientWidth, box.clientHeight, diagram.width, diagram.height));
    }, [diagram]);

    const change = useCallback((update: (current: View) => View) => {
        fitted.current = false;
        setView(update);
    }, []);

    /** 按鈕以畫面中央為縮放中心。 */
    const zoomButton = (zoomIn: boolean) => {
        const box = container.current;
        if (box) change((current) => zoomAt(current, box.clientWidth / 2, box.clientHeight / 2, zoomIn));
    };

    useEffect(() => {
        const box = container.current;
        if (!box) return;
        const observer = new ResizeObserver(() => {
            if (fitted.current) fit();
        });
        observer.observe(box);
        return () => observer.disconnect();
    }, [fit]);

    useEffect(() => {
        const box = container.current;
        if (!box) return;
        // React 的 wheel 是被動監聽，不能取消捲動。
        const onWheel = (evt: WheelEvent) => {
            evt.preventDefault();
            const bounds = box.getBoundingClientRect();
            change((current) => zoomAt(current, evt.clientX - bounds.left, evt.clientY - bounds.top, evt.deltaY < 0));
        };
        box.addEventListener("wheel", onWheel, { passive: false });
        return () => box.removeEventListener("wheel", onWheel);
    }, [change]);

    const onPointerDown = (evt: PointerEvent<HTMLDivElement>) => {
        evt.currentTarget.setPointerCapture(evt.pointerId);
        drag.current = { x: evt.clientX, y: evt.clientY };
    };

    const onPointerMove = (evt: PointerEvent<HTMLDivElement>) => {
        const from = drag.current;
        if (!from) return;
        drag.current = { x: evt.clientX, y: evt.clientY };
        change((current) => ({
            ...current,
            x: current.x + evt.clientX - from.x,
            y: current.y + evt.clientY - from.y,
        }));
    };

    return (
        <div className="diagram-view">
            <div
                ref={container}
                className="diagram-stage"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={() => { drag.current = null; }}
                onPointerCancel={() => { drag.current = null; }}
            >
                {diagram ? (
                    // 改寬高而不是用 transform，放大後 SVG 才會重新繪製，不會糊掉。
                    <img
                        src={diagram.dataUri}
                        alt="Mermaid 圖表"
                        draggable={false}
                        style={{
                            left: view.x,
                            top: view.y,
                            width: diagram.width * view.scale,
                            height: diagram.height * view.scale,
                        }}
                    />
                ) : (
                    <p className="library-empty">在這裡預覽圖表。輸入語法或插入範本開始。</p>
                )}
            </div>
            {diagram && (
                <div className="diagram-controls" role="group" aria-label="預覽縮放">
                    <button type="button" title="縮小" aria-label="縮小" onClick={() => zoomButton(false)}>−</button>
                    <span>{Math.round(view.scale * 100)}%</span>
                    <button type="button" title="放大" aria-label="放大" onClick={() => zoomButton(true)}>+</button>
                    <button type="button" title="符合大小" onClick={fit}>符合</button>
                </div>
            )}
        </div>
    );
}

export default DiagramView;
