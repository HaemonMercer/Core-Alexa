import { useState, type ReactNode } from "react";
import * as api from "../../api.ts";
import { deleteLabel, noteTitle } from "../../noteTypes.ts";
import type { Note, NoteDeletion, WhiteboardDeletion, WorkspaceState } from "../../types.ts";
import ConfirmDialog from "./ConfirmDialog.tsx";

// 刪除無法復原，一律先向 Rust 問影響範圍，再由使用者確認。
// 回傳的 `dialog` 要放進畫面裡，`ask` 開始一次刪除，可以一次刪多個。

interface Pending<Target, Impact> {
    targets: Target[];
    impact: Impact;
}

function describeNotes({ whiteboards, linkedCards }: NoteDeletion): string {
    const parts: string[] = [];
    if (whiteboards.length > 0) parts.push(`會從 ${whiteboards.join("、")} 移除，接在上面的箭頭也會一起刪除。`);
    if (linkedCards > 0) parts.push(`有 ${linkedCards} 張卡片的連結會失效。`);
    parts.push("這個動作無法復原。");
    return parts.join("");
}

function describeWhiteboards({ childWhiteboards, notes }: WhiteboardDeletion): string {
    const parts: string[] = [];
    if (childWhiteboards > 0) parts.push(`底下的 ${childWhiteboards} 個子白板也會一起刪除。`);
    if (notes > 0) parts.push(`上面的 ${notes} 張卡片不會刪除，仍在 Library。`);
    parts.push("這個動作無法復原。");
    return parts.join("");
}

export function useNoteDeletion(
    onDeleted: (ids: string[]) => void,
    onError: (error: unknown) => void,
): { ask: (notes: Note[]) => void; dialog: ReactNode } {
    const [pending, setPending] = useState<Pending<Note, NoteDeletion> | null>(null);

    const ask = (notes: Note[]) => {
        api.getNoteDeletion(notes.map((note) => note.id))
            .then((impact) => setPending({ targets: notes, impact }))
            .catch(onError);
    };

    const dialog = pending && (
        <ConfirmDialog
            title={pending.targets.length === 1
                ? `刪除「${noteTitle(pending.targets[0])}」？`
                : `${deleteLabel(pending.targets)}？`}
            detail={describeNotes(pending.impact)}
            onConfirm={() => {
                const ids = pending.targets.map((note) => note.id);
                setPending(null);
                api.deleteNotes(ids).then(() => onDeleted(ids)).catch(onError);
            }}
            onCancel={() => setPending(null)}
        />
    );
    return { ask, dialog };
}

export function useWhiteboardDeletion(
    onDeleted: (workspace: WorkspaceState) => void,
    onError: (error: unknown) => void,
): { ask: (boards: { id: string; name: string }[]) => void; dialog: ReactNode } {
    const [pending, setPending] = useState<Pending<{ id: string; name: string }, WhiteboardDeletion> | null>(null);

    const ask = (boards: { id: string; name: string }[]) => {
        api.getWhiteboardDeletion(boards.map((board) => board.id))
            .then((impact) => setPending({ targets: boards, impact }))
            .catch(onError);
    };

    const dialog = pending && (
        <ConfirmDialog
            title={pending.targets.length === 1
                ? `刪除「${pending.targets[0].name}」？`
                : `刪除 ${pending.targets.length} 個白板？`}
            detail={describeWhiteboards(pending.impact)}
            onConfirm={() => {
                const ids = pending.targets.map((board) => board.id);
                setPending(null);
                api.deleteWhiteboards(ids).then(onDeleted).catch(onError);
            }}
            onCancel={() => setPending(null)}
        />
    );
    return { ask, dialog };
}
