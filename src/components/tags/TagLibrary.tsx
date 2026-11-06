import { useCallback, useEffect, useState } from "react";
import * as api from "../../api.ts";
import type { Note, TagInfo } from "../../types.ts";
import FullscreenButton from "../cards/FullscreenButton.tsx";
import NoteSummary from "../cards/NoteSummary.tsx";
import ConfirmDialog from "../common/ConfirmDialog.tsx";
import ContextMenu from "../common/ContextMenu.tsx";
import EditableName from "../whiteboards/EditableName.tsx";
import { NoteTags } from "./TagChip.tsx";
import { TAG_COLORS, tagStyle } from "./tagColors.ts";
import { filterByTags } from "./tagRules.ts";

interface TagLibraryProps {
    cardsRevision: number;
    selectedID: string | null;
    onSelect: (id: string) => void;
    onOpenFullscreen: (id: string) => void;
    /** Tag 改變，用到它的清單和白板要重新讀取。 */
    onChanged: () => void;
    onError: (error: unknown) => void;
}

/** 管理所有 Tag：看每個 Tag 底下的內容，改名、換色、刪除。卡片和 Office 文件都列在這裡。 */
function TagLibrary({ cardsRevision, selectedID, onSelect, onOpenFullscreen, onChanged, onError }: TagLibraryProps) {
    const [tags, setTags] = useState<TagInfo[] | null>(null);
    const [notes, setNotes] = useState<Note[]>([]);
    const [chosenID, setChosenID] = useState<string | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; tag: TagInfo } | null>(null);
    const [deleting, setDeleting] = useState<TagInfo | null>(null);
    const closeMenu = useCallback(() => setMenu(null), []);

    useEffect(() => {
        let cancelled = false;
        Promise.all([api.getTags(), api.getNoteLibrary()])
            .then(([nextTags, nextNotes]) => {
                if (cancelled) return;
                setTags(nextTags);
                setNotes(nextNotes);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [cardsRevision, onError]);

    // 選到的 Tag 被刪除時換到第一個。
    const chosen = tags?.find((tag) => tag.id === chosenID) ?? tags?.[0] ?? null;
    const tagged = chosen ? filterByTags(notes, [chosen.id]) : [];

    return (
        <section className="library">
            <h1>Tag Library</h1>
            {tags?.length === 0 && (
                <p className="library-empty">還沒有 Tag。在右側面板打開卡片，就能在內容上方加上 Tag。</p>
            )}
            <div className="type-filter" role="group" aria-label="選擇 Tag">
                {tags?.map((tag) => (
                    <button
                        key={tag.id}
                        aria-pressed={tag.id === chosen?.id}
                        onClick={() => setChosenID(tag.id)}
                        onContextMenu={(evt) => {
                            evt.preventDefault();
                            setMenu({ x: evt.clientX, y: evt.clientY, tag });
                        }}
                    >
                        <span className="tag-dot" style={tagStyle(tag.color)} />
                        {tag.name}
                        <span className="tag-count">{tag.count}</span>
                    </button>
                ))}
            </div>
            {chosen && (
                <div className="tag-detail">
                    <EditableName
                        key={chosen.id}
                        name={chosen.name}
                        onRename={(name) => api.renameTag(chosen.id, name).then(onChanged).catch(onError)}
                    />
                    <div className="tag-swatches" role="group" aria-label="Tag 顏色">
                        {TAG_COLORS.map((color) => (
                            <button
                                key={color.name}
                                className="tag-swatch"
                                style={tagStyle(color.name)}
                                aria-label={color.label}
                                aria-pressed={chosen.color === color.name}
                                title={color.label}
                                onClick={() => api.setTagColor(chosen.id, color.name).then(onChanged).catch(onError)}
                            />
                        ))}
                    </div>
                </div>
            )}
            {chosen && tagged.length === 0 && <p className="library-empty">沒有內容用這個 Tag。</p>}
            <ul className="card-grid">
                {tagged.map((note) => (
                    <li
                        key={note.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={note.id === selectedID}
                        onClick={(evt) => {
                            // 預覽裡的連結不能把整個 App 帶離開。
                            evt.preventDefault();
                            onSelect(note.id);
                        }}
                        onDoubleClick={() => onOpenFullscreen(note.id)}
                        onKeyDown={(evt) => {
                            if (evt.key === "Enter") onSelect(note.id);
                        }}
                    >
                        <NoteSummary note={note} />
                        <NoteTags note={note} />
                        <FullscreenButton onOpen={() => onOpenFullscreen(note.id)} />
                    </li>
                ))}
            </ul>
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    items={[{ label: "刪除 Tag", onSelect: () => setDeleting(menu.tag) }]}
                    onClose={closeMenu}
                />
            )}
            {deleting && (
                <ConfirmDialog
                    title={`刪除 Tag「${deleting.name}」？`}
                    detail={`${deleting.count > 0 ? `會從 ${deleting.count} 筆內容移除，內容本身不會刪除。` : ""}這個動作無法復原。`}
                    onConfirm={() => {
                        const { id } = deleting;
                        setDeleting(null);
                        api.deleteTag(id).then(onChanged).catch(onError);
                    }}
                    onCancel={() => setDeleting(null)}
                />
            )}
        </section>
    );
}

export default TagLibrary;
