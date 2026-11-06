import { useEffect, useState } from "react";
import { renderMermaid, type Diagram } from "./render.ts";

/** 語法寫到一半時保留上一張正確的圖，`error` 說明目前哪裡有問題。 */
export function useDiagram(text: string, delayMs = 0) {
    const [diagram, setDiagram] = useState<Diagram | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!text.trim()) {
            setDiagram(null);
            setError(null);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(() => {
            renderMermaid(text).then(
                (next) => {
                    if (cancelled) return;
                    setDiagram(next);
                    setError(null);
                },
                (reason: unknown) => {
                    if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
                },
            );
        }, delayMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [text, delayMs]);

    return { diagram, error };
}
