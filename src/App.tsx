import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api.ts";
import Canvas, { type BoardHandle } from "./components/canvas/Canvas.tsx";
import CardFullscreen, { type CardFullscreenHandle } from "./components/cards/CardFullscreen.tsx";
import CardLibrary from "./components/cards/CardLibrary.tsx";
import type { CardSurface } from "./components/cards/cardSurface.ts";
import LibraryShelf, { type ShelfTab } from "./components/cards/LibraryShelf.tsx";
import DataLocationDialog from "./components/common/DataLocationDialog.tsx";
import LeftPanel, { pageLabel, type Page } from "./components/layout/LeftPanel.tsx";
import OfficeLibrary from "./components/office/OfficeLibrary.tsx";
import { usePanelWidth } from "./components/layout/PanelResizer.tsx";
import RightPanel from "./components/layout/RightPanel.tsx";
import WhiteboardHeader from "./components/whiteboards/WhiteboardHeader.tsx";
import WhiteboardLibrary from "./components/whiteboards/WhiteboardLibrary.tsx";
import TabBar from "./components/tabs/TabBar.tsx";
import {
    activateTab, activeTab, addTab, closeOtherTabs, closeTab, dropMissingBoards, followActiveBoard, moveTab, neighbourTab,
    newTab, patchActive, tabShowingBoard, tabShowingNote, withoutNotes, type Tab, type TabState,
} from "./components/tabs/tabs.ts";
import { restoreTabs, saveTabs } from "./components/tabs/tabStorage.ts";
import { useNoteTitles } from "./components/tabs/useNoteTitles.ts";
import TagLibrary from "./components/tags/TagLibrary.tsx";
import { noteIDFromHref } from "./markdown/noteLink.ts";
import type { Note, WorkspaceState } from "./types.ts";

const EXTERNAL_LINK = /^(https?:|mailto:)/i;
const LEFT_WIDTH = { initial: 220, min: 160, max: 420 };
const RIGHT_WIDTH = { initial: 320, min: 240, max: 720 };
/** 摺疊後的寬度，和 App.css 的 `.collapsed` 一致。 */
const COLLAPSED_WIDTH = 40;

