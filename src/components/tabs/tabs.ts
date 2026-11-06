import type { Page } from "../layout/LeftPanel.tsx";

// 操作區的分頁。左右面板不分頁：每個分頁只記操作區顯示什麼。這裡都是純函式。

export interface Tab {
    id: string;
    page: Page;
    /** 這個分頁的白板。`page` 不是白板時也留著，回到白板才知道是哪一個。 */
    whiteboardID: string;
    /** 蓋在操作區上的全螢幕筆記。 */
    fullscreenID: string | null;
}

export interface TabState {
    tabs: Tab[];
    activeID: string;
}

const PAGES: readonly Page[] = ["whiteboard", "cards", "whiteboards", "office", "tags"];

/** `fields` 可以是別的分頁展開來的，id 一定要放在後面才不會被蓋掉。 */
export const newTab = (fields: Omit<Tab, "id">): Tab => ({ ...fields, id: crypto.randomUUID() });

export const activeTab = (state: TabState): Tab =>
    state.tabs.find((tab) => tab.id === state.activeID) ?? state.tabs[0];

export const activateTab = (state: TabState, id: string): TabState =>
    (state.tabs.some((tab) => tab.id === id) ? { ...state, activeID: id } : state);

export function patchActive(state: TabState, patch: Partial<Omit<Tab, "id">>): TabState {
    const { id } = activeTab(state);
    return { ...state, tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) };
}

/** 新分頁放在目前分頁右邊，並切換過去。 */
export function addTab(state: TabState, tab: Tab): TabState {
    const index = state.tabs.findIndex((other) => other.id === activeTab(state).id);
    return { tabs: [...state.tabs.slice(0, index + 1), tab, ...state.tabs.slice(index + 1)], activeID: tab.id };
}

/** 最後一個分頁不能關，操作區總要顯示東西。關掉目前分頁時切到右邊，沒有才切到左邊。 */
export function closeTab(state: TabState, id: string): TabState {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    if (index < 0 || state.tabs.length === 1) return state;
    const tabs = state.tabs.filter((tab) => tab.id !== id);
    if (state.activeID !== id) return { ...state, tabs };
    return { tabs, activeID: tabs[Math.min(index, tabs.length - 1)].id };
}

export function closeOtherTabs(state: TabState, id: string): TabState {
    const kept = state.tabs.filter((tab) => tab.id === id);
    return kept.length === 0 ? state : { tabs: kept, activeID: id };
}

/** 往右（`step` 為 1）或往左切換，到頭後繞回另一端。 */
export function neighbourTab(state: TabState, step: 1 | -1): string {
    const index = state.tabs.findIndex((tab) => tab.id === activeTab(state).id);
    return state.tabs[(index + step + state.tabs.length) % state.tabs.length].id;
}

/** `index` 是拿掉這個分頁之後的位置。 */
export function moveTab(state: TabState, id: string, index: number): TabState {
    const moving = state.tabs.find((tab) => tab.id === id);
    if (!moving) return state;
    const others = state.tabs.filter((tab) => tab.id !== id);
    return { ...state, tabs: [...others.slice(0, index), moving, ...others.slice(index)] };
}

/** 已經開著就切過去，不必多開一個。 */
export const tabShowingNote = (state: TabState, noteID: string) =>
    state.tabs.find((tab) => tab.fullscreenID === noteID);

export const tabShowingBoard = (state: TabState, whiteboardID: string) =>
    state.tabs.find((tab) => tab.page === "whiteboard" && tab.fullscreenID === null && tab.whiteboardID === whiteboardID);

/** 筆記被刪除時，顯示它的分頁都回到底下的頁面。 */
export function withoutNotes(state: TabState, ids: string[]): TabState {
    if (!state.tabs.some((tab) => tab.fullscreenID !== null && ids.includes(tab.fullscreenID))) return state;
    return {
        ...state,
        tabs: state.tabs.map((tab) => (
            tab.fullscreenID !== null && ids.includes(tab.fullscreenID) ? { ...tab, fullscreenID: null } : tab
        )),
    };
}

/** 白板被刪除時，停在上面的分頁回到 Root。沒有變動時回傳同一個物件，React 才不會重畫。 */
export function dropMissingBoards(state: TabState, boardIDs: string[], rootID: string): TabState {
    if (state.tabs.every((tab) => boardIDs.includes(tab.whiteboardID))) return state;
    return {
        ...state,
        tabs: state.tabs.map((tab) => (boardIDs.includes(tab.whiteboardID) ? tab : { ...tab, whiteboardID: rootID })),
    };
}

/** 目前開啟的白板由 Rust 決定（例如刪掉開著的白板會回到上層），白板分頁要跟上。 */
export function followActiveBoard(state: TabState, whiteboardID: string): TabState {
    const tab = activeTab(state);
    if (tab.page !== "whiteboard" || tab.whiteboardID === whiteboardID) return state;
    return patchActive(state, { whiteboardID });
}

function isTab(value: unknown): value is Tab {
    if (typeof value !== "object" || value === null) return false;
    const tab = value as Record<string, unknown>;
    return typeof tab.id === "string"
        && PAGES.includes(tab.page as Page)
        && typeof tab.whiteboardID === "string"
        && (tab.fullscreenID === null || typeof tab.fullscreenID === "string");
}

/** 讀回上次的分頁。內容不對就當作沒有，不能讓 App 開不起來。 */
export function parseTabs(text: string | null): TabState | null {
    if (!text) return null;
    try {
        const value = JSON.parse(text) as Partial<TabState>;
        if (!Array.isArray(value.tabs) || value.tabs.length === 0 || !value.tabs.every(isTab)) return null;
        const tabs = value.tabs;
        const activeID = tabs.some((tab) => tab.id === value.activeID) ? value.activeID as string : tabs[0].id;
        return { tabs, activeID };
    } catch {
        return null;
    }
}
