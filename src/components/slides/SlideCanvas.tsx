import type { CSSProperties, ReactNode } from "react";
import { imageInfo, mediaUrl } from "../../media.ts";
import type { Note, Slide, SlideElement } from "../../types.ts";
import PlacedCard from "../cards/PlacedCard.tsx";
import ChartView from "../chart/ChartView.tsx";
import CellsView from "../office/CellsView.tsx";
import { shapePath } from "./shapes.ts";
import { STAGE_HEIGHT, STAGE_WIDTH } from "./stage.ts";

interface SlideCanvasProps {
    slide: Slide;
    scale: number;
    images: Map<string, Note>;
    /** 放映與縮圖不顯示「按兩下輸入」的提示。 */
    showPlaceholders?: boolean;
    /** 這個物件正在編輯文字，內容由編輯框顯示。 */
    editingID?: string | null;
    /** 放在投影片上的卡片要跟著更新。 */
    cardRevision?: number;
    /** 這個物件的 Note 正在投影片上編輯。 */
    editingNote?: { elementID: string; render: (noteID: string) => ReactNode } | null;
    onError: (error: unknown) => void;
    /** 放在每個物件上，編輯器用來接收拖曳。 */
    elementProps?: (element: SlideElement) => Record<string, unknown>;
    overlay?: ReactNode;
}

const JUSTIFY: Record<string, CSSProperties["justifyContent"]> = { middle: "center", bottom: "flex-end" };

export function textStyle(element: SlideElement): CSSProperties {
    return {
        fontSize: element.fontSize,
        fontWeight: element.bold ? 700 : 400,
        fontStyle: element.italic ? "italic" : "normal",
        color: element.color ?? undefined,
        textAlign: (element.align ?? "left") as CSSProperties["textAlign"],
        lineHeight: 1.3,
    };
}

function TextContent({ element, showPlaceholders, hidden }: { element: SlideElement; showPlaceholders: boolean; hidden: boolean }) {
    if (hidden) return null;
    const empty = !element.text;
    const text = empty && showPlaceholders ? element.placeholder ?? "" : element.text;
    if (!text) return null;
    const lines = text.split("\n");
    return (
        <div className="slide-text" data-placeholder={empty} style={textStyle(element)}>
            {element.bullets && !empty
                ? <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
                : text}
        </div>
    );
}

function ElementBody({ element, images, showPlaceholders, editing, cardRevision, renderNote, onError }: {
    element: SlideElement;
    images: Map<string, Note>;
    showPlaceholders: boolean;
    editing: boolean;
    cardRevision?: number;
    renderNote?: (noteID: string) => ReactNode;
    onError: (error: unknown) => void;
}) {
    const { w, h } = element;
    switch (element.kind) {
        case "shape":
            return (
                <>
                    <svg className="slide-shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
                        <path
                            d={shapePath(element.shape ?? "rect", 1, 1, Math.max(w - 2, 1), Math.max(h - 2, 1))}
                            fill={element.shape === "line" ? "none" : element.fill || "none"}
                            stroke={element.stroke || (element.shape === "line" ? element.fill || "#1f2328" : "none")}
                            strokeWidth={element.shape === "line" ? 4 : 2}
                        />
                    </svg>
                    <TextContent element={element} showPlaceholders={false} hidden={editing} />
                </>
            );
        case "image": {
            const note = element.noteId ? images.get(element.noteId) : undefined;
            const info = note ? imageInfo(note) : null;
            return info
                ? <img src={mediaUrl(info.file)} alt={info.name} draggable={false} />
                : <p className="cells-error">圖片已被刪除</p>;
        }
        case "chart":
            return element.noteId ? <ChartView noteID={element.noteId} onError={onError} /> : null;
        case "card":
            return element.noteId ? <PlacedCard noteID={element.noteId} revision={cardRevision} renderNote={renderNote} onError={onError} /> : null;
        case "cells":
            return element.source ? <CellsView source={element.source} fontSize={element.fontSize} onError={onError} /> : null;
        default:
            return <TextContent element={element} showPlaceholders={showPlaceholders} hidden={editing} />;
    }
}

/** 一張投影片。編輯器、縮圖與放映都用它，畫面才會完全一樣。 */
function SlideCanvas({ slide, scale, images, showPlaceholders = false, editingID, cardRevision, editingNote, onError, elementProps, overlay }: SlideCanvasProps) {
    return (
        <div className="slide-frame" style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
            <div
                className="slide-stage"
                style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, background: slide.background, transform: `scale(${scale})` }}
            >
                {slide.elements.map((element) => (
                    <div
                        key={element.id}
                        className="slide-element"
                        data-kind={element.kind}
                        style={{
                            left: element.x,
                            top: element.y,
                            width: element.w,
                            height: element.h,
                            justifyContent: JUSTIFY[element.valign ?? ""] ?? "flex-start",
                        }}
                        {...elementProps?.(element)}
                    >
                        <ElementBody
                            element={element}
                            images={images}
                            showPlaceholders={showPlaceholders}
                            editing={editingID === element.id}
                            cardRevision={cardRevision}
                            renderNote={editingNote?.elementID === element.id ? editingNote.render : undefined}
                            onError={onError}
                        />
                    </div>
                ))}
                {overlay}
            </div>
        </div>
    );
}

export default SlideCanvas;
