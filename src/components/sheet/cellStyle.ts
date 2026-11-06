import type { CSSProperties } from "react";
import type { CellView } from "../../types.ts";

/** 數字靠右、文字靠左，使用者指定的對齊優先。 */
export function cellStyle(cell: CellView | undefined): CSSProperties {
    if (!cell) return {};
    return {
        fontWeight: cell.bold ? 700 : undefined,
        fontStyle: cell.italic ? "italic" : undefined,
        textDecoration: [cell.underline && "underline", cell.strike && "line-through"].filter(Boolean).join(" ") || undefined,
        textAlign: (cell.align ?? (cell.kind === "number" ? "right" : undefined)) as CSSProperties["textAlign"],
        background: cell.fill ?? undefined,
        color: cell.color ?? undefined,
    };
}
