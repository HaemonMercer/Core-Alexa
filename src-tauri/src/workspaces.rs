//! Workspace 是彼此完全隔離的資料空間。
//!
//! 每個 Workspace 有自己的資料庫和媒體資料夾，所以白板、筆記、標籤和檔案都不會互通。
//! 最早的 Workspace 就是資料位置本身，原有的資料不用搬動；其他的放在
//! `workspaces/<id>/`。清單寫在資料位置的 `workspaces.json`，沒有這個檔案就只有一個。
//!
//! 一次只開一個 Workspace，切換時重新啟動程式，前端和記憶體裡不會留下上一個的內容。

use crate::data_location::{self, DATABASE_FILE};
use crate::model::Alexa;
use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const ORIGINAL_ID: &str = "default";
const ORIGINAL_NAME: &str = "我的 Workspace";
const MANIFEST_FILE: &str = "workspaces.json";
pub const WORKSPACES_FOLDER: &str = "workspaces";
const NAME_LIMIT: usize = 60;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceList {
    pub active_id: String,
    pub items: Vec<WorkspaceEntry>,
}

pub struct Workspaces {
    root: PathBuf,
    list: WorkspaceList,
}

fn folder_in(root: &Path, id: &str) -> PathBuf {
    if id == ORIGINAL_ID {
        root.to_path_buf()
    } else {
        root.join(WORKSPACES_FOLDER).join(id)
    }
}

/// 先寫暫存檔再改名，中途失敗時舊的清單還在。
fn write_manifest(root: &Path, list: &WorkspaceList) -> Result<(), String> {
    let part = root.join(format!("{MANIFEST_FILE}.part"));
    let text = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    fs::write(&part, text).map_err(|e| e.to_string())?;
    fs::rename(&part, root.join(MANIFEST_FILE)).map_err(|e| e.to_string())
}

/// 讀不懂的清單當作只有最早的 Workspace。資料夾還在，修好檔案就回來。
fn read_manifest(root: &Path) -> WorkspaceList {
    let original = WorkspaceEntry { id: ORIGINAL_ID.to_string(), name: ORIGINAL_NAME.to_string() };
    let mut list = fs::read(root.join(MANIFEST_FILE))
        .ok()
        .and_then(|text| serde_json::from_slice::<WorkspaceList>(&text).ok())
        .unwrap_or_else(|| WorkspaceList { active_id: ORIGINAL_ID.to_string(), items: Vec::new() });
    // id 會變成資料夾路徑，刪除時也靠它，手動改過的檔案不能指到別的地方。
    list.items.retain(|item| item.id == ORIGINAL_ID || Uuid::parse_str(&item.id).is_ok());
    if !list.items.iter().any(|item| item.id == ORIGINAL_ID) {
        list.items.insert(0, original);
    }
    let opens = list.items.iter().any(|item| item.id == list.active_id)
        && folder_in(root, &list.active_id).join(DATABASE_FILE).is_file();
    if !opens {
        list.active_id = ORIGINAL_ID.to_string();
    }
    list
}

impl Workspaces {
    pub fn load(root: &Path) -> Self {
        Self { root: root.to_path_buf(), list: read_manifest(root) }
    }

    pub fn list(&self) -> &WorkspaceList {
        &self.list
    }

    /// 目前開著的 Workspace 的資料夾。
    pub fn active_folder(&self) -> PathBuf {
        folder_in(&self.root, &self.list.active_id)
    }

