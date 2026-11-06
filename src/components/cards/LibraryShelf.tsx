import type { Note } from "../../types.ts";
import { useOfficeDocuments } from "../office/useOfficeDocuments.ts";
import CardShelf from "./CardShelf.tsx";
import { useCardList } from "./useCardList.ts";

export type ShelfTab = "cards" | "office";

const TABS: { id: ShelfTab; label: string }[] = [
    { id: "cards", label: "Card Library" },
    { id: "office", label: "Office Library" },
];

interface LibraryShelfProps {
    tab: ShelfTab;
    onTabChange: (tab: ShelfTab) => void;
    cardsRevision: number;
    syncedCard: { id: string; content: string } | null;
    canPlace: boolean;
    placedNoteIDs: ReadonlySet<string>;
    accepts?: (note: Note) => boolean;
    /** Slides 和 Excels 只放卡片，沒有 Office Library 分頁。 */
    cardsOnly?: boolean;
    surfaceName?: string;
    onHover?: (point: { x: number; y: number } | null) => void;
    onDrop: (id: string, clientX: number, clientY: number, tableID?: string) => void;
    onPlaceAtCenter: (id: string, tableID?: string) => void;
    onOpen: (id: string) => void;
    onOpenFullscreen: (id: string) => void;
    onOpenInTab: (id: string) => void;
    onDeleted: (ids: string[]) => void;
    onError: (error: unknown) => void;
}

/** 白板與文件的右側面板。Office 內容不在 Card Library，要放上白板時從這裡的分頁拖。 */
function LibraryShelf({ tab, onTabChange, cardsRevision, syncedCard, cardsOnly = false, ...shelf }: LibraryShelfProps) {
    const cards = useCardList(cardsRevision, syncedCard, shelf.onError);
    const documents = useOfficeDocuments(cardsRevision, shelf.onError);

    return (
        <>
            {!cardsOnly && (
                <div className="shelf-tabs" role="tablist">
                    {TABS.map(({ id, label }) => (
                        <button key={id} role="tab" aria-selected={tab === id} onClick={() => onTabChange(id)}>{label}</button>
                    ))}
                </div>
            )}
            {cardsOnly || tab === "cards" ? (
                <CardShelf key="cards" notes={cards} empty="還沒有卡片。在白板上雙擊空白處就能建立。" {...shelf} />
            ) : (
                <CardShelf
                    key="office"
                    notes={documents?.notes ?? null}
                    sheets={documents?.sheets}
                    empty="還沒有文件。到 Office Library 新增一份。"
                    {...shelf}
                />
            )}
        </>
    );
}

export default LibraryShelf;
