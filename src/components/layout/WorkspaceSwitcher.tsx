import { useEffect, useRef, useState } from "react";
import * as api from "../../api.ts";
import ConfirmDialog from "../common/ConfirmDialog.tsx";
import ContextMenu from "../common/ContextMenu.tsx";
import type { WorkspaceEntry, WorkspaceList } from "../../types.ts";

interface WorkspaceSwitcherProps {
    /** 切換和新增都會重新啟動，要先存好編輯中的內容。 */
    onBeforeRestart: () => Promise<void>;
}

interface NameInputProps {
    initial: string;
    onSubmit: (name: string) => void;
    onCancel: () => void;
}

function NameInput({ initial, onSubmit, onCancel }: NameInputProps) {
    const [value, setValue] = useState(initial);
    return (
        <input
            className="workspace-input"
            aria-label="Workspace 名稱"
            autoFocus
            value={value}
            onFocus={(evt) => evt.currentTarget.select()}
            onChange={(evt) => setValue(evt.target.value)}
            onKeyDown={(evt) => {
                if (evt.nativeEvent.isComposing) return;
                if (evt.key === "Enter") onSubmit(value);
                if (evt.key === "Escape") {
                    evt.stopPropagation();
                    onCancel();
                }
            }}
        />
    );
}

/** 左側面板最上方的 Workspace 選單。重新命名和刪除在右鍵選單裡。 */
function WorkspaceSwitcher({ onBeforeRestart }: WorkspaceSwitcherProps) {
    const [list, setList] = useState<WorkspaceList | null>(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [creating, setCreating] = useState(false);
    const [renamingID, setRenamingID] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; item: WorkspaceEntry } | null>(null);
    const [deleting, setDeleting] = useState<WorkspaceEntry | null>(null);
    const [error, setError] = useState("");
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        void api.getWorkspaces().then(setList).catch((reason) => setError(String(reason)));
    }, []);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (evt: PointerEvent) => {
            if (!rootRef.current?.contains(evt.target as Node)) close();
        };
        window.addEventListener("pointerdown", onPointerDown);
        return () => window.removeEventListener("pointerdown", onPointerDown);
    }, [open]);

    const close = () => {
        setOpen(false);
        setCreating(false);
        setRenamingID(null);
        setError("");
    };

    /** 成功時程式直接重新啟動，不會回到這裡。 */
    const restartWith = async (action: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await onBeforeRestart();
            await action();
        } catch (reason) {
            setError(String(reason));
            setBusy(false);
        }
    };

    const rename = async (id: string, name: string) => {
        try {
            setList(await api.renameWorkspace(id, name));
            setRenamingID(null);
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    };

    const remove = async (id: string) => {
        setDeleting(null);
        try {
            setList(await api.deleteWorkspace(id));
            setError("");
        } catch (reason) {
            setError(String(reason));
        }
    };

    const active = list?.items.find((item) => item.id === list.activeId);

    return (
        <div className="workspace-switcher" ref={rootRef}>
            <button
                className="workspace-current"
                aria-haspopup="menu"
                aria-expanded={open}
                title={active?.name}
                disabled={busy}
                onClick={() => (open ? close() : setOpen(true))}
            >
                <span>{busy ? "切換中…" : active?.name ?? "讀取中…"}</span>
                <span aria-hidden="true">▾</span>
            </button>
            {open && list && (
                <div className="workspace-menu" role="menu" aria-label="Workspace">
                    {list.items.map((item) => (
                        renamingID === item.id ? (
                            <NameInput
                                key={item.id}
                                initial={item.name}
                                onSubmit={(name) => void rename(item.id, name)}
                                onCancel={() => {
                                    setRenamingID(null);
                                    setError("");
                                }}
                            />
                        ) : (
                            <button
                                key={item.id}
                                className="workspace-menu-item"
                                role="menuitemradio"
                                aria-checked={item.id === list.activeId}
                                title={item.name}
                                disabled={busy}
                                onClick={() => {
                                    if (item.id === list.activeId) close();
                                    else void restartWith(() => api.switchWorkspace(item.id));
                                }}
                                onContextMenu={(evt) => {
                                    evt.preventDefault();
                                    setMenu({ x: evt.clientX, y: evt.clientY, item });
                                }}
                            >
                                {item.name}
                            </button>
                        )
                    ))}
                    {creating ? (
                        <NameInput
                            initial=""
                            onSubmit={(name) => void restartWith(() => api.createWorkspace(name))}
                            onCancel={() => {
                                setCreating(false);
                                setError("");
                            }}
                        />
                    ) : (
                        <button
                            className="workspace-menu-item workspace-menu-add"
                            disabled={busy}
                            onClick={() => setCreating(true)}
                        >
                            + 新增 Workspace
                        </button>
                    )}
                    {error && <p className="workspace-error" role="alert">{error}</p>}
                </div>
            )}
            {menu && list && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    onClose={() => setMenu(null)}
                    items={[
                        { label: "重新命名", onSelect: () => setRenamingID(menu.item.id) },
                        {
                            label: "刪除",
                            disabledReason: menu.item.id === list.activeId
                                ? "請先切換到別的 Workspace"
                                : menu.item.id === list.items[0].id ? "最早的 Workspace 不能刪除" : undefined,
                            onSelect: () => setDeleting(menu.item),
                        },
                    ]}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title={`刪除「${deleting.name}」？`}
                    detail="裡面的白板、卡片、文件、圖片和影片都會永久刪除，無法復原。"
                    onConfirm={() => void remove(deleting.id)}
                    onCancel={() => setDeleting(null)}
                />
            )}
        </div>
    );
}

export default WorkspaceSwitcher;
