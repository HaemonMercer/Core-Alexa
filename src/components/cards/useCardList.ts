import { useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { Note } from "../../types.ts";

/** Card Library 的清單。Office 類型只在 Office Library。`revision` 在內容增減時遞增，就會重新讀取。 */
export function useCardList(
    revision: number,
    syncedCard: { id: string; content: string } | null,
    onError: (error: unknown) => void,
): Note[] | null {
    const [cards, setCards] = useState<Note[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.getCardNotes()
            .then((next) => {
                if (!cancelled) setCards(next);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [revision, onError]);

    // 只更新內容，不重新排序，卡片才不會在編輯時跳走。
    useEffect(() => {
        if (!syncedCard) return;
        setCards((current) =>
            current?.map((card) =>
                card.id === syncedCard.id ? { ...card, content: syncedCard.content } : card,
            ) ?? null,
        );
    }, [syncedCard]);

    return cards;
}
