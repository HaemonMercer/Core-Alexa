import { useEffect, useRef } from "react";

interface ConfirmDialogProps {
    title: string;
    detail: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/** 無法復原的操作用這個確認。焦點預設在取消，按 Enter 不會誤刪。 */
function ConfirmDialog({ title, detail, onConfirm, onCancel }: ConfirmDialogProps) {
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        cancelRef.current?.focus();
    }, []);

    return (
        <div
            className="confirm-backdrop"
            onKeyDown={(evt) => {
                if (evt.key !== "Escape") return;
                // 只關閉對話框，不能再傳出去變成取消 Library 的選取。
                evt.stopPropagation();
                onCancel();
            }}
        >
            <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-label={title}>
                <h2>{title}</h2>
                <p>{detail}</p>
                <div className="confirm-actions">
                    <button ref={cancelRef} type="button" className="open-button" onClick={onCancel}>取消</button>
                    <button type="button" className="danger-button" onClick={onConfirm}>刪除</button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmDialog;
