/** 浮在畫布上時的位置；沒有提供時，編輯器放在父層版面裡。 */
export interface EditorPlacement {
    left: number;
    top: number;
    width: number;
    height: number;
    scale: number;
    /** 高度跟著內容；否則固定在 `height`，內容在裡面捲動。 */
    fitContent: boolean;
    paddingTop: number;
}
