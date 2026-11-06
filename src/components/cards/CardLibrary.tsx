import { useCallback, useEffect, useState } from "react";
import FullscreenButton from "./FullscreenButton.tsx";
import NoteSummary from "./NoteSummary.tsx";
import ContextMenu from "../common/ContextMenu.tsx";
import { useNoteDeletion } from "../common/useDeletion.tsx";
import { useListSelection } from "../common/useListSelection.ts";
import { deleteLabel } from "../../noteTypes.ts";
import { useCardList } from "./useCardList.ts";
import { useTypeFilter } from "./useTypeFilter.tsx";

interface CardLibraryProps {
    cardsRevision: number;
    selectedID: string | null;
    syncedCard: { id: string; content: string } | null;
    /** 只選取一張時傳 id，右側面板才知道要開哪張；其他情況傳 null。 */
    onSelect: (id: string | null) => void;
    onOpenFullscreen: (id: string) => void;
    onDeleted: (ids: string[]) => void;
    onError: (error: unknown) => void;
}

function CardLibrary({
    cardsRevision, selectedID, syncedCard, onSelect, onOpenFullscreen, onDeleted, onError,
}: CardLibraryProps) {
    const notes = useCardList(cardsRevision, syncedCard, onError);
    const { visible: cards, bar: typeFilter } = useTypeFilter(notes);
    const [menu, setMenu] = useState<{ x: number; y: number; ids: string[] } | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);

    const deletion = useNoteDeletion((ids) => {
        selection.selectOnly(null);
        onDeleted(ids);
    }, onError);

    const askDelete = (ids: string[]) => {
        deletion.ask(notes?.filter((note) => ids.includes(note.id)) ?? []);
    };

    const ordered = cards?.map((card) => card.id) ?? [];
    const selection = useListSelection(ordered, selectedID, askDelete);
    const { selected } = selection;

    useEffect(() => {
        onSelect(selected.size === 1 ? [...selected][0] : null);
    }, [selected, onSelect]);

    // 右側面板可以跟著連結開到別張卡片，選取要跟上。
    useEffect(() => {
        if (selectedID && !selected.has(selectedID)) selection.selectOnly(selectedID);
        // 只在面板換卡片時同步；selected 改變時由上面的 effect 通知面板。
    }, [selectedID]);

    return (
        <section
            className="library"
            onClick={(evt) => {
                const target = evt.target as Element;
                if (target === evt.currentTarget || target.tagName === "UL") selection.selectOnly(null);
            }}
        >
            <h1>
                Card Library
                {selection.count > 1 && <span className="library-count">已選取 {selection.count} 張</span>}
            </h1>
            {typeFilter}
            {notes?.length === 0 && <p className="library-empty">還沒有卡片。在白板上雙擊空白處就能建立。</p>}
            <ul className="card-grid">
                {cards?.map((card) => (
                    <li
                        key={card.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={selected.has(card.id)}
                        onClick={(evt) => {
                            // 預覽裡的連結不能把整個 App 帶離開。
                            evt.preventDefault();
                            selection.click(card.id, evt);
                        }}
                        onContextMenu={(evt) => {
                            evt.preventDefault();
                            setMenu({ x: evt.clientX, y: evt.clientY, ids: selection.forContextMenu(card.id) });
                        }}
                        onKeyDown={(evt) => {
                            if (evt.key === "Enter") selection.selectOnly(card.id);
                        }}
                    >
                        <NoteSummary note={card} />
                        <FullscreenButton onOpen={() => onOpenFullscreen(card.id)} />
                    </li>
                ))}
            </ul>
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={[{
                        label: deleteLabel(notes?.filter((note) => menu.ids.includes(note.id)) ?? []),
                        onSelect: () => askDelete(menu.ids),
                    }]}
                    onClose={closeMenu}
                />
            )}
            {deletion.dialog}
        </section>
    );
}

export default CardLibrary;
