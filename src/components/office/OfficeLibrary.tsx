import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import * as api from "../../api.ts";
import { deleteLabel } from "../../noteTypes.ts";
import type { Note, NoteType, SheetContents } from "../../types.ts";
import FullscreenButton from "../cards/FullscreenButton.tsx";
import NoteSummary from "../cards/NoteSummary.tsx";
import { useTypeFilter } from "../cards/useTypeFilter.tsx";
import ContextMenu, { type MenuItem } from "../common/ContextMenu.tsx";
import { useNoteDeletion } from "../common/useDeletion.tsx";
import { useListSelection } from "../common/useListSelection.ts";
import { ChartLabel, SheetToggle, TableLabel } from "./SheetItems.tsx";
import { useOfficeDocuments } from "./useOfficeDocuments.ts";

const CREATE: { type: NoteType; label: string }[] = [
    { type: "writer", label: "新增 Writer" },
    { type: "sheet", label: "新增 Excels" },
    { type: "slides", label: "新增 Slides" },
];

const stop = (evt: SyntheticEvent) => evt.stopPropagation();

interface OfficeLibraryProps {
    cardsRevision: number;
    selectedID: string | null;
    onSelect: (id: string | null) => void;
    onOpen: (id: string) => void;
    /** 內容改變，要重新讀取。 */
    onChanged: () => void;
    onDeleted: (ids: string[]) => void;
    onError: (error: unknown) => void;
}

/** 和 Card Library 同樣的操作，只列 Office 類型。圖表自動收在來源 Excels 裡，展開就看得到。 */
function OfficeLibrary({ cardsRevision, selectedID, onSelect, onOpen, onChanged, onDeleted, onError }: OfficeLibraryProps) {
    const documents = useOfficeDocuments(cardsRevision, onError);
    const notes = documents?.notes ?? null;
    const sheets = documents?.sheets ?? {};
    const { visible, bar: typeFilter } = useTypeFilter(notes);
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);

    const contentsOf = (note: Note): SheetContents | undefined => (note.type === "sheet" ? sheets[note.id] : undefined);

    /** 展開的 Excels 裡的圖表排在它後面，Shift 多選與 Ctrl+A 才符合畫面順序。 */
    const shown = useMemo(() => visible?.flatMap((note) => [
        note,
        ...(expanded.has(note.id) ? documents?.sheets[note.id]?.charts ?? [] : []),
    ]) ?? [], [visible, expanded, documents]);

    const deletion = useNoteDeletion((ids) => {
        selection.selectOnly(null);
        onDeleted(ids);
    }, onError);

    const askDelete = (ids: string[]) => {
        deletion.ask(shown.filter((note) => ids.includes(note.id)));
    };

    const selection = useListSelection(shown.map((note) => note.id), selectedID, askDelete);
    const { selected } = selection;

    useEffect(() => {
        onSelect(selected.size === 1 ? [...selected][0] : null);
    }, [selected, onSelect]);

    // 右側面板可以開到別份文件，選取要跟上。
    useEffect(() => {
        if (selectedID && !selected.has(selectedID)) selection.selectOnly(selectedID);
        // 只在面板換文件時同步；selected 改變時由上面的 effect 通知面板。
    }, [selectedID]);

    const create = (type: NoteType) => {
        api.createDocument(type)
            .then((note) => {
                onChanged();
                onOpen(note.id);
            })
            .catch(onError);
    };

    const toggle = (id: string) => {
        setExpanded((current) => {
            const next = new Set(current);
            if (!next.delete(id)) next.add(id);
            return next;
        });
    };

    const noteMenu = (evt: { clientX: number; clientY: number }, note: Note) => {
        const ids = selection.forContextMenu(note.id);
        setMenu({
            x: evt.clientX,
            y: evt.clientY,
            items: [
                ...(ids.length === 1 ? [{ label: "開啟", onSelect: () => onOpen(ids[0]) }] : []),
                {
                    label: deleteLabel(shown.filter((item) => ids.includes(item.id))),
                    onSelect: () => askDelete(ids),
                },
            ],
        });
    };

    return (
        <section
            className="library"
            onClick={(evt) => {
                const target = evt.target as Element;
                if (target === evt.currentTarget || target.tagName === "UL") selection.selectOnly(null);
            }}
        >
            <h1>
                Office Library
                {selection.count > 1 && <span className="library-count">已選取 {selection.count} 份</span>}
            </h1>
            <div className="library-actions">
                {CREATE.map(({ type, label }) => (
                    <button key={type} className="open-button" onClick={() => create(type)}>{label}</button>
                ))}
            </div>
            {typeFilter}
            {notes?.length === 0 && <p className="library-empty">還沒有文件。用上面的按鈕新增一份。</p>}
            <ul className="card-grid">
                {visible?.map((note) => {
                    const contents = contentsOf(note);
                    const open = contents !== undefined && expanded.has(note.id);
                    return (
                        <li
                            key={note.id}
                            className={contents ? "sheet-tile" : undefined}
                            data-open={open}
                            role="button"
                            tabIndex={0}
                            aria-pressed={selected.has(note.id)}
                            onClick={(evt) => {
                                evt.preventDefault();
                                selection.click(note.id, evt);
                            }}
                            onDoubleClick={() => onOpen(note.id)}
                            onContextMenu={(evt) => {
                                evt.preventDefault();
                                noteMenu(evt, note);
                            }}
                            onKeyDown={(evt) => {
                                if (evt.key === "Enter") onOpen(note.id);
                            }}
                        >
                            <NoteSummary note={note} />
                            <FullscreenButton onOpen={() => onOpen(note.id)} />
                            {contents && <SheetToggle contents={contents} open={open} onToggle={() => toggle(note.id)} />}
                            {contents && open && (
                                <div className="sheet-items" onClick={stop} onDoubleClick={stop} onContextMenu={stop} onKeyDown={stop}>
                                    {contents.tables.map((table) => (
                                        <div
                                            key={table.id}
                                            className="sheet-item"
                                            role="button"
                                            tabIndex={0}
                                            onDoubleClick={() => onOpen(note.id)}
                                            onContextMenu={(evt) => {
                                                evt.preventDefault();
                                                setMenu({
                                                    x: evt.clientX,
                                                    y: evt.clientY,
                                                    items: [{ label: "開啟 Excels", onSelect: () => onOpen(note.id) }],
                                                });
                                            }}
                                        >
                                            <TableLabel table={table} />
                                        </div>
                                    ))}
                                    {contents.charts.map((chart) => (
                                        <div
                                            key={chart.id}
                                            className="sheet-item"
                                            role="button"
                                            tabIndex={0}
                                            aria-pressed={selected.has(chart.id)}
                                            onClick={(evt) => selection.click(chart.id, evt)}
                                            onDoubleClick={() => onOpen(chart.id)}
                                            onContextMenu={(evt) => {
                                                evt.preventDefault();
                                                noteMenu(evt, chart);
                                            }}
                                            onKeyDown={(evt) => {
                                                if (evt.key === "Enter") onOpen(chart.id);
                                            }}
                                        >
                                            <ChartLabel note={chart} />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
            {deletion.dialog}
        </section>
    );
}

export default OfficeLibrary;
