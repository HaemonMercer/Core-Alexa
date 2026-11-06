import type { ChartData, ChartSeries } from "../../types.ts";

// 七種圖表的版面計算，全部是純函式：輸入資料與尺寸，輸出要畫的圖形。
// 繪製方式（SVG、畫布）與資料無關，換尺寸只要重算一次。

export type ChartKind = "line" | "bar" | "pie" | "scatter" | "area" | "histogram" | "radar";

export const CHART_KINDS: { id: ChartKind; label: string }[] = [
    { id: "line", label: "折線圖" },
    { id: "bar", label: "橫條圖" },
    { id: "pie", label: "圓餅圖" },
    { id: "scatter", label: "散佈圖" },
    { id: "area", label: "面積圖" },
    { id: "histogram", label: "直方圖" },
    { id: "radar", label: "雷達圖" },
];

/** 順序固定，數列永遠從第一格開始用。顏色通過色盲檢查。 */
export const SERIES_COLORS = [
    "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948",
];
const SURFACE = "#ffffff";
const INK = "#1f2328";
const MUTED = "#57606a";
const GRID = "#e8e7e3";
const FONT_SIZE = 12;
const TITLE_SIZE = 15;
const TITLE_HEIGHT = 30;
const LEGEND_ROW = 20;
const MARGIN = 14;
const TICK_COUNT = 5;
/** 中文字大約一個字高，英數約一半。 */
const CJK = /[　-鿿＀-￯]/;

