import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getDataLocation, inspectDataLocation, setDataLocation } from "../../api.ts";
import type { DataLocationInfo } from "../../types.ts";

interface DataLocationDialogProps {
    /** 重新啟動前要先存好編輯中的內容。 */
    onBeforeMove: () => Promise<void>;
    onClose: () => void;
}

interface Choice {
    path: string;
    hasData: boolean;
}

/** 顯示資料存在哪裡，並讓使用者換一個資料夾。 */
function DataLocationDialog({ onBeforeMove, onClose }: DataLocationDialogProps) {
    const [location, setLocation] = useState<DataLocationInfo | null>(null);
    const [choice, setChoice] = useState<Choice | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        void getDataLocation().then(setLocation).catch((reason) => setError(String(reason)));
    }, []);

    const pick = async () => {
        setError("");
        const path = await open({ directory: true, title: "選擇資料位置" });
        if (typeof path !== "string") return;
        try {
            setChoice({ path, hasData: await inspectDataLocation(path) });
        } catch (reason) {
            setError(String(reason));
        }
    };

    const apply = async () => {
        if (!choice) return;
        setBusy(true);
        setError("");
        try {
            await onBeforeMove();
            // 成功時程式直接重新啟動，不會回到這裡。
            await setDataLocation(choice.path);
        } catch (reason) {
            setError(String(reason));
            setBusy(false);
        }
    };

    return (
        <div
            className="confirm-backdrop"
            onKeyDown={(evt) => {
                if (evt.key !== "Escape" || busy) return;
                evt.stopPropagation();
                onClose();
            }}
        >
            <div className="confirm-dialog data-location" role="dialog" aria-modal="true" aria-label="資料位置">
                <h2>資料位置</h2>
                {location?.unavailable && (
                    <p className="data-location-warning">
                        找不到 {location.unavailable}。如果它在外接硬碟上，接上後重新開啟程式即可。現在顯示的是預設位置的資料。
                    </p>
                )}
                <code className="data-location-path">{location?.path ?? "讀取中…"}</code>
                {choice && (
                    <>
                        <code className="data-location-path">{choice.path}</code>
                        <p>
                            {choice.hasData
                                ? "這個資料夾已經有資料，會改用那份資料，目前的資料不會合併過去。程式會重新啟動。"
                                : "會把全部資料複製到這個資料夾，舊位置的資料會保留。程式會重新啟動。"}
                        </p>
                    </>
                )}
                {busy && <p>處理中，圖片和影片多時需要一些時間…</p>}
                {error && <p className="data-location-warning" role="alert">{error}</p>}
                <div className="confirm-actions">
                    {choice ? (
                        <>
                            <button type="button" className="open-button" disabled={busy} onClick={() => setChoice(null)}>取消</button>
                            <button type="button" className="open-button" disabled={busy} onClick={() => void apply()}>
                                {choice.hasData ? "改用這份資料" : "複製並改用"}
                            </button>
                        </>
                    ) : (
                        <>
                            <button type="button" className="open-button" onClick={onClose}>關閉</button>
                            <button type="button" className="open-button" onClick={() => void pick()}>更換位置…</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default DataLocationDialog;
