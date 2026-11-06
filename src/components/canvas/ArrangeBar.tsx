import { Fragment } from "react";
import type { Arrangement } from "../../types.ts";

interface Action {
    arrangement: Arrangement;
    label: string;
    title: string;
    minCount?: number;
}

const GROUPS: Action[][] = [
    [
        { arrangement: "alignLeft", label: "靠左", title: "對齊左緣" },
        { arrangement: "alignCenterX", label: "左右置中", title: "左右置中對齊" },
        { arrangement: "alignRight", label: "靠右", title: "對齊右緣" },
    ],
    [
        { arrangement: "alignTop", label: "靠上", title: "對齊上緣" },
        { arrangement: "alignCenterY", label: "上下置中", title: "上下置中對齊" },
        { arrangement: "alignBottom", label: "靠下", title: "對齊下緣" },
    ],
    [
        { arrangement: "distributeX", label: "水平均分", title: "水平平均分布（至少 3 張）", minCount: 3 },
        { arrangement: "distributeY", label: "垂直均分", title: "垂直平均分布（至少 3 張）", minCount: 3 },
    ],
    [{ arrangement: "grid", label: "格狀", title: "排成間距一致的格狀" }],
];

interface ArrangeBarProps {
    count: number;
    onArrange: (arrangement: Arrangement) => void;
}

function ArrangeBar({ count, onArrange }: ArrangeBarProps) {
    return (
        <div className="note-format-bar arrange-bar" role="toolbar" aria-label="快速排版">
            <span className="arrange-count">已選 {count} 張</span>
            {GROUPS.map((group, index) => (
                <Fragment key={group[0].arrangement}>
                    {index > 0 && <span className="note-format-divider" />}
                    {group.map(({ arrangement, label, title, minCount = 2 }) => (
                        <button
                            key={arrangement}
                            type="button"
                            title={title}
                            disabled={count < minCount}
                            // 焦點留在原處，按完還能直接用鍵盤操作選取的筆記。
                            onMouseDown={(evt) => evt.preventDefault()}
                            onClick={() => onArrange(arrangement)}
                        >
                            {label}
                        </button>
                    ))}
                </Fragment>
            ))}
        </div>
    );
}

export default ArrangeBar;
