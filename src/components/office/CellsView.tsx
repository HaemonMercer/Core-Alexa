import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { CellRange, RangeView } from "../../types.ts";
import { cellStyle } from "../sheet/cellStyle.ts";

interface CellsViewProps {
    source: CellRange;
    /** 來源可能改過時遞增，就會重新讀取。 */
    revision?: number;
    /** 簡報上文字要跟著放大。 */
    fontSize?: number;
    onError: (error: unknown) => void;
}

/** 引入的格子：唯讀，內容每次從試算表重新讀取，所以永遠是最新的。 */
function CellsView({ source, revision = 0, fontSize, onError }: CellsViewProps) {
    const [view, setView] = useState<RangeView | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.getCellRange(source)
            .then((next) => {
                if (!cancelled) setView(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [source, revision, onError]);

    if (!view) return null;
    if (view.error) return <p className="cells-error">{view.error}</p>;
    return (
        <table className="cells-view" style={fontSize ? { fontSize } : undefined}>
            <tbody>
                {view.rows.map((row, y) => (
                    <tr key={y}>
                        {row.map((cell, x) => (
                            <td
                                key={x}
                                data-header={y < view.headerRows || x < view.headerCols}
                                data-kind={cell.kind}
                                style={cellStyle(cell)}
                            >
                                {cell.display}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default CellsView;
