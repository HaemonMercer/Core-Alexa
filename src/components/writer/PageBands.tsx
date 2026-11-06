import { useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { BandSlot, WriterPage } from "../../types.ts";
import { BAND_SLOTS, bandTop, showsBands, slotNumber, type BandArea, type PageBox } from "./pageFormat.ts";

const AREAS: { id: BandArea; label: string }[] = [
    { id: "header", label: "頁首" },
    { id: "footer", label: "頁尾" },
];

interface PageBandsProps {
    page: WriterPage;
    box: PageBox;
    pages: number;
    onType: (page: WriterPage) => void;
}

interface Editing {
    area: BandArea;
    index: number;
    slot: BandSlot;
}

/** 連按的位置落在哪一格。 */
function slotAt(evt: MouseEvent<HTMLElement>): BandSlot {
    const box = evt.currentTarget.getBoundingClientRect();
    return BAND_SLOTS[Math.min(2, Math.floor(((evt.clientX - box.left) / box.width) * 3))].id;
}

/** 每一頁上下留白裡的頁首頁尾。平常是淡淡的字，連按兩下才能編輯，和 Word 一樣；內容不佔文件的版面。 */
function PageBands({ page, box, pages, onType }: PageBandsProps) {
    const [editing, setEditing] = useState<Editing | null>(null);

    const onBlur = (evt: FocusEvent<HTMLElement>) => {
        // 在三格之間移動不算離開。
        if (!evt.currentTarget.contains(evt.relatedTarget)) setEditing(null);
    };

    const onKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
        if (evt.nativeEvent.isComposing || (evt.key !== "Enter" && evt.key !== "Escape")) return;
        // 這次 Esc 是離開頁首，不能連全螢幕一起關掉。
        evt.preventDefault();
        setEditing(null);
    };

    const renderBand = (area: BandArea, label: string, index: number) => {
        const open = editing?.area === area && editing.index === index;
        const band = page[area];
        const center = band.center !== "" || slotNumber(page, area, "center", index, pages) !== "";
        return (
            <div
                key={`${area}${index}`}
                className="writer-band"
                data-area={area}
                data-open={open}
                data-center={center}
                style={{ top: bandTop(box, area, index), height: box.margin, paddingInline: box.margin }}
                title={open ? undefined : `連按兩下編輯${label}`}
                onDoubleClick={(evt) => {
                    if (!open) setEditing({ area, index, slot: slotAt(evt) });
                }}
                onBlur={open ? onBlur : undefined}
            >
                {BAND_SLOTS.map(({ id, label: slotLabel }) => {
                    const number = slotNumber(page, area, id, index, pages);
                    return (
                        <span key={id} className="writer-band-slot" data-slot={id}>
                            {open ? (
                                <input
                                    autoFocus={editing?.slot === id}
                                    aria-label={`${label}${slotLabel}`}
                                    placeholder={slotLabel}
                                    value={band[id]}
                                    onChange={(evt) => onType({ ...page, [area]: { ...band, [id]: evt.target.value } })}
                                    onKeyDown={onKeyDown}
                                />
                            ) : <span className="writer-band-text">{band[id]}</span>}
                            {number && <span className="writer-band-number">{number}</span>}
                        </span>
                    );
                })}
            </div>
        );
    };

    return Array.from({ length: pages }, (_, index) => (showsBands(page, index) ? AREAS.map(({ id, label }) => renderBand(id, label, index)) : null));
}

export default PageBands;
