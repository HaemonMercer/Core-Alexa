import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Note, Slide } from "../../types.ts";
import SlideCanvas from "./SlideCanvas.tsx";
import { fitScale } from "./stage.ts";

interface SlideShowProps {
    slides: Slide[];
    start: number;
    images: Map<string, Note>;
    onClose: () => void;
    onError: (error: unknown) => void;
}

/** 放映蓋住整個視窗。右鍵、Esc 離開，方向鍵、空白鍵或點一下換頁，最後一張之後結束。 */
function SlideShow({ slides, start, images, onClose, onError }: SlideShowProps) {
    const [index, setIndex] = useState(start);
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

    useEffect(() => {
        const next = () => setIndex((current) => {
            if (current + 1 >= slides.length) {
                onClose();
                return current;
            }
            return current + 1;
        });
        const previous = () => setIndex((current) => Math.max(current - 1, 0));
        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key === "Escape") {
                // 全螢幕卡片也聽 Esc，這裡先處理掉，只離開放映。
                evt.preventDefault();
                evt.stopPropagation();
                onClose();
            } else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(evt.key)) {
                evt.preventDefault();
                next();
            } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(evt.key)) {
                evt.preventDefault();
                previous();
            } else if (evt.key === "Home") {
                setIndex(0);
            } else if (evt.key === "End") {
                setIndex(slides.length - 1);
            }
        };
        const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("resize", onResize);
        };
    }, [slides.length, onClose]);

    const slide = slides[Math.min(index, slides.length - 1)];
    return createPortal(
        <div
            className="slide-show"
            role="dialog"
            aria-label="放映"
            onClick={() => (index + 1 >= slides.length ? onClose() : setIndex(index + 1))}
            onContextMenu={(evt) => {
                evt.preventDefault();
                onClose();
            }}
        >
            <SlideCanvas key={slide.id} slide={slide} scale={fitScale(size.w, size.h)} images={images} onError={onError} />
            <span className="slide-show-count">{index + 1} / {slides.length}</span>
        </div>,
        document.body,
    );
}

export default SlideShow;
