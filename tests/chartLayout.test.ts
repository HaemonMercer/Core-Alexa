import assert from "node:assert/strict";
import { test } from "node:test";
import {
    CHART_KINDS, colorOf, formatTick, histogramBins, layoutChart, marksToSvg, niceTicks, SERIES_COLORS, textWidth, truncate,
} from "../src/components/chart/layout.ts";
import type { ChartData } from "../src/types.ts";

const data = (kind: string, values: (number | null)[][] = [[10, 20, 5], [8, null, 12]]): ChartData => ({
    kind,
    title: "標題",
    seriesBy: "cols",
    labels: ["一", "二", "三"],
    series: values.map((series, index) => ({ name: `數列${index}`, values: series })),
    error: null,
});

const broken = /NaN|Infinity|undefined/;
const render = (chart: ChartData, width = 480, height = 300) => marksToSvg(layoutChart(chart, width, height), width, height);

test("首版七種圖表", () => {
    assert.deepEqual(CHART_KINDS.map(({ id }) => id), ["line", "bar", "pie", "scatter", "area", "histogram", "radar"]);
});

test("刻度涵蓋資料，且落在 1、2、5 的倍數", () => {
    const ticks = niceTicks(3, 97);
    assert.ok(ticks[0] <= 3 && ticks[ticks.length - 1] >= 97);
    assert.ok([1, 2, 5, 10, 20, 50].includes(ticks[1] - ticks[0]));
});

test("全部相同或全部是零也有刻度", () => {
    assert.deepEqual(niceTicks(0, 0), [0, 1]);
    assert.ok(niceTicks(7, 7).at(-1)! >= 7);
    assert.ok(niceTicks(-7, -7)[0] <= -7);
});

test("負數範圍也涵蓋，並且經過零", () => {
    const ticks = niceTicks(-30, 45);
    assert.ok(ticks[0] <= -30 && ticks.at(-1)! >= 45);
    assert.ok(ticks.includes(0));
});

test("刻度文字用單位縮短", () => {
    assert.equal(formatTick(1500), "1500");
    assert.equal(formatTick(25000), "25K");
    assert.equal(formatTick(3200000), "3.2M");
    assert.equal(formatTick(0.125), "0.13");
});

test("直方圖的組距涵蓋所有值，總數不變", () => {
    const values = [1, 2, 2, 3, 8, 9, 10, 40];
    const bins = histogramBins(values);
    assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), values.length);
    assert.ok(bins[0].from <= 1 && bins.at(-1)!.to >= 40);
});

test("直方圖遇到相同數值與空資料", () => {
    assert.deepEqual(histogramBins([]), []);
    assert.deepEqual(histogramBins([5, 5, 5]), [{ from: 5, to: 5, count: 3 }]);
});

test("每一種都畫得出來，座標沒有 NaN", () => {
    for (const { id } of CHART_KINDS) {
        const svg = render(data(id));
        assert.ok(!broken.test(svg), id);
        assert.ok(svg.length > 300, id);
    }
});

test("只有一個資料點也畫得出來", () => {
    for (const { id } of CHART_KINDS) {
        assert.ok(!broken.test(render({ ...data(id, [[5]]), labels: ["一"] })), id);
    }
});

test("負數與零不會讓圖表壞掉", () => {
    for (const { id } of CHART_KINDS) {
        assert.ok(!broken.test(render(data(id, [[-5, 0, 12], [0, 0, 0]]))), id);
    }
});

test("很小的尺寸也不會壞掉", () => {
    for (const { id } of CHART_KINDS) {
        assert.ok(!broken.test(render(data(id), 120, 80)), id);
    }
});

test("沒有數字時顯示提示", () => {
    assert.ok(render(data("line", [[null, null]])).includes("選取的範圍沒有數字"));
});

test("來源失效時顯示原因", () => {
    assert.ok(render({ ...data("line"), error: "來源表格已被刪除" }).includes("來源表格已被刪除"));
});

test("文字會跳脫 XML", () => {
    assert.ok(render({ ...data("bar"), title: "<a&b>" }).includes("&lt;a&amp;b&gt;"));
});

test("數列太多時顏色循環使用", () => {
    assert.equal(colorOf(SERIES_COLORS.length), SERIES_COLORS[0]);
});

test("過長文字會截斷", () => {
    const short = truncate("很長很長很長很長很長很長很長", 60);
    assert.ok(short.endsWith("…"));
    assert.ok(textWidth(short) <= 60 + textWidth("…"));
    assert.equal(truncate("短", 100), "短");
});
