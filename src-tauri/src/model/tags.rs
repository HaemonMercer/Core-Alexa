//! Tag：整個工作區共用，名稱和顏色只存在工作區目錄的 `tags`。
//!
//! 筆記只記 id（筆記文件的 `tags` map），讀取時才換成名稱和顏色，所以改名、換色只寫一處。
//! 刪除 Tag 也只改目錄：筆記裡留下的 id 讀取時會略過，CRDT 合併回來的舊 id 也一樣。
//! 筆記的 `tags` 不在 Office 的復原範圍，也不改 `updatedAt`，貼 Tag 不會讓 Library 重新排序。

use super::types::{NoteTag, TagInfo};
use super::yjs::{new_id, record};
use super::Alexa;
use std::collections::HashMap;
use yrs::{Any, Doc, Map, Out, Transact};

/// 顏色名稱要和 `components/tags/tagColors.ts` 一致。
const TAG_COLORS: [&str; 8] = ["blue", "green", "orange", "purple", "red", "teal", "yellow", "gray"];
const DEFAULT_COLOR: &str = "gray";
const MAX_NAME_CHARS: usize = 40;

/// 使用者習慣打 `#標籤`，`#` 不算名稱的一部分。
fn clean_name(name: &str) -> Result<String, String> {
    let name = name.trim().trim_start_matches('#').trim();
    if name.is_empty() {
        return Err("tag name is empty".to_string());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!("Tag 名稱不能超過 {MAX_NAME_CHARS} 個字"));
    }
    Ok(name.to_string())
}

fn same_name(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

/// 筆記文件裡貼上的 Tag id。
fn note_tag_ids(doc: &Doc) -> Vec<String> {
    let tags = doc.get_or_insert_map("tags");
    let txn = doc.transact();
    tags.keys(&txn).map(str::to_string).collect()
}

impl Alexa {
    /// 依名稱排序；同名只會來自多台裝置同時建立，再用 id 固定順序。
    fn tag_directory(&self) -> Vec<NoteTag> {
        let directory = self.workspace.doc.get_or_insert_map("tags");
        let txn = self.workspace.doc.transact();
        let mut tags: Vec<NoteTag> = directory
            .iter(&txn)
            .filter_map(|(id, value)| {
                let Out::Any(Any::Map(fields)) = value else {
                    return None;
                };
                let Some(Any::String(name)) = fields.get("name") else {
                    return None;
                };
                Some(NoteTag {
                    id: id.to_string(),
                    name: name.to_string(),
                    // 新版才有的顏色在舊版顯示成灰色，不會讀不出來。
                    color: match fields.get("color") {
                        Some(Any::String(color)) if TAG_COLORS.contains(&color.as_ref()) => color.to_string(),
                        _ => DEFAULT_COLOR.to_string(),
                    },
                })
            })
            .collect();
        tags.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.id.cmp(&b.id))
        });
        tags
    }

    /// 已從目錄刪除的 id 不算。
    pub(super) fn tags_of(&self, doc: &Doc) -> Vec<NoteTag> {
        let ids = note_tag_ids(doc);
        if ids.is_empty() {
            return Vec::new();
        }
        self.tag_directory()
            .into_iter()
            .filter(|tag| ids.contains(&tag.id))
            .collect()
    }

    fn write_tag(&mut self, tag: &NoteTag) -> Result<(), String> {
        let directory = self.workspace.doc.get_or_insert_map("tags");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            directory.insert(
                &mut txn,
                tag.id.as_str(),
                record(vec![
                    ("name", Any::from(tag.name.as_str())),
                    ("color", Any::from(tag.color.as_str())),
                ]),
            );
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)
    }

    fn known_tag(&self, id: &str) -> Result<NoteTag, String> {
        self.tag_directory()
            .into_iter()
            .find(|tag| tag.id == id)
            .ok_or_else(|| format!("unknown tag: {id}"))
    }

    /// 全部的 Tag，連同用到它的筆記數。沒有筆記在用的 Tag 也留著，要由使用者自己刪除。
    pub fn tags(&mut self) -> Result<Vec<TagInfo>, String> {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for note in self.note_library()? {
            for tag in note.tags {
                *counts.entry(tag.id).or_insert(0) += 1;
            }
        }
        Ok(self
            .tag_directory()
            .into_iter()
            .map(|tag| TagInfo {
                count: counts.get(&tag.id).copied().unwrap_or(0),
                id: tag.id,
                name: tag.name,
                color: tag.color,
            })
            .collect())
    }

    /// 名稱已存在就用原本的 Tag（不分大小寫），否則建立新的，顏色依序輪流。
    pub fn add_note_tag(&mut self, note_id: &str, name: &str) -> Result<NoteTag, String> {
        if !self.in_library(note_id) {
            return Err(format!("unknown note: {note_id}"));
        }
        let name = clean_name(name)?;
        let directory = self.tag_directory();
        let tag = match directory.iter().find(|tag| same_name(&tag.name, &name)) {
            Some(tag) => tag.clone(),
            None => {
                let tag = NoteTag {
                    id: new_id(),
                    name,
                    color: TAG_COLORS[directory.len() % TAG_COLORS.len()].to_string(),
                };
                self.write_tag(&tag)?;
                tag
            }
        };
        self.ensure_note(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let tags = note.doc.get_or_insert_map("tags");
        let update = {
            let mut txn = note.doc.transact_mut();
            tags.insert(&mut txn, tag.id.as_str(), true);
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;
        Ok(tag)
    }

    pub fn remove_note_tag(&mut self, note_id: &str, tag_id: &str) -> Result<(), String> {
        if !self.in_library(note_id) {
            return Err(format!("unknown note: {note_id}"));
        }
        self.ensure_note(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let tags = note.doc.get_or_insert_map("tags");
        let update = {
            let mut txn = note.doc.transact_mut();
            tags.remove(&mut txn, tag_id);
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)
    }

    /// 不能改成別的 Tag 已經在用的名稱。只改大小寫是同一個 Tag，可以。
    pub fn rename_tag(&mut self, id: &str, name: &str) -> Result<(), String> {
        let mut tag = self.known_tag(id)?;
        let name = clean_name(name)?;
        if self
            .tag_directory()
            .iter()
            .any(|other| other.id != id && same_name(&other.name, &name))
        {
            return Err(format!("已經有名為「{name}」的 Tag"));
        }
        tag.name = name;
        self.write_tag(&tag)
    }

    pub fn set_tag_color(&mut self, id: &str, color: &str) -> Result<(), String> {
        let mut tag = self.known_tag(id)?;
        if !TAG_COLORS.contains(&color) {
            return Err(format!("unknown tag color: {color}"));
        }
        tag.color = color.to_string();
        self.write_tag(&tag)
    }

    /// 永久刪除 Tag，筆記本身不受影響。
    pub fn delete_tag(&mut self, id: &str) -> Result<(), String> {
        self.known_tag(id)?;
        let directory = self.workspace.doc.get_or_insert_map("tags");
        let update = {
            let mut txn = self.workspace.doc.transact_mut();
            directory.remove(&mut txn, id);
            txn.encode_update_v1()
        };
        self.workspace.save(&mut self.conn, update)
    }
}
