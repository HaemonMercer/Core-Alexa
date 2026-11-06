export const SHAPES: { id: string; label: string }[] = [
    { id: "rect", label: "矩形" },
    { id: "round", label: "圓角矩形" },
    { id: "ellipse", label: "橢圓" },
    { id: "triangle", label: "三角形" },
    { id: "arrow", label: "箭頭" },
    { id: "line", label: "線條" },
];

/** SVG 路徑。畫面與白板預覽共用同一份，形狀不會不一致。 */
export function shapePath(shape: string, x: number, y: number, w: number, h: number): string {
    switch (shape) {
        case "ellipse": {
            const rx = w / 2;
            const ry = h / 2;
            return `M${x} ${y + ry}A${rx} ${ry} 0 1 1 ${x + w} ${y + ry}A${rx} ${ry} 0 1 1 ${x} ${y + ry}Z`;
        }
        case "triangle":
            return `M${x + w / 2} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
        case "arrow": {
            const head = Math.min(w * 0.4, h);
            const top = y + h * 0.28;
            const bottom = y + h * 0.72;
            const neck = x + w - head;
            return `M${x} ${top}L${neck} ${top}L${neck} ${y}L${x + w} ${y + h / 2}L${neck} ${y + h}L${neck} ${bottom}L${x} ${bottom}Z`;
        }
        case "line":
            return `M${x} ${y + h / 2}L${x + w} ${y + h / 2}`;
        case "round": {
            const r = Math.min(w, h) * 0.12;
            return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
        }
        default:
            return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    }
}