export type Mark =
    | { t: "line"; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
    | { t: "path"; d: string; fill: string; stroke: string; width: number; opacity?: number; label?: string }
    | { t: "rect"; x: number; y: number; w: number; h: number; fill: string; radius: number; label?: string }
    | { t: "circle"; x: number; y: number; r: number; fill: string; stroke?: string; label?: string }
    | { t: "text"; x: number; y: number; text: string; size: number; fill: string; anchor: "start" | "middle" | "end"; weight?: number };

export function textWidth(text: string, size = FONT_SIZE): number {
    let width = 0;
    for (const char of text) width += CJK.test(char) ? size : size * 0.56;
    return width;
}

export function truncate(text: string, width: number, size = FONT_SIZE): string {
    if (textWidth(text, size) <= width) return text;
    let result = "";
    for (const char of text) {
        if (textWidth(`${result}${char}…`, size) > width) break;
        result += char;
    }
    return `${result}…`;
}

/** 落在 1、2、5 倍數上的刻度，範圍一定涵蓋資料。 */
export function niceTicks(min: number, max: number, count = TICK_COUNT): number[] {
    if (min === max) {
        if (min === 0) return [0, 1];
        max = min > 0 ? min * 2 : 0;
        min = min > 0 ? 0 : min * 2;
    }
    const rough = (max - min) / Math.max(1, count - 1);
    const power = 10 ** Math.floor(Math.log10(rough));
    const fraction = rough / power;
    const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
    const start = Math.floor(min / step) * step;
    const ticks: number[] = [];
    for (let tick = start; tick < max + step * 0.999; tick += step) ticks.push(Number(tick.toFixed(10)));
    return ticks;
}

export function formatTick(value: number): string {
    const size = Math.abs(value);
    if (size >= 1e9) return `${Number((value / 1e9).toFixed(1))}B`;
    if (size >= 1e6) return `${Number((value / 1e6).toFixed(1))}M`;
    if (size >= 1e4) return `${Number((value / 1e3).toFixed(1))}K`;
    return String(Number(value.toFixed(2)));
}

const numbers = (series: ChartSeries[]) =>
    series.flatMap((item) => item.values.filter((value): value is number => value !== null));

interface Plot {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Frame {
    marks: Mark[];
    plot: Plot;
}

/** 標題與圖例，回傳剩下給圖表的區域。一個數列時不需要圖例，標題就是它的名字。 */
function frame(title: string, names: string[], width: number, height: number): Frame {
    const marks: Mark[] = [];
    let top = MARGIN;
    if (title) {
        marks.push({ t: "text", x: MARGIN, y: top + TITLE_SIZE - 2, text: truncate(title, width - MARGIN * 2, TITLE_SIZE), size: TITLE_SIZE, fill: INK, anchor: "start", weight: 600 });
        top += TITLE_HEIGHT;
    }
    if (names.length >= 2) {
        let x = MARGIN;
        let y = top;
        names.forEach((name, index) => {
            const label = truncate(name, 110);
            const itemWidth = textWidth(label) + 24;
            if (x + itemWidth > width - MARGIN && x > MARGIN) {
                x = MARGIN;
                y += LEGEND_ROW;
            }
            marks.push({ t: "rect", x, y: y + 1, w: 10, h: 10, fill: colorOf(index), radius: 2 });
            marks.push({ t: "text", x: x + 14, y: y + 10, text: label, size: FONT_SIZE, fill: MUTED, anchor: "start" });
            x += itemWidth;
        });
        top = y + LEGEND_ROW;
    }
    return { marks, plot: { x: MARGIN, y: top, w: width - MARGIN * 2, h: height - top - MARGIN } };
}

/** 超過八個數列時不產生新顏色，交給呼叫端略過或合併。 */
export const colorOf = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

function valueAxis(marks: Mark[], plot: Plot, ticks: number[], toY: (value: number) => number): number {
    const labels = ticks.map(formatTick);
    const gutter = Math.max(...labels.map((label) => textWidth(label))) + 8;
    ticks.forEach((tick, index) => {
        const y = toY(tick);
        marks.push({ t: "line", x1: plot.x + gutter, y1: y, x2: plot.x + plot.w, y2: y, stroke: GRID, width: 1 });
        marks.push({ t: "text", x: plot.x + gutter - 6, y: y + 4, text: labels[index], size: FONT_SIZE, fill: MUTED, anchor: "end" });
    });
    return gutter;
}

/** 類別太多時間隔標示，文字才不會疊在一起。 */
function categoryLabels(marks: Mark[], labels: string[], xOf: (index: number) => number, y: number, spacing: number) {
    const longest = Math.max(...labels.map((label) => textWidth(label)), 1);
    const skip = Math.max(1, Math.ceil(Math.min(longest + 8, 90) / Math.max(spacing, 1)));
    labels.forEach((label, index) => {
        if (index % skip !== 0) return;
        marks.push({ t: "text", x: xOf(index), y, text: truncate(label, Math.max(spacing * skip - 6, 28)), size: FONT_SIZE, fill: MUTED, anchor: "middle" });
    });
}

function lineOrArea(data: ChartData, width: number, height: number, area: boolean): Mark[] {
    const { marks, plot } = frame(data.title, data.series.map((item) => item.name), width, height);
    const values = numbers(data.series);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const bottom = plot.y + plot.h - 20;
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const toY = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - plot.y - 6);
    const gutter = valueAxis(marks, plot, ticks, toY);
    const left = plot.x + gutter + 4;
    const count = data.labels.length;
    const spacing = count > 1 ? (plot.x + plot.w - left - 8) / (count - 1) : 0;
    const toX = (index: number) => (count > 1 ? left + index * spacing : left + (plot.w - gutter) / 2);
    categoryLabels(marks, data.labels, toX, bottom + 16, spacing || plot.w);

    data.series.forEach((item, index) => {
        const color = colorOf(index);
        const points = item.values
            .map((value, at) => (value === null ? null : { x: toX(at), y: toY(value), at, value }))
            .filter((point) => point !== null);
        if (points.length === 0) return;
        const line = points.map((point, at) => `${at === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join("");
        if (area) {
            const base = toY(Math.max(low, 0));
            const closed = `${line}L${points[points.length - 1].x.toFixed(1)} ${base.toFixed(1)}L${points[0].x.toFixed(1)} ${base.toFixed(1)}Z`;
            marks.push({ t: "path", d: closed, fill: color, stroke: "none", width: 0, opacity: 0.22 });
        }
        marks.push({ t: "path", d: line, fill: "none", stroke: color, width: 2 });
        // 標記的尺寸照顧到只有一個點、畫不出線的情況。
        for (const point of points) {
            const label = `${item.name} · ${data.labels[point.at] ?? ""}：${formatTick(point.value)}`;
            marks.push({ t: "circle", x: point.x, y: point.y, r: 3.5, fill: color, stroke: SURFACE, label });
        }
    });
    return marks;
}

function bars(data: ChartData, width: number, height: number): Mark[] {
    const { marks, plot } = frame(data.title, data.series.map((item) => item.name), width, height);
    const values = numbers(data.series);
    const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const gutter = Math.min(Math.max(...data.labels.map((label) => textWidth(label)), 20) + 10, plot.w * 0.32);
    const left = plot.x + gutter;
    const right = plot.x + plot.w - 12;
    const toX = (value: number) => left + ((value - low) / (high - low)) * (right - left);
    const bottom = plot.y + plot.h - 20;

    ticks.forEach((tick) => {
        const x = toX(tick);
        marks.push({ t: "line", x1: x, y1: plot.y, x2: x, y2: bottom, stroke: GRID, width: 1 });
        marks.push({ t: "text", x, y: bottom + 16, text: formatTick(tick), size: FONT_SIZE, fill: MUTED, anchor: "middle" });
    });
    const groups = Math.max(data.labels.length, 1);
    const groupHeight = (bottom - plot.y) / groups;
    const seriesCount = Math.max(data.series.length, 1);
    const barHeight = Math.max(Math.min((groupHeight - 8) / seriesCount - 2, 24), 3);
    const zero = toX(Math.max(low, 0));
    data.labels.forEach((label, group) => {
        const center = plot.y + groupHeight * (group + 0.5);
        marks.push({ t: "text", x: left - 8, y: center + 4, text: truncate(label, gutter - 10), size: FONT_SIZE, fill: MUTED, anchor: "end" });
        const total = seriesCount * barHeight + (seriesCount - 1) * 2;
        data.series.forEach((item, index) => {
            const value = item.values[group];
            if (value === null || value === undefined) return;
            const x = toX(value);
            const y = center - total / 2 + index * (barHeight + 2);
            const tip = `${item.name} · ${label}：${formatTick(value)}`;
            marks.push({ t: "rect", x: Math.min(x, zero), y, w: Math.max(Math.abs(x - zero), 1), h: barHeight, fill: colorOf(index), radius: 3, label: tip });
        });
    });
    return marks;
}

function wedge(cx: number, cy: number, r: number, from: number, to: number): string {
    const point = (angle: number) => `${(cx + r * Math.sin(angle)).toFixed(2)} ${(cy - r * Math.cos(angle)).toFixed(2)}`;
    // 整圈時終點等於起點，弧線會畫不出來，拆成兩半。
    if (to - from >= Math.PI * 2 - 1e-6) {
        return `M${point(0)}A${r} ${r} 0 1 1 ${point(Math.PI)}A${r} ${r} 0 1 1 ${point(0)}Z`;
    }
    const large = to - from > Math.PI ? 1 : 0;
    return `M${cx} ${cy}L${point(from)}A${r} ${r} 0 ${large} 1 ${point(to)}Z`;
}

function pie(data: ChartData, width: number, height: number): Mark[] {
    const series = data.series[0];
    const slices = (series?.values ?? [])
        .map((value, index) => ({ value: value ?? 0, label: data.labels[index] ?? "", index }))
        .filter((slice) => slice.value > 0);
    const { marks, plot } = frame(data.title, slices.map((slice) => slice.label), width, height);
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    if (total === 0) return [...marks, emptyNote(width, height)];
    const r = Math.max(Math.min(plot.w, plot.h) / 2 - 6, 10);
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    let angle = 0;
    slices.forEach((slice, order) => {
        const share = slice.value / total;
        const next = angle + share * Math.PI * 2;
        const tip = `${slice.label}：${formatTick(slice.value)}（${(share * 100).toFixed(1)}%）`;
        marks.push({ t: "path", d: wedge(cx, cy, r, angle, next), fill: colorOf(order), stroke: SURFACE, width: 2, label: tip });
        if (share >= 0.06) {
            const middle = (angle + next) / 2;
            marks.push({
                t: "text",
                x: cx + r * 0.64 * Math.sin(middle),
                y: cy - r * 0.64 * Math.cos(middle) + 4,
                text: `${Math.round(share * 100)}%`,
                size: FONT_SIZE,
                // 黃色上用深色字，其他用白字。
                fill: colorOf(order) === SERIES_COLORS[3] ? "#0b0b0b" : "#ffffff",
                anchor: "middle",
                weight: 600,
            });
        }
        angle = next;
    });
    return marks;
}

/** 第一個數列當 X，其餘每個數列是一組點。 */
function scatter(data: ChartData, width: number, height: number): Mark[] {
    const [xSeries, ...rest] = data.series;
    const ySeries = rest.length > 0 ? rest : data.series;
    const useIndex = rest.length === 0;
    const { marks, plot } = frame(data.title, ySeries.map((item) => item.name), width, height);
    const xValue = (at: number) => (useIndex ? at + 1 : xSeries?.values[at] ?? null);
    const xs = (xSeries?.values ?? []).map((_, at) => xValue(at)).filter((value) => value !== null);
    const ys = numbers(ySeries);
    if (xs.length === 0 || ys.length === 0) return [...marks, emptyNote(width, height)];
    const yTicks = niceTicks(Math.min(...ys), Math.max(...ys));
    const xTicks = niceTicks(Math.min(...xs), Math.max(...xs));
    const bottom = plot.y + plot.h - 20;
    const yLow = yTicks[0];
    const yHigh = yTicks[yTicks.length - 1];
    const toY = (value: number) => bottom - ((value - yLow) / (yHigh - yLow)) * (bottom - plot.y - 6);
    const gutter = valueAxis(marks, plot, yTicks, toY);
    const left = plot.x + gutter + 4;
    const right = plot.x + plot.w - 8;
    const xLow = xTicks[0];
    const xHigh = xTicks[xTicks.length - 1];
    const toX = (value: number) => left + ((value - xLow) / (xHigh - xLow)) * (right - left);
    xTicks.forEach((tick) => {
        marks.push({ t: "text", x: toX(tick), y: bottom + 16, text: formatTick(tick), size: FONT_SIZE, fill: MUTED, anchor: "middle" });
    });
    ySeries.forEach((item, index) => {
        item.values.forEach((value, at) => {
            const x = xValue(at);
            if (value === null || x === null) return;
            const label = `${item.name}：(${formatTick(x)}, ${formatTick(value)})`;
            marks.push({ t: "circle", x: toX(x), y: toY(value), r: 4.5, fill: colorOf(index), stroke: SURFACE, label });
        });
    });
    return marks;
}

/** 依 Sturges 公式決定組數，所有數列的值視為同一批資料。 */
export function histogramBins(values: number[]): { from: number; to: number; count: number }[] {
    if (values.length === 0) return [];
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ from: min, to: max, count: values.length }];
    const groups = Math.ceil(Math.log2(values.length)) + 1;
    const ticks = niceTicks(min, max, groups + 1);
    const bins = ticks.slice(0, -1).map((from, index) => ({ from, to: ticks[index + 1], count: 0 }));
    for (const value of values) {
        const at = bins.findIndex((bin) => value < bin.to);
        bins[at === -1 ? bins.length - 1 : at].count += 1;
    }
    return bins;
}

function histogram(data: ChartData, width: number, height: number): Mark[] {
    const { marks, plot } = frame(data.title, [], width, height);
    const bins = histogramBins(numbers(data.series));
    if (bins.length === 0) return [...marks, emptyNote(width, height)];
    const ticks = niceTicks(0, Math.max(...bins.map((bin) => bin.count)));
    const bottom = plot.y + plot.h - 20;
    const high = ticks[ticks.length - 1];
    const toY = (value: number) => bottom - (value / high) * (bottom - plot.y - 6);
    const gutter = valueAxis(marks, plot, ticks, toY);
    const left = plot.x + gutter + 4;
    const spacing = (plot.x + plot.w - left) / bins.length;
    bins.forEach((bin, index) => {
        const y = toY(bin.count);
        const label = `${formatTick(bin.from)} – ${formatTick(bin.to)}：${bin.count} 筆`;
        marks.push({ t: "rect", x: left + index * spacing + 1, y, w: Math.max(spacing - 2, 1), h: Math.max(bottom - y, 1), fill: colorOf(0), radius: 2, label });
    });
    categoryLabels(marks, bins.map((bin) => formatTick(bin.from)), (index) => left + index * spacing, bottom + 16, spacing);
    return marks;
}

function radar(data: ChartData, width: number, height: number): Mark[] {
    const { marks, plot } = frame(data.title, data.series.map((item) => item.name), width, height);
    const axes = data.labels.length;
    const values = numbers(data.series);
    if (axes < 3 || values.length === 0) return [...marks, emptyNote(width, height, "雷達圖至少需要三個類別")];
    const ticks = niceTicks(0, Math.max(...values, 0));
    const high = ticks[ticks.length - 1];
    const cx = plot.x + plot.w / 2;
    const cy = plot.y + plot.h / 2;
    const r = Math.max(Math.min(plot.w / 2 - 50, plot.h / 2 - 18), 20);
    const point = (axis: number, value: number) => {
        const angle = (axis / axes) * Math.PI * 2;
        const distance = (Math.max(value, 0) / high) * r;
        return { x: cx + distance * Math.sin(angle), y: cy - distance * Math.cos(angle) };
    };
    const ring = (value: number) => {
        const corners = Array.from({ length: axes }, (_, axis) => point(axis, value));
        return `${corners.map(({ x, y }, at) => `${at === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}Z`;
    };
    ticks.slice(1).forEach((tick) => {
        marks.push({ t: "path", d: ring(tick), fill: "none", stroke: GRID, width: 1 });
        const { x, y } = point(0, tick);
        marks.push({ t: "text", x: x + 4, y: y + 4, text: formatTick(tick), size: FONT_SIZE - 1, fill: MUTED, anchor: "start" });
    });
    data.labels.forEach((label, axis) => {
        const outer = point(axis, high);
        marks.push({ t: "line", x1: cx, y1: cy, x2: outer.x, y2: outer.y, stroke: GRID, width: 1 });
        const place = point(axis, high * 1.1);
        const anchor = Math.abs(place.x - cx) < 4 ? "middle" : place.x > cx ? "start" : "end";
        marks.push({ t: "text", x: place.x, y: place.y + 4, text: truncate(label, 80), size: FONT_SIZE, fill: MUTED, anchor });
    });
    data.series.forEach((item, index) => {
        const color = colorOf(index);
        const corners = item.values.map((value, axis) => point(axis, value ?? 0));
        const d = `${corners.map(({ x, y }, at) => `${at === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join("")}Z`;
        marks.push({ t: "path", d, fill: color, stroke: color, width: 2, opacity: 0.18 });
        corners.forEach(({ x, y }, axis) => {
            const label = `${item.name} · ${data.labels[axis]}：${formatTick(item.values[axis] ?? 0)}`;
            marks.push({ t: "circle", x, y, r: 3.5, fill: color, stroke: SURFACE, label });
        });
    });
    return marks;
}

function emptyNote(width: number, height: number, text = "選取的範圍沒有數字"): Mark {
    return { t: "text", x: width / 2, y: height / 2, text, size: 13, fill: MUTED, anchor: "middle" };
}

export function layoutChart(data: ChartData, width: number, height: number): Mark[] {
    if (data.error) return [emptyNote(width, height, data.error)];
    if (data.series.length === 0 || numbers(data.series).length === 0) {
        return [...frame(data.title, [], width, height).marks, emptyNote(width, height)];
    }
    switch (data.kind) {
        case "bar":
            return bars(data, width, height);
        case "pie":
            return pie(data, width, height);
        case "scatter":
            return scatter(data, width, height);
        case "area":
            return lineOrArea(data, width, height, true);
        case "histogram":
            return histogram(data, width, height);
        case "radar":
            return radar(data, width, height);
        default:
            return lineOrArea(data, width, height, false);
    }
}

const escapeXml = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 給畫布預覽用的 SVG 字串。 */
export function marksToSvg(marks: Mark[], width: number, height: number): string {
    const body = marks.map((mark) => {
        switch (mark.t) {
            case "line":
                return `<line x1="${mark.x1}" y1="${mark.y1}" x2="${mark.x2}" y2="${mark.y2}" stroke="${mark.stroke}" stroke-width="${mark.width}"/>`;
            case "path": {
                // 半透明只作用在填色，外框維持實色。
                const opacity = mark.opacity === undefined ? "" : ` fill-opacity="${mark.opacity}"`;
                return `<path d="${mark.d}" fill="${mark.fill}"${opacity} stroke="${mark.stroke}" stroke-width="${mark.width}"/>`;
            }
            case "rect":
                return `<rect x="${mark.x}" y="${mark.y}" width="${mark.w}" height="${mark.h}" rx="${mark.radius}" fill="${mark.fill}"/>`;
            case "circle":
                return `<circle cx="${mark.x}" cy="${mark.y}" r="${mark.r}" fill="${mark.fill}" stroke="${mark.stroke ?? "none"}"/>`;
            case "text":
                return `<text x="${mark.x}" y="${mark.y}" font-size="${mark.size}" fill="${mark.fill}" text-anchor="${mark.anchor}" font-weight="${mark.weight ?? 400}">${escapeXml(mark.text)}</text>`;
        }
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Segoe UI, Microsoft JhengHei, sans-serif">${body}</svg>`;
}
