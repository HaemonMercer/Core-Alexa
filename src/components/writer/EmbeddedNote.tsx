import WriterEditor from "./WriterEditor.tsx";

interface EmbeddedNoteProps {
    noteID: string;
    /** 別處改了這張 Note 時遞增。 */
    revision?: number;
    onChanged: (id: string) => void;
    /** 外面的文件要重算目錄。 */
    onContentChange?: () => void;
    onOpenLink: (href: string) => void;
    onCardCreated?: () => void;
    /** Slides 和 Excels 雙擊才進入編輯，點到外面或按 Esc 離開。Writer 一直都在編輯。 */
    onClose?: () => void;
    onError: (error: unknown) => void;
}

/** 放在文件、投影片或工作表裡的 Note，就地編輯。內容只有一份，改的是 Note 本身。 */
function EmbeddedNote({ noteID, revision, onChanged, onContentChange, onOpenLink, onCardCreated, onClose, onError }: EmbeddedNoteProps) {
    return (
        <WriterEditor
            key={noteID}
            noteID={noteID}
            card
            embedded
            revisionFromOutside={revision}
            onChanged={() => onChanged(noteID)}
            onContentChange={onContentChange}
            onOpenLink={onOpenLink}
            onCardCreated={onCardCreated}
            onClose={onClose}
            onError={onError}
        />
    );
}

export default EmbeddedNote;
