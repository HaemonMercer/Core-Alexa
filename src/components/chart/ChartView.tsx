import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../api.ts";
import type { ChartData } from "../../types.ts";
import { layoutChart, type Mark } from "./layout.ts";

const DEFAULT_SIZE = { w: 480, h: 300 };

interface ChartViewProps {
    noteID: string;
    /** 改變時重新讀取，來源的試算表改過就要遞增。 */
    revision?: number;
    onError: (error: unknown) => void;
}

function MarkShape({ mark, onHover }: { mark: Mark; onHover: (label: string | null, x: number, y: number) => void }) {
    const hover = "label" in mark && mark.label
        ? {
            onPointerMove: (evt: React.PointerEvent) => onHover(mark.label ?? null, evt.clientX, evt.clientY),
            onPointerLeave: () => onHover(null, 0, 0),
        }
        : {};
    switch (mark.t) {
        case "line":
            return <line {...mark} strokeWidth={mark.width} />;
        case "path":
            return <path d={mark.d} fill={mark.fill} fillOpacity={mark.opacity} stroke={mark.stroke} strokeWidth={mark.width} strokeLinejoin="round" {...hover} />;
        case "rect":
            return <rect x={mark.x} y={mark.y} width={mark.w} height={mark.h} rx={mark.radius} fill={mark.fill} {...hover} />;
        case "circle":
            return <circle cx={mark.x} cy={mark.y} r={mark.r} fill={mark.fill} stroke={mark.stroke} {...hover} />;
        case "text":
            return <text x={mark.x} y={mark.y} fontSize={mark.size} fill={mark.fill} textAnchor={mark.anchor} fontWeight={mark.weight}>{mark.text}</text>;
    }
}

/** 圖表跟著容器大小重新排版，文字不會被縮放變形。 */
function ChartView({ noteID, revision = 0, onError }: ChartViewProps) {
    const [data, setData] = useState<ChartData | null>(null);
    const [size, setSize] = useState(DEFAULT_SIZE);
    const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
    const box = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;
        api.getChart(noteID)
            .then((next) => {
                if (!cancelled) setData(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, revision, onError]);

    useEffect(() => {
        const element = box.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const marks = useMemo(() => (data ? layoutChart(data, size.w, size.h) : []), [data, size]);

    return (
        <div ref={box} className="chart-view">
            <svg width={size.w} height={size.h} role="img" aria-label={data?.title || "圖表"}>
                {marks.map((mark, index) => (
                    <MarkShape
                        key={index}
                        mark={mark}
                        onHover={(label, x, y) => setTip(label ? { label, x, y } : null)}
                    />
                ))}
            </svg>
            {tip && <div className="chart-tip" style={{ left: tip.x + 12, top: tip.y + 12 }}>{tip.label}</div>}
        </div>
    );
}

export default ChartView;
