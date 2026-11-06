import { Fragment } from "react";
import type { Whiteboard } from "../../types.ts";
import EditableName from "./EditableName.tsx";

interface WhiteboardHeaderProps {
    path: Whiteboard[];
    rootID: string;
    onOpen: (id: string) => void;
    onRename: (id: string, name: string) => void;
}

function WhiteboardHeader({ path, rootID, onOpen, onRename }: WhiteboardHeaderProps) {
    const active = path[path.length - 1];
    return (
        <header className="whiteboard-header">
            {path.slice(0, -1).map((board) => (
                <Fragment key={board.id}>
                    <button className="header-crumb" onClick={() => onOpen(board.id)}>{board.name}</button>
                    <span className="header-separator">/</span>
                </Fragment>
            ))}
            {active?.id === rootID ? (
                <span className="header-name">{active.name}</span>
            ) : active && (
                <EditableName
                    key={active.id}
                    name={active.name}
                    onRename={(name) => onRename(active.id, name)}
                />
            )}
        </header>
    );
}

export default WhiteboardHeader;