function App() {
    const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
    const [tabState, setTabState] = useState<TabState | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [selectedCardID, setSelectedCardID] = useState<string | null>(null);
    const [card, setCard] = useState<Note | null>(null);
    const [syncedCard, setSyncedCard] = useState<{ id: string; content: string } | null>(null);
    const [inlineCardID, setInlineCardID] = useState<string | null>(null);
    const [linksRevision, setLinksRevision] = useState(0);
    const [cardsRevision, setCardsRevision] = useState(0);
    const [leftCollapsed, setLeftCollapsed] = useState(false);
    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [leftWidth, setLeftWidth] = usePanelWidth("left", LEFT_WIDTH);
    const [rightWidth, setRightWidth] = usePanelWidth("right", RIGHT_WIDTH);
    const [placedNoteIDs, setPlacedNoteIDs] = useState<ReadonlySet<string>>(new Set());
    const [shelfTab, setShelfTab] = useState<ShelfTab>("cards");
    /** 全螢幕的文件也可以放卡片，這時 Library 拖到文件上，不是白板。 */
    const [surface, setSurface] = useState<CardSurface | null>(null);
    const boardRef = useRef<BoardHandle>(null);
    const fullscreenRef = useRef<CardFullscreenHandle>(null);
    const tabsRef = useRef(tabState);
    tabsRef.current = tabState;
    /** 連續切換分頁時，只有最後一次算數。 */
    const switchRef = useRef(0);

    const active = tabState && activeTab(tabState);
    const page: Page = active?.page ?? "whiteboard";
    const fullscreenCardID = active?.fullscreenID ?? null;

    const reportError = useCallback((error: unknown) => {
        console.error(error);
        setActionError(String(error));
    }, []);

    const refreshLinks = useCallback(() => setLinksRevision((revision) => revision + 1), []);

    const refreshCards = useCallback(() => setCardsRevision((revision) => revision + 1), []);

    const openCard = useCallback((id: string) => {
        setSelectedCardID(id);
        setRightCollapsed(false);
    }, []);

    const closeCard = useCallback(() => setSelectedCardID(null), []);

    const setFullscreenCardID = useCallback((id: string | null) => {
        setTabState((current) => current && patchActive(current, { fullscreenID: id }));
    }, []);

    const closeFullscreen = useCallback(() => setFullscreenCardID(null), [setFullscreenCardID]);

    /** 離開全螢幕前先存好：Draw.io 的 iframe 一移除就無法匯出預覽。 */
    const leaveFullscreen = useCallback(() => fullscreenRef.current?.flush() ?? Promise.resolve(), []);

    const [dataLocationOpen, setDataLocationOpen] = useState(false);

    // 選的位置打不開時一啟動就要說，否則會以為資料不見了。
    useEffect(() => {
        void api.getDataLocation().then((location) => {
            if (location.unavailable) setDataLocationOpen(true);
        });
    }, []);

    const navigate = useCallback((next: Page) => {
        void leaveFullscreen().then(() => {
            setTabState((current) => current && patchActive(current, { page: next, fullscreenID: null }));
        });
    }, [leaveFullscreen]);

    const openWhiteboard = useCallback((id: string) => {
        leaveFullscreen()
            .then(() => api.selectWhiteboard(id))
            .then((next) => {
                setWorkspace(next);
                // 換白板時右側面板回到 Library。切換分頁不走這裡，面板不跟著分頁走。
                setSelectedCardID(null);
                setTabState((current) => current && patchActive(current, { page: "whiteboard", whiteboardID: id, fullscreenID: null }));
            })
            .catch(reportError);
    }, [leaveFullscreen, reportError]);

    /** 換到另一個分頁。白板由 Rust 記錄目前開著哪一個，要先告訴它，畫布才不會閃過舊白板。 */
    const changeTabs = useCallback((update: (current: TabState) => TabState) => {
        const current = tabsRef.current;
        if (!current) return;
        const target = activeTab(update(current));
        if (target.id === current.activeID) {
            setTabState((latest) => latest && update(latest));
            return;
        }
        switchRef.current += 1;
        const turn = switchRef.current;
        leaveFullscreen()
            .then(() => (target.page === "whiteboard" ? api.selectWhiteboard(target.whiteboardID) : null))
            .then((next) => {
                if (turn !== switchRef.current) return;
                if (next) setWorkspace(next);
                setTabState((latest) => latest && update(latest));
            })
            .catch(reportError);
    }, [leaveFullscreen, reportError]);

    const openTab = useCallback((id: string) => changeTabs((current) => activateTab(current, id)), [changeTabs]);

    /** 已經開著就切過去。 */
    const openBoardInTab = useCallback((id: string) => {
        const current = tabsRef.current;
        if (!current) return;
        const open = tabShowingBoard(current, id);
        if (open) {
            openTab(open.id);
            return;
        }
        const tab = newTab({ page: "whiteboard", whiteboardID: id, fullscreenID: null });
        changeTabs((latest) => addTab(latest, tab));
    }, [changeTabs, openTab]);

    /** 全螢幕關掉後回到和目前分頁一樣的頁面。 */
    const openNoteInTab = useCallback((id: string) => {
        const current = tabsRef.current;
        if (!current) return;
        const open = tabShowingNote(current, id);
        if (open) {
            openTab(open.id);
            return;
        }
        const tab = newTab({ ...activeTab(current), fullscreenID: id });
        changeTabs((latest) => addTab(latest, tab));
    }, [changeTabs, openTab]);

    const cardDeleted = useCallback((ids: string[]) => {
        const without = (current: string | null) => (current && ids.includes(current) ? null : current);
        setSelectedCardID(without);
        setTabState((current) => current && withoutNotes(current, ids));
        refreshCards();
        refreshLinks();
        boardRef.current?.refresh();
    }, [refreshCards, refreshLinks]);

    const whiteboardDeleted = useCallback((next: WorkspaceState) => {
        setWorkspace(next);
        refreshLinks();
    }, [refreshLinks]);

    const renameWhiteboard = useCallback((id: string, name: string) => {
        api.renameWhiteboard(id, name)
            .then((renamed) => setWorkspace(renamed.workspace))
            .catch(reportError);
    }, [reportError]);

    const cardEdited = useCallback((id: string, content: string) => {
        setCard((current) => (current?.id === id ? { ...current, content } : current));
        setSyncedCard({ id, content });
        refreshLinks();
    }, [refreshLinks]);

    const cardChanged = useCallback((id: string) => {
        api.getNote(id)
            .then((note) => {
                if (note) cardEdited(id, note.content);
            })
            .catch(reportError);
    }, [cardEdited, reportError]);

    const noteChanged = useCallback(() => {
        boardRef.current?.refresh();
        refreshCards();
    }, [refreshCards]);

    /** 開著的筆記也要更新：結束全螢幕後右側面板會用這份資料重建編輯器。 */
    const changeCodeLanguage = useCallback((id: string, language: string) => {
        setCard((current) => (current?.id === id
            ? { ...current, context: { ...current.context, language } }
            : current));
        api.setCodeLanguage(id, language).then(noteChanged).catch(reportError);
    }, [noteChanged, reportError]);

    const editCardInPanel = useCallback((id: string, content: string) => {
        cardEdited(id, content);
        api.updateNoteContent(id, content).catch(reportError);
    }, [cardEdited, reportError]);

    const openLink = useCallback((href: string) => {
        const noteID = noteIDFromHref(href);
        if (noteID) openCard(noteID);
        else if (EXTERNAL_LINK.test(href)) api.openLink(href).catch(reportError);
    }, [openCard, reportError]);

    useEffect(() => {
        if (!selectedCardID) {
            setCard(null);
            return;
        }
        let cancelled = false;
        api.getNote(selectedCardID)
            .then((note) => {
                if (!cancelled) setCard(note);
            })
            .catch(reportError);
        return () => {
            cancelled = true;
        };
    }, [selectedCardID, reportError]);

    useEffect(() => {
        api.getWorkspace()
            .then(restoreTabs)
            .then((restored) => {
                setWorkspace(restored.workspace);
                setTabState(restored.tabs);
            })
            .catch((error: unknown) => setLoadError(String(error)));
    }, []);

    useEffect(() => {
        if (tabState) saveTabs(tabState);
    }, [tabState]);

    // 白板可能在別處被刪除或換掉，分頁要跟上。
    useEffect(() => {
        if (!workspace) return;
        const boardIDs = workspace.whiteboards.map((board) => board.id);
        setTabState((current) => current && followActiveBoard(
            dropMissingBoards(current, boardIDs, workspace.rootWhiteboardId),
            workspace.activeWhiteboardId,
        ));
    }, [workspace]);

    useEffect(() => {
        const onKeyDown = (evt: KeyboardEvent) => {
            if (!evt.ctrlKey || evt.altKey || evt.isComposing) return;
            if (document.querySelector(".confirm-backdrop")) return;
            const current = tabsRef.current;
            const key = evt.key.toLowerCase();
            if (!current || !["t", "w", "tab"].includes(key)) return;
            // 比編輯器先處理：Ctrl+Tab 不能變成縮排或跳到下一格。
            evt.preventDefault();
            evt.stopPropagation();
            if (key === "tab") openTab(neighbourTab(current, evt.shiftKey ? -1 : 1));
            else if (key === "w") changeTabs((latest) => closeTab(latest, latest.activeID));
            else if (workspace) {
                const tab = newTab({ page: "whiteboard", whiteboardID: workspace.rootWhiteboardId, fullscreenID: null });
                changeTabs((latest) => addTab(latest, tab));
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [workspace, changeTabs, openTab]);

    const noteTabIDs = useMemo(
        () => [...new Set(tabState?.tabs.flatMap((tab) => tab.fullscreenID ?? []))],
        [tabState],
    );
    const noteTitles = useNoteTitles(noteTabIDs, linksRevision + cardsRevision, reportError);

    if (loadError) return <main className="status">無法開啟資料：{loadError}</main>;
    if (!workspace || !tabState) return <main className="status">載入中…</main>;

    const { whiteboards, activeWhiteboardId, rootWhiteboardId, path } = workspace;
    const shelf = {
        tab: shelfTab,
        onTabChange: setShelfTab,
        cardsRevision,
        syncedCard,
        onOpen: openCard,
        onOpenFullscreen: setFullscreenCardID,
        onOpenInTab: openNoteInTab,
        onDeleted: cardDeleted,
        onError: reportError,
    };
    const tabTitle = (tab: Tab) => {
        if (tab.fullscreenID) return noteTitles[tab.fullscreenID] ?? "載入中…";
        if (tab.page !== "whiteboard") return pageLabel(tab.page);
        return whiteboards.find((board) => board.id === tab.whiteboardID)?.name ?? "白板";
    };
    // 面板不再顯示正在全螢幕編輯的文件自己，Library 才放得了卡片。
    const editingSurface = surface !== null && selectedCardID === fullscreenCardID;

    return (
        <main className="app-shell">
            <LeftPanel
                page={page}
                collapsed={leftCollapsed}
                width={leftWidth}
                widthRange={LEFT_WIDTH}
                otherWidth={rightCollapsed ? COLLAPSED_WIDTH : rightWidth}
                onWidthChange={setLeftWidth}
                onNavigate={navigate}
                onOpenRoot={() => openWhiteboard(rootWhiteboardId)}
                onOpenDataLocation={() => setDataLocationOpen(true)}
                onToggle={() => setLeftCollapsed((collapsed) => !collapsed)}
            />
            {dataLocationOpen && (
                <DataLocationDialog onBeforeMove={leaveFullscreen} onClose={() => setDataLocationOpen(false)} />
            )}
            <div className="workspace-pane">
                <TabBar
                    state={tabState}
                    titleOf={tabTitle}
                    onActivate={openTab}
                    onAdd={() => {
                        const tab = newTab({ page: "whiteboard", whiteboardID: rootWhiteboardId, fullscreenID: null });
                        changeTabs((latest) => addTab(latest, tab));
                    }}
                    onClose={(id) => changeTabs((latest) => closeTab(latest, id))}
                    onCloseOthers={(id) => changeTabs((latest) => closeOtherTabs(latest, id))}
                    onMove={(id, index) => setTabState((current) => current && moveTab(current, id, index))}
                />
                <div className="tab-content">
                {actionError && <div className="save-error">操作失敗：{actionError}</div>}
                {page === "cards" && (
                    <CardLibrary
                        cardsRevision={cardsRevision}
                        selectedID={selectedCardID}
                        syncedCard={syncedCard}
                        onSelect={setSelectedCardID}
                        onOpenFullscreen={setFullscreenCardID}
                        onOpenInTab={openNoteInTab}
                        onDeleted={cardDeleted}
                        onError={reportError}
                    />
                )}
                {page === "office" && (
                    <OfficeLibrary
                        cardsRevision={cardsRevision}
                        selectedID={selectedCardID}
                        onSelect={setSelectedCardID}
                        onOpen={setFullscreenCardID}
                        onOpenInTab={openNoteInTab}
                        onChanged={refreshCards}
                        onDeleted={cardDeleted}
                        onError={reportError}
                    />
                )}
                {page === "whiteboards" && (
                    <WhiteboardLibrary
                        whiteboards={whiteboards}
                        rootID={rootWhiteboardId}
                        onOpen={openWhiteboard}
                        onOpenInTab={openBoardInTab}
                        onRename={renameWhiteboard}
                        onDeleted={whiteboardDeleted}
                        onError={reportError}
                    />
                )}
                {page === "tags" && (
                    <TagLibrary
                        cardsRevision={cardsRevision}
                        selectedID={selectedCardID}
                        onSelect={openCard}
                        onOpenFullscreen={setFullscreenCardID}
                        onChanged={noteChanged}
                        onError={reportError}
                    />
                )}
                {page === "whiteboard" && (
                    <>
                        <WhiteboardHeader
                            path={path}
                            rootID={rootWhiteboardId}
                            onOpen={openWhiteboard}
                            onRename={renameWhiteboard}
                        />
                        <div className="canvas-pane">
                            {/* key：換白板時重新掛載，選取工具列、選單這些覆蓋層才不會留在新白板上。 */}
                            <Canvas
                                key={activeWhiteboardId}
                                ref={boardRef}
                                whiteboardID={activeWhiteboardId}
                                isRoot={activeWhiteboardId === rootWhiteboardId}
                                onOpenWhiteboard={openWhiteboard}
                                onOpenWhiteboardInTab={openBoardInTab}
                                onOpenNoteInTab={openNoteInTab}
                                onWorkspaceChange={setWorkspace}
                                onOpenCard={openCard}
                                onOpenFullscreen={setFullscreenCardID}
                                onCardCreated={refreshCards}
                                onPlacedNotes={setPlacedNoteIDs}
                                onInlineEditChange={setInlineCardID}
                                onCardChanged={cardChanged}
                                onLinksChange={refreshLinks}
                                onCardDeleted={cardDeleted}
                                onWhiteboardDeleted={whiteboardDeleted}
                                onOpenLink={openLink}
                                syncedCard={syncedCard}
                                onError={reportError}
                            />
                        </div>
                    </>
                )}
                {fullscreenCardID && (
                    <CardFullscreen
                        key={active?.id}
                        ref={fullscreenRef}
                        noteID={fullscreenCardID}
                        linksRevision={linksRevision}
                        cardRevision={linksRevision + cardsRevision}
                        onSurface={setSurface}
                        onPeekCard={openCard}
                        onChange={editCardInPanel}
                onNoteChanged={noteChanged}
                onCardChanged={cardChanged}
                onCodeLanguageChange={changeCodeLanguage}
                        onOpenLink={openLink}
                        onOpenCard={setFullscreenCardID}
                        onCardCreated={refreshCards}
                        onClose={closeFullscreen}
                        onError={reportError}
                    />
                )}
                </div>
            </div>
            <RightPanel
                card={card?.id === selectedCardID && !editingSurface ? card : null}
                editedElsewhere={selectedCardID !== null && (
                    [inlineCardID, fullscreenCardID].includes(selectedCardID)
                    // 放在開著的文件裡的 Note 就在那裡編輯。
                    || (card?.type === "card" && surface?.placed.has(selectedCardID) === true)
                )}
                library={surface ? (
                    <LibraryShelf
                        {...shelf}
                        cardsOnly={!surface.office}
                        canPlace
                        placedNoteIDs={surface.placed}
                        accepts={surface.office ? (note) => note.type !== "writer" && note.type !== "slides" : undefined}
                        surfaceName={surface.name}
                        onHover={surface.hover}
                        onDrop={surface.placeAt}
                        onPlaceAtCenter={surface.placeAtCenter}
                    />
                ) : page === "whiteboard" && (
                    <LibraryShelf
                        {...shelf}
                        canPlace={activeWhiteboardId !== rootWhiteboardId}
                        placedNoteIDs={placedNoteIDs}
                        onDrop={(id, x, y, tableID) => boardRef.current?.placeCardAt(id, x, y, tableID)}
                        onPlaceAtCenter={(id, tableID) => boardRef.current?.placeCardAtCenter(id, tableID)}
                    />
                )}
                collapsed={rightCollapsed}
                width={rightWidth}
                widthRange={RIGHT_WIDTH}
                otherWidth={leftCollapsed ? COLLAPSED_WIDTH : leftWidth}
                onWidthChange={setRightWidth}
                linksRevision={linksRevision}
                cardsRevision={cardsRevision}
                onChange={editCardInPanel}
                onNoteChanged={noteChanged}
                onCardChanged={cardChanged}
                onCodeLanguageChange={changeCodeLanguage}
                onOpenLink={openLink}
                onOpenCard={openCard}
                onOpenFullscreen={setFullscreenCardID}
                onCloseCard={closeCard}
                onCardCreated={refreshCards}
                onError={reportError}
                onToggle={() => setRightCollapsed((collapsed) => !collapsed)}
            />
        </main>
    );
}

export default App;
