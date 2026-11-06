import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { ChartData } from "../../types.ts";
import DocumentTitle from "../office/DocumentTitle.tsx";
import { bumpSheetRevision } from "../office/officePreview.ts";
import ChartView from "./ChartView.tsx";
import { CHART_KINDS } from "./layout.ts";

interface ChartEditorProps {
    noteID: string;
    onChanged: () => void;
    onError: (error: unknown) => void;
}

/** 圖表的資料來自試算表，這裡只改呈現方式。 */
function ChartEditor({ noteID, onChanged, onError }: ChartEditorProps) {
    const [data, setData] = useState<ChartData | null>(null);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        api.getChart(noteID).then(setData).catch(onError);
    }, [noteID, onError]);

    const change = (kind?: string, seriesBy?: string) => {
        api.setChart(noteID, kind, seriesBy)
            .then((next) => {
                setData(next);
                setRevision((value) => value + 1);
                bumpSheetRevision();
                onChanged();
            })
            .catch(onError);
    };

    return (
        <div className="chart-editor">
            <DocumentTitle
                noteID={noteID}
                placeholder="未命名圖表"
                className="sheet-title"
                onChanged={() => {
                    setRevision((value) => value + 1);
                    bumpSheetRevision();
                    onChanged();
                }}
                onError={onError}
            />
            <div className="chart-kinds" role="group" aria-label="圖表種類">
                {CHART_KINDS.map(({ id, label }) => (
                    <button key={id} aria-pressed={data?.kind === id} onClick={() => change(id)}>{label}</button>
                ))}
                <button
                    title="把列與欄的角色對調"
                    onClick={() => change(undefined, data?.seriesBy === "rows" ? "cols" : "rows")}
                >
                    列欄互換
                </button>
            </div>
            <div className="chart-stage"><ChartView noteID={noteID} revision={revision} onError={onError} /></div>
        </div>
    );
}

export default ChartEditor;
