import { useEffect, useRef, useState } from "react";
import type { WriterPage } from "../../types.ts";
import { BAND_SLOTS, NUMBER_FORMATS, NUMBER_PLACES, PAGE_MARGINS, PAGE_SIZES } from "./pageFormat.ts";

/** 紙張縮圖每公釐的像素，大小差異才看得出來。 */
const THUMB_SCALE = 0.12;

interface PageSetupProps {
    page: WriterPage;
    pages: number;
    onChange: (page: WriterPage) => void;
}

interface ChoiceProps<T> {
    label: string;
    options: { value: T; label: string; title?: string }[];
    value: T;
    onPick: (value: T) => void;
}

function Choice<T>({ label, options, value, onPick }: ChoiceProps<T>) {
    return (
        <div className="page-setup-group">
            <span className="page-setup-label">{label}</span>
            <div className="page-setup-segments" role="group" aria-label={label}>
                {options.map((option) => (
                    <button key={option.label} title={option.title} aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
                        {option.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

/** 版面設定：平常只有一顆按鈕，打開才顯示。改動馬上套用，背後的文件就是預覽。 */
function PageSetup({ page, pages, onChange }: PageSetupProps) {
    const [open, setOpen] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        // 文件裡沒有游標時焦點交給面板，Ctrl+Z 才會傳到編輯器。
        if (document.activeElement === document.body) panel.current?.focus();
        const onPointerDown = (evt: PointerEvent) => {
            if (!host.current?.contains(evt.target as Node)) setOpen(false);
        };
        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key !== "Escape" || evt.isComposing) return;
            // 這次 Esc 是關面板，不能連全螢幕一起關掉。
            evt.preventDefault();
            setOpen(false);
        };
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [open]);

    const size = PAGE_SIZES.find((item) => item.id === page.size) ?? PAGE_SIZES[1];

    return (
        <div ref={host} className="page-setup">
            <button
                className="panel-back"
                aria-expanded={open}
                aria-haspopup="dialog"
                onMouseDown={(evt) => evt.preventDefault()}
                onClick={() => setOpen((value) => !value)}
            >
                版面設定
            </button>
            {open && (
                // 按鈕和面板都不搶走焦點，游標才會留在文件裡。
                <div ref={panel} className="page-setup-panel" role="dialog" aria-label="版面設定" tabIndex={-1} onMouseDown={(evt) => evt.preventDefault()}>
                    <div className="page-setup-group">
                        <span className="page-setup-label">紙張</span>
                        <div className="page-setup-sizes" role="group" aria-label="紙張">
                            {PAGE_SIZES.map((item) => {
                                const short = item.width * THUMB_SCALE;
                                const long = item.height * THUMB_SCALE;
                                return (
                                    <button
                                        key={item.id}
                                        title={`${item.width} × ${item.height} mm`}
                                        aria-pressed={item.id === page.size}
                                        onClick={() => onChange({ ...page, size: item.id })}
                                    >
                                        <span className="page-setup-thumb">
                                            <span style={{ width: page.landscape ? long : short, height: page.landscape ? short : long }} />
                                        </span>
                                        {item.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <Choice
                        label="方向"
                        value={page.landscape}
                        options={[{ value: false, label: "直向" }, { value: true, label: "橫向" }]}
                        onPick={(landscape) => onChange({ ...page, landscape })}
                    />
                    <Choice
                        label="邊距"
                        value={page.margin}
                        options={PAGE_MARGINS.map((margin) => ({ value: margin.id, label: margin.label, title: `${margin.size / 10} cm` }))}
                        onPick={(margin) => onChange({ ...page, margin })}
                    />
                    <Choice
                        label="頁碼"
                        value={page.number.place}
                        options={NUMBER_PLACES.map((place) => ({ value: place.id, label: place.label }))}
                        onPick={(place) => onChange({ ...page, number: { ...page.number, place } })}
                    />
                    {page.number.place !== "none" && (
                        <>
                            <Choice
                                label="頁碼位置"
                                value={page.number.align}
                                options={BAND_SLOTS.map((slot) => ({ value: slot.id, label: slot.label }))}
                                onPick={(align) => onChange({ ...page, number: { ...page.number, align } })}
                            />
                            <Choice
                                label="頁碼格式"
                                value={page.number.format}
                                options={NUMBER_FORMATS.map((format) => ({ value: format.id, label: format.label }))}
                                onPick={(format) => onChange({ ...page, number: { ...page.number, format } })}
                            />
                        </>
                    )}
                    <Choice
                        label="第一頁"
                        value={page.skipFirst}
                        options={[{ value: false, label: "顯示頁首頁尾" }, { value: true, label: "不顯示" }]}
                        onPick={(skipFirst) => onChange({ ...page, skipFirst })}
                    />
                    <p className="page-setup-summary">連按兩下紙張上下的留白，可以編輯頁首和頁尾的文字。</p>
                    <p className="page-setup-summary">
                        {page.landscape ? `${size.height} × ${size.width}` : `${size.width} × ${size.height}`} mm，共 {pages} 頁
                    </p>
                </div>
            )}
        </div>
    );
}

export default PageSetup;
