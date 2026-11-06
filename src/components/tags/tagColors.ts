import type { CSSProperties } from "react";

// 名稱要和 model/tags.rs 的 TAG_COLORS 一致；實際色值只屬於畫面，存在這裡。

export interface TagColor {
    name: string;
    label: string;
    /** 畫布上的色條與色票。 */
    solid: string;
    soft: string;
    ink: string;
}

export const TAG_COLORS: TagColor[] = [
    { name: "blue", label: "藍色", solid: "#4a7fd6", soft: "#e4edfb", ink: "#23508f" },
    { name: "teal", label: "青色", solid: "#2a9d9d", soft: "#dff3f2", ink: "#17625f" },
    { name: "green", label: "綠色", solid: "#4c9a5b", soft: "#e4f3e6", ink: "#2c6438" },
    { name: "yellow", label: "黃色", solid: "#d4a72c", soft: "#fbf2d5", ink: "#7a5c00" },
    { name: "orange", label: "橘色", solid: "#e0813a", soft: "#fcebdc", ink: "#94481a" },
    { name: "red", label: "紅色", solid: "#d9534f", soft: "#fbe4e3", ink: "#a02c2c" },
    { name: "purple", label: "紫色", solid: "#8a63d2", soft: "#eee6fa", ink: "#5a3a9e" },
    { name: "gray", label: "灰色", solid: "#8a8f98", soft: "#eceded", ink: "#4d5259" },
];

const GRAY = TAG_COLORS[TAG_COLORS.length - 1];

export const tagColor = (name: string) => TAG_COLORS.find((color) => color.name === name) ?? GRAY;

/** 色值交給 CSS 變數，`.tag-chip` 這些樣式才留在 App.css。 */
export function tagStyle(name: string): CSSProperties {
    const { solid, soft, ink } = tagColor(name);
    return { "--tag-solid": solid, "--tag-soft": soft, "--tag-ink": ink } as CSSProperties;
}
