/** 範本選單。內容要能直接渲染，換 Mermaid 版本時要重新確認。 */
export const TEMPLATES = [
    {
        id: "flowchart",
        label: "流程圖",
        source: "flowchart TD\n    A[開始] --> B{判斷}\n    B -->|是| C[完成]\n    B -->|否| A",
    },
    {
        id: "sequence",
        label: "循序圖",
        source: "sequenceDiagram\n    participant 使用者\n    participant 伺服器\n    使用者->>伺服器: 送出請求\n    伺服器-->>使用者: 回傳結果",
    },
    {
        id: "class",
        label: "類別圖",
        source: "classDiagram\n    class Note {\n        +String id\n        +String content\n    }\n    class Card\n    Note <|-- Card",
    },
    {
        id: "state",
        label: "狀態圖",
        source: "stateDiagram-v2\n    [*] --> 草稿\n    草稿 --> 已發布: 發布\n    已發布 --> [*]",
    },
    {
        id: "er",
        label: "ER 圖",
        source: "erDiagram\n    WHITEBOARD ||--o{ PLACED_NOTE : contains\n    NOTE ||--o{ PLACED_NOTE : placed",
    },
    {
        id: "gantt",
        label: "甘特圖",
        source: "gantt\n    title 專案時程\n    dateFormat YYYY-MM-DD\n    section 第一階段\n    設計 :a1, 2026-01-01, 7d\n    開發 :after a1, 14d",
    },
    {
        id: "pie",
        label: "圓餅圖",
        source: "pie title 時間分配\n    \"開發\" : 60\n    \"測試\" : 30\n    \"文件\" : 10",
    },
    {
        id: "mindmap",
        label: "心智圖",
        source: "mindmap\n    root((主題))\n        分支一\n            細節\n        分支二",
    },
];

/** Mermaid 的錯誤訊息裡的行號，例如 `Parse error on line 3:`。找不到時回傳 null。 */
export function errorLine(message: string) {
    const found = /\bline (\d+)/i.exec(message);
    return found ? Number(found[1]) : null;
}