    fn checked_name(&self, name: &str, except: Option<&str>) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("請輸入名稱".to_string());
        }
        if name.chars().count() > NAME_LIMIT {
            return Err(format!("名稱最多 {NAME_LIMIT} 個字"));
        }
        let lower = name.to_lowercase();
        let taken = self
            .list
            .items
            .iter()
            .any(|item| Some(item.id.as_str()) != except && item.name.to_lowercase() == lower);
        if taken {
            return Err("已經有同名的 Workspace".to_string());
        }
        Ok(name.to_string())
    }

    fn contains(&self, id: &str) -> Result<(), String> {
        if self.list.items.iter().any(|item| item.id == id) {
            Ok(())
        } else {
            Err("找不到這個 Workspace".to_string())
        }
    }

    /// 建立空的 Workspace 並設為下次開啟的對象。
    pub fn create(&mut self, name: &str) -> Result<(), String> {
        let name = self.checked_name(name, None)?;
        let id = Uuid::new_v4().to_string();
        let folder = folder_in(&self.root, &id);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        // 先確定資料庫建得起來，失敗時清單不會多出打不開的項目。
        if let Err(reason) = Alexa::open(&folder.join(DATABASE_FILE)) {
            let _ = fs::remove_dir_all(&folder);
            return Err(reason);
        }
        self.list.items.push(WorkspaceEntry { id: id.clone(), name });
        self.list.active_id = id;
        write_manifest(&self.root, &self.list)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        self.contains(id)?;
        let name = self.checked_name(name, Some(id))?;
        if let Some(item) = self.list.items.iter_mut().find(|item| item.id == id) {
            item.name = name;
        }
        write_manifest(&self.root, &self.list)
    }

    /// 設為下次開啟的對象。
    pub fn activate(&mut self, id: &str) -> Result<(), String> {
        self.contains(id)?;
        if !folder_in(&self.root, id).join(DATABASE_FILE).is_file() {
            return Err("這個 Workspace 的資料不見了".to_string());
        }
        self.list.active_id = id.to_string();
        write_manifest(&self.root, &self.list)
    }

    /// 永久刪除一個 Workspace 的所有內容。
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.contains(id)?;
        if id == ORIGINAL_ID {
            return Err("最早的 Workspace 不能刪除".to_string());
        }
        if id == self.list.active_id {
            return Err("請先切換到別的 Workspace".to_string());
        }
        self.list.items.retain(|item| item.id != id);
        write_manifest(&self.root, &self.list)?;
        fs::remove_dir_all(folder_in(&self.root, id)).map_err(|e| e.to_string())
    }

    /// 換資料位置時，每個 Workspace 的媒體都要帶走。
    pub fn copy_media(&self, target: &Path) -> Result<(), String> {
        for item in &self.list.items {
            data_location::copy_media(&folder_in(&self.root, &item.id), &folder_in(target, &item.id))?;
        }
        Ok(())
    }

    /// 開著的資料庫要透過 `active` 複製，才拿得到還沒寫回主檔的內容。
    /// 最早的 Workspace 排最後：目標資料夾有 `alexa.db` 就算有資料，不能在複製完之前出現。
    pub fn copy_databases(&self, active: &Alexa, target: &Path) -> Result<(), String> {
        for item in self.list.items.iter().filter(|item| item.id != ORIGINAL_ID) {
            self.copy_database(item, active, target)?;
        }
        write_manifest(target, &self.list)?;
        let original = self.list.items.iter().find(|item| item.id == ORIGINAL_ID);
        original.map_or(Ok(()), |item| self.copy_database(item, active, target))
    }

    fn copy_database(&self, item: &WorkspaceEntry, active: &Alexa, target: &Path) -> Result<(), String> {
        let to = folder_in(target, &item.id);
        fs::create_dir_all(&to).map_err(|e| e.to_string())?;
        if item.id == self.list.active_id {
            return active.copy_database(&to);
        }
        let source = folder_in(&self.root, &item.id).join(DATABASE_FILE);
        let conn = storage::open(&source).map_err(|e| e.to_string())?;
        data_location::copy_database(&conn, &to)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::NoteType;

    fn folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("alexa-workspaces-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 像程式啟動那樣打開目前的 Workspace。
    fn open(root: &Path) -> (Workspaces, Alexa) {
        let spaces = Workspaces::load(root);
        let alexa = Alexa::open(&spaces.active_folder().join(DATABASE_FILE)).unwrap();
        (spaces, alexa)
    }

    fn add_note(alexa: &mut Alexa) -> String {
        alexa.create_document(NoteType::Writer).unwrap().id
    }

    fn has_note(alexa: &mut Alexa, id: &str) -> bool {
        alexa.note(id).unwrap().is_some()
    }

    #[test]
    fn 沒有清單時只有原本的資料() {
        let root = folder();
        let spaces = Workspaces::load(&root);
        assert_eq!(spaces.list().items.len(), 1);
        assert_eq!(spaces.active_folder(), root);
    }

    #[test]
    fn 內容彼此隔離() {
        let root = folder();
        let (mut spaces, mut first) = open(&root);
        let kept = add_note(&mut first);
        drop(first);

        spaces.create("工作").unwrap();
        let (mut spaces, mut second) = open(&root);
        assert_ne!(spaces.active_folder(), root);
        assert!(!has_note(&mut second, &kept));
        let other = add_note(&mut second);
        drop(second);

        spaces.activate(ORIGINAL_ID).unwrap();
        let (_, mut first) = open(&root);
        assert!(has_note(&mut first, &kept));
        assert!(!has_note(&mut first, &other));
    }

    #[test]
    fn 名稱不能空白太長或重複() {
        let mut spaces = Workspaces::load(&folder());
        assert!(spaces.create("   ").is_err());
        assert!(spaces.create(&"長".repeat(NAME_LIMIT + 1)).is_err());
        spaces.create("Work").unwrap();
        assert!(spaces.create(" work ").is_err());
        let id = spaces.list().active_id.clone();
        spaces.rename(&id, "WORK").unwrap();
        assert!(spaces.rename(ORIGINAL_ID, "work").is_err());
    }

    #[test]
    fn 改名和目前的選擇都記得() {
        let root = folder();
        let mut spaces = Workspaces::load(&root);
        spaces.create("工作").unwrap();
        spaces.rename(ORIGINAL_ID, "私人").unwrap();
        let again = Workspaces::load(&root);
        assert_eq!(again.list(), spaces.list());
        assert_eq!(again.list().items[0].name, "私人");
    }

    #[test]
    fn 刪除只移除那一個的資料夾() {
        let root = folder();
        let mut spaces = Workspaces::load(&root);
        spaces.create("暫時").unwrap();
        let id = spaces.list().active_id.clone();
        let doomed = spaces.active_folder();
        assert!(spaces.delete(&id).is_err());
        assert!(spaces.delete(ORIGINAL_ID).is_err());

        fs::write(root.join(DATABASE_FILE), b"").unwrap();
        spaces.activate(ORIGINAL_ID).unwrap();
        spaces.delete(&id).unwrap();
        assert!(!doomed.exists());
        assert!(root.join(DATABASE_FILE).is_file());
        assert_eq!(Workspaces::load(&root).list().items.len(), 1);
    }

    #[test]
    fn 資料庫不見時回到最早的() {
        let root = folder();
        let mut spaces = Workspaces::load(&root);
        spaces.create("工作").unwrap();
        fs::remove_dir_all(spaces.active_folder()).unwrap();
        assert_eq!(Workspaces::load(&root).active_folder(), root);
        assert_eq!(Workspaces::load(&root).list().items.len(), 2);
    }

    #[test]
    fn 讀不懂的清單當作只有一個() {
        let root = folder();
        fs::write(root.join(MANIFEST_FILE), "不是 JSON").unwrap();
        assert_eq!(Workspaces::load(&root).list().items.len(), 1);
    }

    #[test]
    fn 清單不能指到別的資料夾() {
        let root = folder();
        let text = r#"{"activeId":"default","items":[{"id":"../..","name":"壞"}]}"#;
        fs::write(root.join(MANIFEST_FILE), text).unwrap();
        let list = Workspaces::load(&root);
        assert!(list.list().items.iter().all(|item| item.id == ORIGINAL_ID));
    }

    #[test]
    fn 換資料位置時全部一起帶走() {
        let (root, target) = (folder(), folder());
        let (mut spaces, mut first) = open(&root);
        let kept = add_note(&mut first);
        drop(first);
        spaces.create("工作").unwrap();
        let (spaces, mut second) = open(&root);
        let other = add_note(&mut second);
        let media = spaces.active_folder().join("media").join("ab");
        fs::create_dir_all(&media).unwrap();
        fs::write(media.join("x.png"), b"1234").unwrap();

        spaces.copy_media(&target).unwrap();
        spaces.copy_databases(&second, &target).unwrap();
        drop(second);

        let (mut moved, mut opened) = open(&target);
        assert_eq!(moved.list(), spaces.list());
        assert!(has_note(&mut opened, &other));
        assert!(moved.active_folder().join("media").join("ab").join("x.png").is_file());
        drop(opened);
        moved.activate(ORIGINAL_ID).unwrap();
        let (_, mut opened) = open(&target);
        assert!(has_note(&mut opened, &kept));
    }
}
