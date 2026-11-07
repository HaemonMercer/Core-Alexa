import PanelResizer from "./PanelResizer.tsx";
import WorkspaceSwitcher from "./WorkspaceSwitcher.tsx";

export type Page = "whiteboard" | "cards" | "whiteboards" | "office" | "tags";

const ITEMS: { page: Page; label: string }[] = [
    { page: "cards", label: "Card Library" },
    { page: "office", label: "Office Library" },
    { page: "whiteboards", label: "Whiteboard Library" },
    { page: "tags", label: "Tag Library" },
];

/** 分頁標題用的頁面名稱。 */
export const pageLabel = (page: Page) => ITEMS.find((item) => item.page === page)?.label ?? "";

interface LeftPanelProps {
    page: Page;
    collapsed: boolean;
    width: number;
    widthRange: { initial: number; min: number; max: number };
    /** 右側面板目前的寬度。 */
    otherWidth: number;
    onWidthChange: (width: number) => void;
    onNavigate: (page: Page) => void;
    onOpenRoot: () => void;
    onOpenDataLocation: () => void;
    /** 切換 Workspace 會重新啟動，要先存好編輯中的內容。 */
    onBeforeRestart: () => Promise<void>;
    onToggle: () => void;
}

function LeftPanel({
    page, collapsed, width, widthRange, otherWidth, onWidthChange, onNavigate, onOpenRoot, onOpenDataLocation,
    onBeforeRestart, onToggle,
}: LeftPanelProps) {
    if (collapsed) {
        return (
            <nav className="left-panel collapsed" aria-label="全域導覽">
                <button className="panel-toggle" aria-label="展開左側面板" title="展開左側面板" onClick={onToggle}>
                    »
                </button>
            </nav>
        );
    }
    return (
        <nav className="left-panel" aria-label="全域導覽" style={{ flexBasis: width }}>
            <PanelResizer
                side="left"
                width={width}
                range={widthRange}
                otherWidth={otherWidth}
                onChange={onWidthChange}
            />
            <div className="left-panel-title">
                <button className="left-panel-logo" title="回到 Root" onClick={onOpenRoot}>
                    Code Alexa
                </button>
                <button className="panel-toggle" aria-label="摺疊左側面板" title="摺疊左側面板" onClick={onToggle}>
                    «
                </button>
            </div>
            <WorkspaceSwitcher onBeforeRestart={onBeforeRestart} />
            {ITEMS.map((item) => (
                <button
                    key={item.page}
                    className="left-panel-item"
                    aria-current={page === item.page ? "page" : undefined}
                    onClick={() => onNavigate(item.page)}
                >
                    {item.label}
                </button>
            ))}
            <button className="left-panel-item left-panel-foot" onClick={onOpenDataLocation}>
                資料位置
            </button>
        </nav>
    );
}

export default LeftPanel;
