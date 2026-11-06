import type { SyntheticEvent } from "react";

const stop = (evt: SyntheticEvent) => evt.stopPropagation();

interface FullscreenButtonProps {
    onOpen: () => void;
}

/** 疊在卡片上；事件不往外傳，按它不算點選或拖曳卡片。 */
function FullscreenButton({ onOpen }: FullscreenButtonProps) {
    return (
        <button
            className="card-action-button"
            onPointerDown={stop}
            onDoubleClick={stop}
            onKeyDown={stop}
            onClick={(evt) => {
                evt.stopPropagation();
                onOpen();
            }}
        >
            全螢幕
        </button>
    );
}

export default FullscreenButton;
