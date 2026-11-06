import { useState } from "react";
import WhiteboardNameInput from "./WhiteboardNameInput.tsx";

interface EditableNameProps {
    name: string;
    onRename: (name: string) => void;
}

/** 點擊名稱就地改名。 */
function EditableName({ name, onRename }: EditableNameProps) {
    const [editing, setEditing] = useState(false);

    if (editing) {
        return (
            <WhiteboardNameInput
                className="name-input"
                name={name}
                onSubmit={(next) => {
                    setEditing(false);
                    onRename(next);
                }}
                onCancel={() => setEditing(false)}
            />
        );
    }
    return (
        <button className="name-button" title="點擊改名" onClick={() => setEditing(true)}>
            {name}
        </button>
    );
}

export default EditableName;
