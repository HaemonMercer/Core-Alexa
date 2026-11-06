import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as api from "../../api.ts";
import type { NoteTag, TagInfo } from "../../types.ts";
import { TagChip } from "./TagChip.tsx";
import { tagStyle } from "./tagColors.ts";
import { canCreateTag, tagSuggestions } from "./tagRules.ts";

interface TagBarProps {
    noteID: string;
    /** 內容改變時遞增：Tag 可能在別的面板或 Tag Library 改過。 */
    revision: number;
    /** 貼上或移除之後，Library 和白板要重新讀取。 */
    onChanged: () => void;
    onError: (error: unknown) => void;
}

/** 筆記內容上方的 Tag 列：顯示、移除，輸入時建議既有的 Tag，或建立新的。 */
function TagBar({ noteID, revision, onChanged, onError }: TagBarProps) {
    const [tags, setTags] = useState<NoteTag[]>([]);
    const [all, setAll] = useState<TagInfo[]>([]);
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        api.getNote(noteID)
            .then((note) => {
                if (!cancelled) setTags(note?.tags ?? []);
            })
            .catch(onError);
        return () => {
            cancelled = true;
        };
    }, [noteID, revision, onError]);

    const suggestions = tagSuggestions(all, tags, query);
    const creating = canCreateTag(all, query);
    const optionCount = suggestions.length + (creating ? 1 : 0);
    const highlighted = Math.min(active, optionCount - 1);

    const add = (name: string) => {
        setQuery("");
        setActive(0);
        api.addNoteTag(noteID, name)
            .then((tag) => {
                setTags((current) => (current.some((other) => other.id === tag.id) ? current : [...current, tag]));
                onChanged();
                return api.getTags();
            })
            .then(setAll)
            .catch(onError);
    };

    const remove = (tag: NoteTag) => {
        setTags((current) => current.filter((other) => other.id !== tag.id));
        api.removeNoteTag(noteID, tag.id).then(onChanged).catch(onError);
    };

    const pick = (index: number) => {
        if (index < suggestions.length) add(suggestions[index].name);
        else if (creating) add(query);
    };

    const onKeyDown = (evt: KeyboardEvent<HTMLInputElement>) => {
        // 中文輸入法選字時的按鍵不是給這裡的。
        if (evt.nativeEvent.isComposing) return;
        if (evt.key === "Enter") {
            evt.preventDefault();
            if (open && optionCount > 0) pick(highlighted);
        } else if (evt.key === "ArrowDown" || evt.key === "ArrowUp") {
            evt.preventDefault();
            if (optionCount === 0) return;
            const step = evt.key === "ArrowDown" ? 1 : -1;
            setActive((highlighted + step + optionCount) % optionCount);
        } else if (evt.key === "Backspace" && query === "" && tags.length > 0) {
            remove(tags[tags.length - 1]);
        } else if (evt.key === "Escape") {
            // 只離開輸入框，不能再傳出去變成結束全螢幕。
            evt.preventDefault();
            evt.stopPropagation();
            setQuery("");
            inputRef.current?.blur();
        }
    };

    return (
        <div className="tag-bar" aria-label="Tag">
            {tags.map((tag) => (
                <TagChip key={tag.id} tag={tag}>
                    <button
                        type="button"
                        className="tag-chip-remove"
                        aria-label={`移除 Tag ${tag.name}`}
                        title="移除"
                        onClick={() => remove(tag)}
                    >
                        ×
                    </button>
                </TagChip>
            ))}
            <div className="tag-input">
                <input
                    ref={inputRef}
                    aria-label="新增 Tag"
                    placeholder="+ Tag"
                    value={query}
                    onChange={(evt) => {
                        setQuery(evt.target.value);
                        setActive(0);
                        setOpen(true);
                    }}
                    onFocus={() => {
                        setOpen(true);
                        api.getTags().then(setAll).catch(onError);
                    }}
                    onBlur={() => setOpen(false)}
                    onKeyDown={onKeyDown}
                />
                {open && optionCount > 0 && (
                    <ul className="tag-options" role="listbox">
                        {suggestions.map((tag, index) => (
                            <li
                                key={tag.id}
                                role="option"
                                aria-selected={index === highlighted}
                                // 按下時不能讓輸入框失焦，選單才不會在點到之前就關掉。
                                onPointerDown={(evt) => evt.preventDefault()}
                                onClick={() => pick(index)}
                            >
                                <span className="tag-dot" style={tagStyle(tag.color)} />
                                <span className="tag-chip-name">{tag.name}</span>
                                <span className="tag-count">{tag.count}</span>
                            </li>
                        ))}
                        {creating && (
                            <li
                                role="option"
                                aria-selected={highlighted === suggestions.length}
                                onPointerDown={(evt) => evt.preventDefault()}
                                onClick={() => pick(suggestions.length)}
                            >
                                <span className="tag-chip-name">建立「{query.trim().replace(/^#+/, "").trim()}」</span>
                            </li>
                        )}
                    </ul>
                )}
            </div>
        </div>
    );
}

export default TagBar;
