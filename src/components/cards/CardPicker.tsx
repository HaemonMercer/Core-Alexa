import { cardTitle } from "../../markdown/noteLink.ts";
import type { CardMatch } from "../../types.ts";

const WIDTH = 260;
const MAX_HEIGHT = 240;
const GAP = 4;
const VIEWPORT_MARGIN = 8;

interface CardPickerProps {
    /** 游標的位置（螢幕座標），選單跟著游標。 */
    caret: DOMRect;
    matches: CardMatch[];
    /** 不是 null 時，最後一個選項是用這段文字建立新卡片。 */
    newTitle: string | null;
    activeIndex: number;
    onActivate: (index: number) => void;
    onPick: (index: number) => void;
}

function CardPicker({ caret, matches, newTitle, activeIndex, onActivate, onPick }: CardPickerProps) {
    const left = Math.min(caret.left, window.innerWidth - WIDTH - VIEWPORT_MARGIN);
    const below = caret.bottom + GAP + MAX_HEIGHT <= window.innerHeight - VIEWPORT_MARGIN;
    const position = below
        ? { top: caret.bottom + GAP }
        : { bottom: window.innerHeight - caret.top + GAP };

    const option = (index: number, title: string, source: string) => (
        <button
            key={index}
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            onMouseEnter={() => onActivate(index)}
            onClick={() => onPick(index)}
        >
            <span className="card-link-title">{title}</span>
            <span className="card-link-source">{source}</span>
        </button>
    );

    return (
        <div
            className="card-picker"
            role="listbox"
            aria-label="連結到卡片"
            style={{ left, width: WIDTH, maxHeight: MAX_HEIGHT, ...position }}
            // 按下時不能搶走編輯區的焦點，否則游標位置會消失。
            onMouseDown={(evt) => evt.preventDefault()}
        >
            {matches.length === 0 && newTitle === null && <p className="library-empty">還沒有其他卡片</p>}
            {matches.map(({ note, whiteboards }, index) =>
                option(index, cardTitle(note.content), whiteboards.join("、") || "Card Library"))}
            {newTitle !== null && option(matches.length, `建立卡片「${newTitle}」`, "只放進 Card Library")}
        </div>
    );
}

export default CardPicker;
