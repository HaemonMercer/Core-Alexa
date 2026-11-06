import { useEffect, useRef, type CSSProperties } from "react";

interface WhiteboardNameInputProps {
    className: string;
    /** 輸入框的無障礙名稱，預設是白板名稱。 */
    ariaLabel?: string;
    /** 允許清空，例如箭頭可以沒有標籤；白板一定要有名稱。 */
    allowEmpty?: boolean;
    name: string;
    style?: CSSProperties;
    /** 只有名稱真的改變時才呼叫。 */
    onSubmit: (name: string) => void;
    onCancel: () => void;
}

function WhiteboardNameInput({
    className, ariaLabel = "白板名稱", allowEmpty = false, name, style, onSubmit, onCancel,
}: WhiteboardNameInputProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    // 按 Enter 或 Esc 關閉時輸入框也會失焦，只處理第一次。
    const closedRef = useRef(false);

    useEffect(() => {
        inputRef.current?.select();
    }, []);

    const close = (submit: boolean) => {
        if (closedRef.current) return;
        closedRef.current = true;
        const next = inputRef.current?.value.trim() ?? "";
        if (submit && (next || allowEmpty) && next !== name) onSubmit(next);
        else onCancel();
    };

    return (
        <input
            ref={inputRef}
            className={className}
            aria-label={ariaLabel}
            defaultValue={name}
            style={style}
            onBlur={() => close(true)}
            onKeyDown={(evt) => {
                // 中文輸入法選字時的 Enter 不算送出。
                if (evt.nativeEvent.isComposing) return;
                if (evt.key === "Enter") close(true);
                else if (evt.key === "Escape") close(false);
            }}
        />
    );
}

export default WhiteboardNameInput;
