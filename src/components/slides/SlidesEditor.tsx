import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import * as api from "../../api.ts";
import type { CellRange, ElementPatch, Note, SlideElement, SlidesOp, SlidesState } from "../../types.ts";
import ContextMenu, { type MenuItem } from "../common/ContextMenu.tsx";
import DocumentTitle from "../office/DocumentTitle.tsx";
import NotePicker from "../office/NotePicker.tsx";
import SheetRangePicker from "../office/SheetRangePicker.tsx";
import { useEditorHistory } from "../office/useEditorHistory.ts";
import { SHAPES } from "./shapes.ts";
import SlideCanvas, { textStyle } from "./SlideCanvas.tsx";
import SlideShow from "./SlideShow.tsx";
import { fitScale, HANDLES, resizeRect, snapToCenter, STAGE_WIDTH, type Handle, type Rect } from "./stage.ts";

const THUMB_WIDTH = 160;
const THUMB_SCALE = THUMB_WIDTH / STAGE_WIDTH;
const NUDGE = 4;
const NUDGE_LARGE = 20;
const SNAP_PIXELS = 6;
const NOTES_DELAY_MS = 300;
const LAYOUTS: { id: string; label: string }[] = [
    { id: "title", label: "標題投影片" },
    { id: "content", label: "標題與內容" },
    { id: "two", label: "兩欄內容" },
    { id: "blank", label: "空白" },
];
const FONT_SIZES = [14, 18, 20, 24, 28, 32, 36, 44, 54, 64, 80, 96];
const PALETTE = ["#1f2328", "#57606a", "#ffffff", "#4f5bd5", "#2a78d6", "#1baf7a", "#eda100", "#eb6834", "#e34948", "#f6f5f2"];

interface SlidesEditorProps {
    noteID: string;
    onChanged: () => void;
    onError: (error: unknown) => void;
}

type Popover = "layouts" | "shapes" | "fill" | "stroke" | "color" | "background" | null;
type Embed = "cells" | "chart" | "image" | null;

function Swatches({ allowNone, onPick }: { allowNone?: boolean; onPick: (color: string) => void }) {
    return (
        <div className="slides-popover slides-swatches">
            {allowNone && <button title="無" onClick={() => onPick("")}>∅</button>}
            {PALETTE.map((color) => (
                <button key={color} title={color} style={{ background: color }} onClick={() => onPick(color)} />
            ))}
        </div>
    );
}

