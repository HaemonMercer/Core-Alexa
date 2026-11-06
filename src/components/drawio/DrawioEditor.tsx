import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import * as api from "../../api.ts";
import { noteTitle } from "../../noteTypes.ts";
import type { Note } from "../../types.ts";

// 編輯器是打包進 app 的 Draw.io，跑在獨立來源的 iframe，只透過 postMessage 溝通。
// iframe 碰不到 IPC（見 src-tauri/src/drawio.rs），所以存檔都由這裡代勞。

const EMBED_QUERY = "embed=1&proto=json&spin=1&stealth=1&lang=zh-tw&noExitBtn=1&noSaveBtn=1&saveAndExit=0";
const EDITOR_URL = `${convertFileSrc("index.html", "drawio")}?${EMBED_QUERY}`;
const EDITOR_ORIGIN = new URL(EDITOR_URL).origin;
const LOAD_TIMEOUT_MS = 30000;
/** 連續編輯時不必每一步都匯出預覽。 */
const PREVIEW_DELAY_MS = 600;
const FLUSH_TIMEOUT_MS = 5000;
const PREVIEW_SCALE = 2;

interface DrawioMessage {
    event: string;
    xml?: string;
    data?: string;
}

export interface DrawioHandle {
    /** 關閉前呼叫：iframe 一移除就無法匯出，要等最後的預覽存好。 */
    flush: () => Promise<void>;
}

interface DrawioEditorProps {
    ref: Ref<DrawioHandle>;
    note: Note;
    onChanged: () => void;
    onError: (error: unknown) => void;
}

function parseMessage(data: unknown): DrawioMessage | null {
    if (typeof data !== "string") return null;
    try {
        const message: unknown = JSON.parse(data);
        return typeof message === "object" && message !== null && "event" in message
            ? message as DrawioMessage
            : null;
    } catch {
        return null;
    }
}

async function toBlob(dataUri: string) {
    return (await fetch(dataUri)).blob();
}

function DrawioEditor({ ref, note, onChanged, onError }: DrawioEditorProps) {
    const frame = useRef<HTMLIFrameElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const exporting = useRef(false);
    /** 匯出期間又有改動，匯出完要再來一次。 */
    const stale = useRef(false);
    const waiters = useRef<(() => void)[]>([]);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);

    // 只在開啟時載入一次，之後的內容以編輯器為準。
    const initial = useRef({ xml: note.context.xml, title: noteTitle(note), id: note.id });

    const post = (message: object) => {
        frame.current?.contentWindow?.postMessage(JSON.stringify(message), EDITOR_ORIGIN);
    };

    const requestPreview = () => {
        timer.current = null;
        if (exporting.current) {
            stale.current = true;
            return;
        }
        exporting.current = true;
        stale.current = false;
        post({ action: "export", format: "png", scale: PREVIEW_SCALE, background: "#ffffff" });
    };

    const settle = () => {
        exporting.current = false;
        if (stale.current) {
            requestPreview();
            return;
        }
        for (const resolve of waiters.current.splice(0)) resolve();
    };

    useEffect(() => {
        const { id, xml, title } = initial.current;

        const onMessage = (evt: MessageEvent) => {
            if (evt.origin !== EDITOR_ORIGIN || evt.source !== frame.current?.contentWindow) return;
            const message = parseMessage(evt.data);
            if (!message) return;

            if (message.event === "init") {
                post({ action: "load", xml: typeof xml === "string" ? xml : "", autosave: 1, title });
            } else if (message.event === "load") {
                setReady(true);
            } else if (message.event === "autosave" && message.xml !== undefined) {
                // XML 馬上存，預覽等編輯停下來再匯出。關閉時來不及匯出也不會遺失內容。
                api.saveDrawioXml(id, message.xml).catch(onError);
                if (timer.current !== null) clearTimeout(timer.current);
                timer.current = setTimeout(requestPreview, PREVIEW_DELAY_MS);
            } else if (message.event === "export" && message.data) {
                toBlob(message.data)
                    .then((blob) => api.saveDrawioPreview(id, blob))
                    .then(onChanged)
                    .catch(onError)
                    .finally(settle);
            }
        };

        window.addEventListener("message", onMessage);
        const loading = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
        return () => {
            window.removeEventListener("message", onMessage);
            clearTimeout(loading);
            if (timer.current !== null) clearTimeout(timer.current);
            for (const resolve of waiters.current.splice(0)) resolve();
        };
        // 只綁一次；`onChanged`、`onError` 都是穩定的回呼。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
        flush: () => new Promise<void>((resolve) => {
            const pending = timer.current !== null;
            if (!pending && !exporting.current) {
                resolve();
                return;
            }
            waiters.current.push(resolve);
            setTimeout(resolve, FLUSH_TIMEOUT_MS);
            if (pending) {
                clearTimeout(timer.current as ReturnType<typeof setTimeout>);
                requestPreview();
            }
        }),
    }), []);

    if (failed && !ready) {
        return <p className="library-empty right-panel-hint">Draw.io 編輯器無法載入，請重新開啟。</p>;
    }
    return <iframe ref={frame} className="drawio-frame" src={EDITOR_URL} title="Draw.io 編輯器" />;
}

export default DrawioEditor;
