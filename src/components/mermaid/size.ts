/** 放大檢視時才夠清楚，又不會讓大圖吃掉太多記憶體。 */
const RASTER_LONG_SIDE = 1600;

/** 預覽框的留白比例。 */
const FIT_MARGIN = 0.92;

/** 把圖完整放進預覽框並置中。小圖不放大，文字才不會比原本的字級大。 */
export function fitView(boxWidth: number, boxHeight: number, width: number, height: number) {
    const scale = Math.min((boxWidth * FIT_MARGIN) / Math.max(width, 1), (boxHeight * FIT_MARGIN) / Math.max(height, 1), 1);
    return { x: (boxWidth - width * scale) / 2, y: (boxHeight - height * scale) / 2, scale };
}

/** 畫到畫布前的點陣尺寸：長邊固定，維持比例，最小 1 像素。 */
export function rasterSize(width: number, height: number) {
    const scale = RASTER_LONG_SIDE / Math.max(width, height, 1);
    return {
        width: Math.max(Math.round(width * scale), 1),
        height: Math.max(Math.round(height * scale), 1),
    };
}
