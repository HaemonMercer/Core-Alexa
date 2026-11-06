import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import { noteTitle } from "../../noteTypes.ts";
import type { NoteLink, NoteLinks } from "../../types.ts";

/** 打字時不必每個字都重新計算。 */
const REFRESH_DELAY_MS = 300;

interface CardLinksProps {
    cardID: string;
    /** 只有卡片的內文能打 [[，其他類型不顯示這個提示。 */
    showHint: boolean;
    /** 內容或箭頭改變時遞增，要重新計算連結。 */
    revision: number;
    onOpenCard: (id: string) => void;
    onError: (error: unknown) => void;
}

function describe(link: NoteLink): string {
    if (link.source === "mention") return "內文連結";
    const place = `箭頭 · ${link.whiteboardName}`;
    return link.label ? `${place} · ${link.label}` : place;
}

function LinkGroup({ title, links, onOpenCard }: {
    title: string;
    links: NoteLink[];
    onOpenCard: (id: string) => void;
}) {
    if (links.length === 0) return null;
    return (
        <>
            <h2>{title}</h2>
            <ul>
                {links.map((link) => (
                    <li key={link.id}>
                        <button type="button" onClick={() => onOpenCard(link.note.id)}>
                            <span className="card-link-title">{noteTitle(link.note)}</span>
                            <span className="card-link-source">{describe(link)}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </>
    );
}

function CardLinks({ cardID, showHint, revision, onOpenCard, onError }: CardLinksProps) {
    const [links, setLinks] = useState<NoteLinks | null>(null);
    const loaded = links !== null;

    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            api.getNoteLinks(cardID)
                .then((next) => {
                    if (!cancelled) setLinks(next);
                })
                .catch(onError);
        }, loaded ? REFRESH_DELAY_MS : 0);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [cardID, revision, loaded, onError]);

    if (!links) return null;
    const empty = links.outgoing.length === 0 && links.incoming.length === 0;

    return (
        <section className="card-links" aria-label="卡片連結">
            {empty && showHint && <p className="library-empty">在內文輸入 [[ 可以連結其他卡片。</p>}
            <LinkGroup title="連到" links={links.outgoing} onOpenCard={onOpenCard} />
            <LinkGroup title="反向連結" links={links.incoming} onOpenCard={onOpenCard} />
        </section>
    );
}

export default CardLinks;
