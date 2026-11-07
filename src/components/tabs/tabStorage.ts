import * as api from "../../api.ts";
import type { WorkspaceState } from "../../types.ts";
import { activeTab, dropMissingBoards, newTab, parseTabs, withoutNotes, type TabState } from "./tabs.ts";

const STORAGE_KEY = "code-alexa.tabs";
const ORIGINAL_WORKSPACE = "default";

/** 每個 Workspace 各記各的分頁。最早的沿用舊鍵名，原本開著的分頁才不會消失。 */
export const tabsKey = (spaceID: string) =>
    spaceID === ORIGINAL_WORKSPACE ? STORAGE_KEY : `${STORAGE_KEY}.${spaceID}`;

/** 開著哪些分頁是這台裝置的顯示偏好，不是工作區資料，所以不進 SQLite。 */
export function saveTabs(state: TabState, spaceID: string) {
    try {
        localStorage.setItem(tabsKey(spaceID), JSON.stringify(state));
    } catch {
        // 存不下只是下次回到一個分頁。
    }
}

function readTabs(spaceID: string): TabState | null {
    try {
        return parseTabs(localStorage.getItem(tabsKey(spaceID)));
    } catch {
        return null;
    }
}

/** 還原上次的分頁，略過已經刪除的白板和筆記。 */
export async function restoreTabs(
    workspace: WorkspaceState,
    spaceID: string,
): Promise<{ tabs: TabState; workspace: WorkspaceState }> {
    const saved = readTabs(spaceID);
    if (!saved) {
        const tab = newTab({ page: "whiteboard", whiteboardID: workspace.activeWhiteboardId, fullscreenID: null });
        return { tabs: { tabs: [tab], activeID: tab.id }, workspace };
    }
    const boardIDs = workspace.whiteboards.map((board) => board.id);
    const noteIDs = saved.tabs.flatMap((tab) => tab.fullscreenID ?? []);
    const notes = await Promise.all(noteIDs.map((id) => api.getNote(id)));
    const tabs = withoutNotes(
        dropMissingBoards(saved, boardIDs, workspace.rootWhiteboardId),
        noteIDs.filter((_, index) => notes[index] === null),
    );
    const active = activeTab(tabs);
    return {
        tabs,
        workspace: active.page === "whiteboard" ? await api.selectWhiteboard(active.whiteboardID) : workspace,
    };
}
