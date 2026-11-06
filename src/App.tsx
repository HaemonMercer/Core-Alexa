import "./App.css";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "./api.ts";
import Canvas, { type BoardHandle } from "./components/canvas/Canvas.tsx";
import CardFullscreen from "./components/cards/CardFullscreen.tsx";
import CardLibrary from "./components/cards/CardLibrary.tsx";
import LibraryShelf, { type ShelfTab } from "./components/cards/LibraryShelf.tsx";
import LeftPanel, { type Page } from "./components/layout/LeftPanel.tsx";
import OfficeLibrary from "./components/office/OfficeLibrary.tsx";
import { usePanelWidth } from "./components/layout/PanelResizer.tsx";
import RightPanel from "./components/layout/RightPanel.tsx";
import WhiteboardHeader from "./components/whiteboards/WhiteboardHeader.tsx";
import WhiteboardLibrary from "./components/whiteboards/WhiteboardLibrary.tsx";
import { noteIDFromHref } from "./markdown/noteLink.ts";
import type { Note, WorkspaceState } from "./types.ts";

const EXTERNAL_LINK = /^(https?:|mailto:)/i;
const LEFT_WIDTH = { initial: 220, min: 160, max: 420 };
const RIGHT_WIDTH = { initial: 320, min: 240, max: 720 };
/** 摺疊後的寬度，和 App.css 的 `.collapsed` 一致。 */
const COLLAPSED_WIDTH = 40;

function App() {
    const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
    const [page, setPage] = useState<Page>("whiteboard");
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
    const [fullscreenCardID, setFullscreenCardID] = useState<string | null>(null);
    const [leftWidth, setLeftWidth] = usePanelWidth("left", LEFT_WIDTH);
    const [rightWidth, setRightWidth] = usePanelWidth("right", RIGHT_WIDTH);
    const [placedNoteIDs, setPlacedNoteIDs] = useState<ReadonlySet<string>>(new Set());
    const [shelfTab, setShelfTab] = useState<ShelfTab>("cards");
    const boardRef = useRef<BoardHandle>(null);

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

    const closeFullscreen = useCallback(() => setFullscreenCardID(null), []);

    const navigate = useCallback((next: Page) => {
        setFullscreenCardID(null);
        setPage(next);
    }, []);

    const openWhiteboard = useCallback((id: string) => {
        api.selectWhiteboard(id)
            .then((next) => {
                setWorkspace(next);
                navigate("whiteboard");
            })
            .catch(reportError);
    }, [navigate, reportError]);

    const cardDeleted = useCallback((ids: string[]) => {
        const without = (current: string | null) => (current && ids.includes(current) ? null : current);
        setSelectedCardID(without);
        setFullscreenCardID(without);
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
            .then(setWorkspace)
            .catch((error: unknown) => setLoadError(String(error)));
    }, []);

    if (loadError) return <main className="status">無法開啟資料：{loadError}</main>;
    if (!workspace) return <main className="status">載入中…</main>;

    const { whiteboards, activeWhiteboardId, rootWhiteboardId, path } = workspace;

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
                onToggle={() => setLeftCollapsed((collapsed) => !collapsed)}
            />
            <div className="workspace-pane">
                {actionError && <div className="save-error">操作失敗：{actionError}</div>}
                {page === "cards" && (
                    <CardLibrary
                        cardsRevision={cardsRevision}
                        selectedID={selectedCardID}
                        syncedCard={syncedCard}
                        onSelect={setSelectedCardID}
                        onOpenFullscreen={setFullscreenCardID}
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
                        onRename={renameWhiteboard}
                        onDeleted={whiteboardDeleted}
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
                                onWorkspaceChange={setWorkspace}
                                onOpenCard={openCard}
                                onOpenFullscreen={setFullscreenCardID}
                                onCloseCard={closeCard}
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
                        noteID={fullscreenCardID}
                        linksRevision={linksRevision}
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
            <RightPanel
                card={card?.id === selectedCardID ? card : null}
                editedElsewhere={selectedCardID !== null && [inlineCardID, fullscreenCardID].includes(selectedCardID)}
                library={page === "whiteboard" && (
                    <LibraryShelf
                        tab={shelfTab}
                        onTabChange={setShelfTab}
                        cardsRevision={cardsRevision}
                        syncedCard={syncedCard}
                        canPlace={activeWhiteboardId !== rootWhiteboardId}
                        placedNoteIDs={placedNoteIDs}
                        onDrop={(id, x, y, tableID) => boardRef.current?.placeCardAt(id, x, y, tableID)}
                        onPlaceAtCenter={(id, tableID) => boardRef.current?.placeCardAtCenter(id, tableID)}
                        onOpen={openCard}
                        onOpenFullscreen={setFullscreenCardID}
                        onDeleted={cardDeleted}
                        onError={reportError}
                    />
                )}
                collapsed={rightCollapsed}
                width={rightWidth}
                widthRange={RIGHT_WIDTH}
                otherWidth={leftCollapsed ? COLLAPSED_WIDTH : leftWidth}
                onWidthChange={setRightWidth}
                linksRevision={linksRevision}
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
