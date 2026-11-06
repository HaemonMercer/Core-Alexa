import { useEffect, useRef } from "react";

/** 像白板一樣可以放卡片的地方。Writer、Slides、Excels 全螢幕時由編輯器提供，右側的 Card Library 拖到這裡。 */
export interface CardSurface {
    /** 顯示在提示文字，例如「把卡片拖到文件上」。 */
    name: string;
    /** 已經放在這裡的筆記，不能再放一次。 */
    placed: ReadonlySet<string>;
    /** 也放得下 Excels 的表格和圖表，右側面板要有 Office Library 分頁。 */
    office?: boolean;
    /** 放開滑鼠的位置（螢幕座標）。放開在編輯區外面就不放。拖的是表格時有 `tableID`。 */
    placeAt: (noteID: string, clientX: number, clientY: number, tableID?: string) => void;
    placeAtCenter: (noteID: string, tableID?: string) => void;
    /** 拖曳中的位置，用來顯示會放在哪裡。`null` 是拖曳結束。 */
    hover?: (point: { x: number; y: number } | null) => void;
}

type SurfaceActions = Omit<CardSurface, "name" | "placed" | "office">;

/** 編輯器掛載時把自己交給 App，卸載時收回。`placed` 要 memo，內容改變才需要通知 App。 */
export function useCardSurface(
    onSurface: ((surface: CardSurface | null) => void) | undefined,
    name: string,
    placed: ReadonlySet<string>,
    actions: SurfaceActions,
    office = false,
) {
    const latest = useRef(actions);
    latest.current = actions;

    useEffect(() => {
        if (!onSurface) return;
        onSurface({
            name,
            placed,
            office,
            placeAt: (noteID, clientX, clientY, tableID) => latest.current.placeAt(noteID, clientX, clientY, tableID),
            placeAtCenter: (noteID, tableID) => latest.current.placeAtCenter(noteID, tableID),
            hover: (point) => latest.current.hover?.(point),
        });
        return () => onSurface(null);
    }, [onSurface, name, placed, office]);
}
