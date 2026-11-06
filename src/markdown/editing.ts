// 編輯指令的統一入口，實作依職責分在 editing/ 裡。

export { deleteSelection, insertCaretHolder, isAtLeafEnd, isCollapsed, selectionRange, spansLeaves } from "./editing/document.ts";
export type { Doc, Point, Selection } from "./editing/document.ts";
export * from "./editing/typing.ts";
export * from "./editing/inline.ts";
export * from "./editing/blocks.ts";
export * from "./editing/inputRules.ts";
