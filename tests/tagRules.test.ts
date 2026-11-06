import assert from "node:assert/strict";
import { test } from "node:test";
import { canCreateTag, filterByTags, tagSuggestions, tagsIn } from "../src/components/tags/tagRules.ts";
import type { Note, NoteTag } from "../src/types.ts";

const tag = (id: string, name: string): NoteTag => ({ id, name, color: "blue" });
const note = (id: string, tags: NoteTag[]): Note => ({
    id, type: "card", context: {}, content: "", updatedAt: 0, createdAt: 0, tags,
});

const rust = tag("1", "Rust");
const react = tag("2", "React");
const project = tag("3", "專案");

test("建議不含已經貼上的 Tag", () => {
    assert.deepEqual(tagSuggestions([rust, react], [rust], ""), [react]);
});

test("建議比對名稱的任何部分，不分大小寫，忽略開頭的 #", () => {
    assert.deepEqual(tagSuggestions([rust, react], [], "RE"), [react]);
    assert.deepEqual(tagSuggestions([rust, react], [], "#us"), [rust]);
});

test("只有新名稱才能建立", () => {
    assert.equal(canCreateTag([rust], "rust"), false);
    assert.equal(canCreateTag([rust], "#Rust "), false);
    assert.equal(canCreateTag([rust], "ru"), true);
    assert.equal(canCreateTag([rust], "  # "), false);
});

test("清單用到的 Tag 不重複", () => {
    const notes = [note("a", [react, rust]), note("b", [rust, project])];
    assert.deepEqual(tagsIn(notes).map((item) => item.id).sort(), ["1", "2", "3"]);
});

test("選多個 Tag 時要全部都有", () => {
    const both = note("a", [rust, react]);
    const one = note("b", [rust]);
    assert.deepEqual(filterByTags([both, one], ["1"]), [both, one]);
    assert.deepEqual(filterByTags([both, one], ["1", "2"]), [both]);
});