/** 左邊縮圖、中間畫面、下面講者備忘稿。物件的位置在拖曳時只改畫面，放開才寫回 Rust。 */
function SlidesEditor({ noteID, onChanged, onError }: SlidesEditorProps) {
    const [state, setState] = useState<SlidesState | null>(null);
    const [slideID, setSlideID] = useState<string | null>(null);
    const [selected, setSelected] = useState<string[]>([]);
    const [editingID, setEditingID] = useState<string | null>(null);
    const [draft, setDraft] = useState("");
    const [popover, setPopover] = useState<Popover>(null);
    const [embed, setEmbed] = useState<Embed>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
    const [preview, setPreview] = useState<Record<string, Rect>>({});
    const [playing, setPlaying] = useState<number | null>(null);
    const [images, setImages] = useState<Map<string, Note>>(new Map());
    const [stageBox, setStageBox] = useState({ w: 800, h: 450 });
    const [dropAt, setDropAt] = useState<number | null>(null);
    const [notes, setNotes] = useState("");

    const stage = useRef<HTMLDivElement>(null);
    const notesTimer = useRef<number | undefined>(undefined);
    const stageFocus = useRef<HTMLDivElement>(null);

    const load = useCallback(() => {
        api.getSlides(noteID)
            .then((next) => {
                setState(next);
                setSlideID((current) => (next.slides.some((slide) => slide.id === current) ? current : next.slides[0]?.id ?? null));
            })
            .catch(onError);
    }, [noteID, onError]);

    useEffect(load, [load]);

    useEffect(() => {
        api.getNoteLibrary()
            .then((all) => setImages(new Map(all.filter((note) => note.type === "image").map((note) => [note.id, note]))))
            .catch(onError);
    }, [onError, embed]);

    useEffect(() => {
        const element = stage.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => {
            setStageBox({ w: entry.contentRect.width, h: entry.contentRect.height });
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [state === null]);

    const apply = useCallback((op: SlidesOp) => {
        return api.editSlides(noteID, op)
            .then((edit) => {
                setState(edit.state);
                onChanged();
                return edit;
            })
            .catch((error: unknown) => {
                onError(error);
                return null;
            });
    }, [noteID, onChanged, onError]);

    const history = useEditorHistory(noteID, () => {
        load();
        onChanged();
    }, () => undefined, onError);

    const slide = useMemo(() => state?.slides.find((item) => item.id === slideID) ?? null, [state, slideID]);
    const slideIndex = state && slide ? state.slides.indexOf(slide) : 0;
    const scale = fitScale(stageBox.w - 32, stageBox.h - 32);
    const picked = useMemo(() => slide?.elements.filter((element) => selected.includes(element.id)) ?? [], [slide, selected]);
    const first = picked[0] ?? null;
    const editing = slide?.elements.find((element) => element.id === editingID) ?? null;

    useEffect(() => {
        setSelected([]);
        setEditingID(null);
        setNotes(slide?.notes ?? "");
    }, [slideID]);

    // 復原之後備忘稿也要跟著。
    useEffect(() => {
        if (document.activeElement?.className !== "slides-notes") setNotes(slide?.notes ?? "");
    }, [slide?.notes]);

    const patchPicked = (patch: ElementPatch) => {
        setPopover(null);
        for (const element of picked) void apply({ op: "patchElement", id: element.id, patch });
    };

    const commitText = useCallback(() => {
        if (!editingID) return;
        const id = editingID;
        setEditingID(null);
        void apply({ op: "patchElement", id, patch: { text: draft } });
        stageFocus.current?.focus();
    }, [editingID, draft, apply]);

    const startText = (element: SlideElement) => {
        if (element.kind !== "text" && element.kind !== "shape") return;
        setSelected([element.id]);
        setDraft(element.text);
        setEditingID(element.id);
    };

    const addSlide = (layout: string) => {
        setPopover(null);
        void apply({ op: "addSlide", after: slideID, layout }).then((edit) => {
            if (edit?.created) setSlideID(edit.created);
        });
    };

    const addElement = (kind: string, extra: { shape?: string; target?: string; source?: CellRange } = {}) => {
        if (!slideID) return;
        setPopover(null);
        setEmbed(null);
        void apply({ op: "addElement", slideId: slideID, kind, ...extra }).then((edit) => {
            if (!edit?.created) return;
            setSelected([edit.created]);
            if (kind === "text") {
                setDraft("");
                setEditingID(edit.created);
            } else {
                // 焦點留在工具列時，方向鍵與 Delete 到不了畫面，Esc 還會關掉整個編輯器。
                stageFocus.current?.focus();
            }
        });
    };

    const deletePicked = () => {
        const ids = picked.map((element) => element.id);
        setSelected([]);
        if (ids.length) void apply({ op: "deleteElements", ids });
    };

    const nudge = (dx: number, dy: number) => {
        void apply({ op: "moveElements", moves: picked.map((element) => ({ id: element.id, x: element.x + dx, y: element.y + dy })) });
    };

    const onStageKey = (evt: KeyboardEvent) => {
        if (editingID || (evt.target as HTMLElement).closest("input, textarea, select")) return;
        if (history(evt)) return;
        if (picked.length === 0) {
            if (evt.key === "ArrowDown" || evt.key === "PageDown") {
                evt.preventDefault();
                setSlideID(state?.slides[slideIndex + 1]?.id ?? slideID);
            }
            if (evt.key === "ArrowUp" || evt.key === "PageUp") {
                evt.preventDefault();
                setSlideID(state?.slides[slideIndex - 1]?.id ?? slideID);
            }
            return;
        }
        const step = evt.shiftKey ? NUDGE_LARGE : NUDGE;
        const moves: Record<string, [number, number]> = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] };
        if (evt.key in moves) {
            evt.preventDefault();
            nudge(moves[evt.key][0], moves[evt.key][1]);
        } else if (evt.key === "Delete" || evt.key === "Backspace") {
            evt.preventDefault();
            deletePicked();
        } else if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "d") {
            evt.preventDefault();
            void apply({ op: "duplicateElements", ids: picked.map((element) => element.id) }).then((edit) => {
                if (edit?.created) setSelected([edit.created]);
            });
        } else if (evt.key === "Escape") {
            evt.preventDefault();
            setSelected([]);
        } else if (evt.key === "Enter" && first) {
            evt.preventDefault();
            startText(first);
        }
    };

    const dragElements = (evt: ReactPointerEvent, element: SlideElement) => {
        if (evt.button !== 0 || editingID === element.id) return;
        evt.stopPropagation();
        evt.preventDefault();
        if (editingID) commitText();
        stageFocus.current?.focus();
        const ids = selected.includes(element.id)
            ? selected
            : evt.shiftKey ? [...selected, element.id] : [element.id];
        setSelected(ids);
        const items = slide?.elements.filter((item) => ids.includes(item.id)) ?? [];
        const origin = { x: evt.clientX, y: evt.clientY };
        let latest: Record<string, Rect> = {};
        const onMove = (move: PointerEvent) => {
            const dx = (move.clientX - origin.x) / scale;
            const dy = (move.clientY - origin.y) / scale;
            if (Math.hypot(dx, dy) * scale < 3) return;
            latest = Object.fromEntries(items.map((item) => {
                const rect = { x: item.x + dx, y: item.y + dy, w: item.w, h: item.h };
                return [item.id, items.length === 1 ? snapToCenter(rect, SNAP_PIXELS / scale) : rect];
            }));
            setPreview(latest);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            const moves = Object.entries(latest).map(([id, rect]) => ({ id, x: rect.x, y: rect.y }));
            if (moves.length === 0) return;
            void apply({ op: "moveElements", moves }).then(() => setPreview({}));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const dragHandle = (evt: ReactPointerEvent, element: SlideElement, handle: Handle) => {
        evt.stopPropagation();
        evt.preventDefault();
        const origin = { x: evt.clientX, y: evt.clientY };
        const rect = { x: element.x, y: element.y, w: element.w, h: element.h };
        let latest = rect;
        const onMove = (move: PointerEvent) => {
            latest = resizeRect(rect, handle, (move.clientX - origin.x) / scale, (move.clientY - origin.y) / scale);
            setPreview({ [element.id]: latest });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            void apply({ op: "patchElement", id: element.id, patch: latest }).then(() => setPreview({}));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const elementMenu = (evt: { clientX: number; clientY: number }, element: SlideElement) => {
        setMenu({
            x: evt.clientX,
            y: evt.clientY,
            items: [
                { label: "移到最上層", onSelect: () => void apply({ op: "orderElement", id: element.id, front: true }) },
                { label: "移到最下層", onSelect: () => void apply({ op: "orderElement", id: element.id, front: false }) },
                { label: "複製", onSelect: () => void apply({ op: "duplicateElements", ids: [element.id] }) },
                { label: "刪除", onSelect: () => void apply({ op: "deleteElements", ids: [element.id] }) },
            ],
        });
    };

    const slideMenu = (evt: { clientX: number; clientY: number }, id: string) => {
        setMenu({
            x: evt.clientX,
            y: evt.clientY,
            items: [
                { label: "複製投影片", onSelect: () => void apply({ op: "duplicateSlide", id }).then((edit) => edit?.created && setSlideID(edit.created)) },
                {
                    label: "刪除投影片",
                    disabledReason: (state?.slides.length ?? 0) < 2 ? "至少要留一張投影片" : undefined,
                    onSelect: () => void apply({ op: "deleteSlide", id }),
                },
                { label: "從這張開始放映", onSelect: () => setPlaying(state?.slides.findIndex((item) => item.id === id) ?? 0) },
            ],
        });
    };

    /** 用指標事件拖曳縮圖，Tauri 在 Windows 會攔截 HTML5 拖放。 */
    const dragThumb = (evt: ReactPointerEvent, id: string) => {
        if (evt.button !== 0 || !state) return;
        setSlideID(id);
        const list = (evt.currentTarget as HTMLElement).parentElement;
        const startY = evt.clientY;
        let target: number | null = null;
        const onMove = (move: PointerEvent) => {
            if (Math.abs(move.clientY - startY) < 6 || !list) return;
            const items = [...list.querySelectorAll<HTMLElement>(".slides-thumb")];
            const at = items.findIndex((item) => {
                const box = item.getBoundingClientRect();
                return move.clientY < box.top + box.height / 2;
            });
            target = at === -1 ? items.length : at;
            setDropAt(target);
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setDropAt(null);
            if (target === null) return;
            const before = state.slides[target]?.id ?? null;
            if (before !== id) void apply({ op: "moveSlide", id, before });
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!state || !slide) return <div className="slides-editor" />;

    const shown = { ...slide, elements: slide.elements.map((element) => ({ ...element, ...preview[element.id] })) };
    const textual = first && (first.kind === "text" || first.kind === "shape" || first.kind === "cells");
    const closePopover = (next: Popover) => setPopover(popover === next ? null : next);

    return (
        <div className="slides-editor" onPointerDown={(evt) => {
            if (!(evt.target as Element).closest(".slides-popover, .slides-toolbar button")) setPopover(null);
        }}>
            <div className="slides-header">
                <DocumentTitle noteID={noteID} placeholder="未命名簡報" className="sheet-title" onChanged={onChanged} onError={onError} />
                <button className="open-button slides-play" onClick={() => setPlaying(slideIndex)}>▶ 放映</button>
            </div>
            <div className="slides-toolbar note-format-bar">
                <div className="sheet-popover-host">
                    <button aria-expanded={popover === "layouts"} onClick={() => closePopover("layouts")}>新增投影片 ▾</button>
                    {popover === "layouts" && (
                        <div className="slides-popover">
                            {LAYOUTS.map(({ id, label }) => <button key={id} onClick={() => addSlide(id)}>{label}</button>)}
                        </div>
                    )}
                </div>
                <span className="note-format-divider" />
                <button onClick={() => addElement("text")}>文字</button>
                <div className="sheet-popover-host">
                    <button aria-expanded={popover === "shapes"} onClick={() => closePopover("shapes")}>形狀 ▾</button>
                    {popover === "shapes" && (
                        <div className="slides-popover">
                            {SHAPES.map(({ id, label }) => <button key={id} onClick={() => addElement("shape", { shape: id })}>{label}</button>)}
                        </div>
                    )}
                </div>
                <button onClick={() => setEmbed("image")}>圖片</button>
                <button onClick={() => setEmbed("chart")}>圖表</button>
                <button onClick={() => setEmbed("cells")}>引入格子</button>
                <span className="note-format-divider" />
                <div className="sheet-popover-host">
                    <button aria-expanded={popover === "background"} onClick={() => closePopover("background")}>背景 ▾</button>
                    {popover === "background" && (
                        <div className="slides-popover">
                            <Swatches onPick={(color) => {
                                setPopover(null);
                                void apply({ op: "patchSlide", id: slide.id, background: color });
                            }} />
                            <button onClick={() => {
                                setPopover(null);
                                void apply({ op: "patchSlide", id: slide.id, background: slide.background, all: true });
                            }}>套用到全部投影片</button>
                        </div>
                    )}
                </div>
                {textual && (
                    <>
                        <span className="note-format-divider" />
                        <select aria-label="字級" value={first.fontSize} onChange={(evt) => patchPicked({ fontSize: Number(evt.target.value) })}>
                            {[...new Set([...FONT_SIZES, first.fontSize])].sort((a, b) => a - b).map((size) => <option key={size} value={size}>{size}</option>)}
                        </select>
                        {first.kind !== "cells" && (
                            <>
                                <button aria-pressed={first.bold} title="粗體" onClick={() => patchPicked({ bold: !first.bold })}><b>B</b></button>
                                <button aria-pressed={first.italic} title="斜體" onClick={() => patchPicked({ italic: !first.italic })}><i>I</i></button>
                                {(["left", "center", "right"] as const).map((align, index) => (
                                    <button key={align} aria-pressed={(first.align ?? "left") === align} title={["靠左", "置中", "靠右"][index]} onClick={() => patchPicked({ align })}>
                                        {["⇤", "↔", "⇥"][index]}
                                    </button>
                                ))}
                                <button aria-pressed={first.bullets} title="項目符號" onClick={() => patchPicked({ bullets: !first.bullets })}>•≡</button>
                                <div className="sheet-popover-host">
                                    <button aria-expanded={popover === "color"} onClick={() => closePopover("color")}>文字色 ▾</button>
                                    {popover === "color" && <Swatches onPick={(color) => patchPicked({ color })} />}
                                </div>
                            </>
                        )}
                    </>
                )}
                {first?.kind === "shape" && (
                    <>
                        <div className="sheet-popover-host">
                            <button aria-expanded={popover === "fill"} onClick={() => closePopover("fill")}>填色 ▾</button>
                            {popover === "fill" && <Swatches allowNone onPick={(fill) => patchPicked({ fill })} />}
                        </div>
                        <div className="sheet-popover-host">
                            <button aria-expanded={popover === "stroke"} onClick={() => closePopover("stroke")}>外框 ▾</button>
                            {popover === "stroke" && <Swatches allowNone onPick={(stroke) => patchPicked({ stroke })} />}
                        </div>
                    </>
                )}
            </div>
            <div className="slides-body">
                <div className="slides-thumbs" role="listbox" aria-label="投影片">
                    {state.slides.map((item, index) => (
                        <div key={item.id} className="slides-thumb-row">
                            {dropAt === index && <div className="slides-drop" />}
                            <div
                                className="slides-thumb"
                                role="option"
                                aria-selected={item.id === slideID}
                                onPointerDown={(evt) => dragThumb(evt, item.id)}
                                onContextMenu={(evt) => {
                                    evt.preventDefault();
                                    slideMenu(evt, item.id);
                                }}
                            >
                                <span className="slides-thumb-number">{index + 1}</span>
                                <SlideCanvas slide={item} scale={THUMB_SCALE} images={images} onError={onError} />
                            </div>
                        </div>
                    ))}
                    {dropAt === state.slides.length && <div className="slides-drop" />}
                </div>
                <div className="slides-main">
                    <div
                        ref={(element) => {
                            stage.current = element;
                            stageFocus.current = element;
                        }}
                        className="slides-stage-host"
                        tabIndex={0}
                        onKeyDown={onStageKey}
                        onPointerDown={() => {
                            if (editingID) commitText();
                            setSelected([]);
                            stageFocus.current?.focus();
                        }}
                    >
                        <SlideCanvas
                            slide={shown}
                            scale={scale}
                            images={images}
                            showPlaceholders
                            editingID={editingID}
                            onError={onError}
                            elementProps={(element) => ({
                                "data-selected": selected.includes(element.id),
                                onPointerDown: (evt: ReactPointerEvent) => dragElements(evt, element),
                                onDoubleClick: () => startText(element),
                                onContextMenu: (evt: React.MouseEvent) => {
                                    evt.preventDefault();
                                    evt.stopPropagation();
                                    if (!selected.includes(element.id)) setSelected([element.id]);
                                    elementMenu(evt, element);
                                },
                            })}
                            overlay={(
                                <>
                                    {shown.elements.filter((element) => selected.includes(element.id)).map((element) => (
                                        <div key={element.id} className="slide-selection" style={{ left: element.x, top: element.y, width: element.w, height: element.h, outlineWidth: 2 / scale }}>
                                            {selected.length === 1 && editingID !== element.id && HANDLES.map((handle) => (
                                                <span
                                                    key={handle}
                                                    className="slide-handle"
                                                    data-handle={handle}
                                                    style={{ width: 10 / scale, height: 10 / scale, margin: -5 / scale }}
                                                    onPointerDown={(evt) => dragHandle(evt, element, handle)}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                    {editing && (
                                        <textarea
                                            className="slide-text-input"
                                            autoFocus
                                            aria-label="投影片文字"
                                            placeholder={editing.placeholder ?? ""}
                                            value={draft}
                                            style={{ ...textStyle(editing), left: editing.x, top: editing.y, width: editing.w, height: editing.h, color: editing.color ?? undefined }}
                                            onChange={(evt) => setDraft(evt.target.value)}
                                            onBlur={commitText}
                                            onPointerDown={(evt) => evt.stopPropagation()}
                                            onKeyDown={(evt) => {
                                                evt.stopPropagation();
                                                if (evt.nativeEvent.isComposing) return;
                                                if (evt.key === "Escape") {
                                                    evt.preventDefault();
                                                    commitText();
                                                }
                                            }}
                                        />
                                    )}
                                </>
                            )}
                        />
                    </div>
                    <textarea
                        className="slides-notes"
                        aria-label="講者備忘稿"
                        placeholder="按一下輸入講者備忘稿"
                        value={notes}
                        onChange={(evt) => {
                            const next = evt.target.value;
                            setNotes(next);
                            window.clearTimeout(notesTimer.current);
                            const id = slide.id;
                            notesTimer.current = window.setTimeout(() => void apply({ op: "patchSlide", id, notes: next }), NOTES_DELAY_MS);
                        }}
                    />
                </div>
            </div>
            {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
            {embed === "cells" && (
                <SheetRangePicker
                    onPick={(source) => addElement("cells", { source })}
                    onCancel={() => setEmbed(null)}
                    onError={onError}
                />
            )}
            {(embed === "chart" || embed === "image") && (
                <NotePicker
                    type={embed}
                    onPick={(note) => addElement(embed, { target: note.id })}
                    onCancel={() => setEmbed(null)}
                    onError={onError}
                />
            )}
            {playing !== null && (
                <SlideShow slides={state.slides} start={playing} images={images} onClose={() => setPlaying(null)} onError={onError} />
            )}
        </div>
    );
}

export default SlidesEditor;
