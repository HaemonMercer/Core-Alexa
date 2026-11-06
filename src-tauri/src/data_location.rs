//! 使用者自選的資料位置。
//!
//! 資料庫不能記住自己在哪裡，所以位置寫在固定的 `<基本資料夾>/data-location.json`，
//! 沒有這個檔案就是基本資料夾本身。換位置只複製，舊位置的資料不會動。

use crate::storage;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DATABASE_FILE: &str = "alexa.db";
const MEDIA_FOLDER: &str = "media";
const POINTER_FILE: &str = "data-location.json";

#[derive(Serialize, Deserialize)]
struct Pointer {
    dir: PathBuf,
}

/// 這次啟動實際用的位置。
pub struct DataLocation {
    pub base: PathBuf,
    pub current: PathBuf,
    /// 指定的位置打不開時（例如外接硬碟沒接上）才有值，這時暫用基本資料夾。
    pub unavailable: Option<PathBuf>,
}

/// 上次選的位置。讀不懂的檔案當作沒選過。
pub fn saved_location(base: &Path) -> Option<PathBuf> {
    let text = fs::read(base.join(POINTER_FILE)).ok()?;
    serde_json::from_slice::<Pointer>(&text).ok().map(|pointer| pointer.dir)
}

/// 先寫暫存檔再改名，中途失敗時舊的位置還在。
fn save_location(base: &Path, target: &Path) -> Result<(), String> {
    let pointer = base.join(POINTER_FILE);
    if same_folder(base, target) {
        return match fs::remove_file(&pointer) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.to_string()),
            _ => Ok(()),
        };
    }
    let part = base.join(format!("{POINTER_FILE}.part"));
    let text = serde_json::to_vec(&Pointer { dir: target.to_path_buf() }).map_err(|e| e.to_string())?;
    fs::write(&part, text).map_err(|e| e.to_string())?;
    fs::rename(&part, &pointer).map_err(|e| e.to_string())
}

fn same_folder(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

impl DataLocation {
    /// 檢查這個資料夾能不能用，回傳裡面是否已經有資料。
    pub fn inspect(&self, target: &Path) -> Result<bool, String> {
        if !target.is_absolute() || !target.is_dir() {
            return Err("找不到這個資料夾".to_string());
        }
        if same_folder(&self.current, target) {
            return Err("資料已經在這個資料夾".to_string());
        }
        // 放進媒體資料夾會讓複製進行時讀到自己。
        let media = self.current.join(MEDIA_FOLDER);
        if let (Ok(media), Ok(inside)) = (media.canonicalize(), target.canonicalize()) {
            if inside.starts_with(media) {
                return Err("不能放在媒體資料夾裡".to_string());
            }
        }
        let database = target.join(DATABASE_FILE);
        if database.is_file() {
            check_database(&database)?;
            return Ok(true);
        }
        let probe = target.join(".alexa-write-test");
        fs::write(&probe, b"").map_err(|e| format!("無法寫入這個資料夾：{e}"))?;
        let _ = fs::remove_file(probe);
        Ok(false)
    }

    /// 圖片和影片可能很大，先複製一輪，這時不用鎖住編輯。
    pub fn copy_media(&self, target: &Path) -> Result<(), String> {
        copy_files(&self.current.join(MEDIA_FOLDER), &target.join(MEDIA_FOLDER))
    }

    /// 之後的啟動改用這個位置。
    pub fn remember(&self, target: &Path) -> Result<(), String> {
        save_location(&self.base, target)
    }
}

/// 檔案名稱來自內容雜湊，同名同大小就是同一份，所以重複執行只補上缺的。
fn copy_files(from: &Path, to: &Path) -> Result<(), String> {
    if !from.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(from).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        if meta.is_dir() {
            copy_files(&source, &target)?;
            continue;
        }
        if fs::metadata(&target).is_ok_and(|copied| copied.len() == meta.len()) {
            continue;
        }
        let mut part = target.clone().into_os_string();
        part.push(".part");
        fs::copy(&source, &part).map_err(|e| format!("{}: {e}", source.display()))?;
        fs::rename(&part, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 資料夾裡的資料庫壞了就不能換過去，否則之後每次啟動都會失敗。
pub fn check_database(path: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("無法開啟資料庫：{e}"))?;
    let invalid = |e: rusqlite::Error| format!("這不是 Code Alexa 的資料庫：{e}");
    let result: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0)).map_err(invalid)?;
    if result != "ok" {
        return Err(format!("資料庫已損壞：{result}"));
    }
    storage::count_rows(&conn).map_err(invalid)?;
    Ok(())
}

/// 把資料庫複製到資料夾裡，確認內容完整才放上正式檔名。
pub fn copy_database(conn: &Connection, folder: &Path) -> Result<(), String> {
    let target = folder.join(DATABASE_FILE);
    let part = folder.join(format!("{DATABASE_FILE}.part"));
    let _ = fs::remove_file(&part);
    let copied = storage::write_copy(conn, &part)
        .map_err(|e| e.to_string())
        .and_then(|_| check_database(&part))
        .and_then(|_| {
            let source = storage::count_rows(conn).map_err(|e| e.to_string())?;
            let open = Connection::open(&part).map_err(|e| e.to_string())?;
            let copy = storage::count_rows(&open).map_err(|e| e.to_string())?;
            if source == copy { Ok(()) } else { Err("複製後的資料筆數不符".to_string()) }
        })
        .and_then(|_| fs::rename(&part, &target).map_err(|e| e.to_string()));
    if copied.is_err() {
        let _ = fs::remove_file(&part);
    }
    copied
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn folder() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("alexa-location-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn location(current: &Path) -> DataLocation {
        DataLocation { base: current.to_path_buf(), current: current.to_path_buf(), unavailable: None }
    }

    fn database(path: &Path, text: &[u8]) {
        let conn = storage::open(path).unwrap();
        conn.execute("INSERT INTO doc (id, type) VALUES ('a', 'note')", []).unwrap();
        conn.execute("INSERT INTO doc_update (doc_id, seq, data) VALUES ('a', 1, ?1)", [text]).unwrap();
    }

    #[test]
    fn 沒選過就是基本資料夾() {
        assert_eq!(saved_location(&folder()), None);
    }

    #[test]
    fn 記住選的位置() {
        let (base, target) = (folder(), folder());
        location(&base).remember(&target).unwrap();
        assert_eq!(saved_location(&base), Some(target));
    }

    #[test]
    fn 選回基本資料夾就不用記() {
        let (base, target) = (folder(), folder());
        let current = DataLocation { base: base.clone(), current: target.clone(), unavailable: None };
        current.remember(&target).unwrap();
        current.remember(&base).unwrap();
        assert_eq!(saved_location(&base), None);
        assert!(!base.join(POINTER_FILE).exists());
    }

    #[test]
    fn 讀不懂的位置檔當作沒選過() {
        let base = folder();
        fs::write(base.join(POINTER_FILE), "不是 JSON").unwrap();
        assert_eq!(saved_location(&base), None);
    }

    #[test]
    fn 資料和索引都複製過去且舊資料不動() {
        let (from, to) = (folder(), folder());
        let source = from.join(DATABASE_FILE);
        database(&source, b"hello");
        let conn = storage::open(&source).unwrap();
        copy_database(&conn, &to).unwrap();

        let copy = storage::open(&to.join(DATABASE_FILE)).unwrap();
        let data: Vec<u8> = copy.query_row("SELECT data FROM doc_update", [], |row| row.get(0)).unwrap();
        assert_eq!(data, b"hello");
        assert_eq!(copy.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0)).unwrap(), 1);
        assert!(!to.join(format!("{DATABASE_FILE}.part")).exists());
        assert!(source.is_file());
    }

    #[test]
    fn 尚未寫回主檔的內容也會複製() {
        let (from, to) = (folder(), folder());
        let source = from.join(DATABASE_FILE);
        let conn = storage::open(&source).unwrap();
        conn.execute("INSERT INTO doc (id, type) VALUES ('wal', 'note')", []).unwrap();
        copy_database(&conn, &to).unwrap();
        let copy = storage::open(&to.join(DATABASE_FILE)).unwrap();
        assert_eq!(storage::count_rows(&copy).unwrap().0, 1);
    }

    #[test]
    fn 媒體重複複製只補缺的且不留暫存檔() {
        let (from, to) = (folder(), folder());
        fs::create_dir_all(from.join(MEDIA_FOLDER).join("ab")).unwrap();
        fs::write(from.join(MEDIA_FOLDER).join("ab").join("x.png"), b"1234").unwrap();
        let current = location(&from);
        current.copy_media(&to).unwrap();
        fs::write(from.join(MEDIA_FOLDER).join("ab").join("y.png"), b"56").unwrap();
        current.copy_media(&to).unwrap();
        let copied = to.join(MEDIA_FOLDER).join("ab");
        assert_eq!(fs::read(copied.join("x.png")).unwrap(), b"1234");
        assert_eq!(fs::read(copied.join("y.png")).unwrap(), b"56");
        assert_eq!(fs::read_dir(copied).unwrap().count(), 2);
    }

    #[test]
    fn 沒有媒體資料夾也能複製() {
        location(&folder()).copy_media(&folder()).unwrap();
    }

    #[test]
    fn 空資料夾可以搬過去() {
        assert_eq!(location(&folder()).inspect(&folder()), Ok(false));
    }

    #[test]
    fn 已有資料的資料夾會回報() {
        let target = folder();
        database(&target.join(DATABASE_FILE), b"x");
        assert_eq!(location(&folder()).inspect(&target), Ok(true));
    }

    #[test]
    fn 損壞的資料庫不能換過去() {
        let target = folder();
        fs::write(target.join(DATABASE_FILE), vec![7u8; 8192]).unwrap();
        assert!(location(&folder()).inspect(&target).is_err());
    }

    #[test]
    fn 別的_sqlite_資料庫不能換過去() {
        let target = folder();
        let conn = Connection::open(target.join(DATABASE_FILE)).unwrap();
        conn.execute_batch("CREATE TABLE other (id TEXT)").unwrap();
        drop(conn);
        assert!(location(&folder()).inspect(&target).is_err());
    }

    #[test]
    fn 不能選目前的資料夾媒體資料夾或不存在的路徑() {
        let current = folder();
        let media = current.join(MEDIA_FOLDER).join("ab");
        fs::create_dir_all(&media).unwrap();
        let place = location(&current);
        assert!(place.inspect(&current).is_err());
        assert!(place.inspect(&media).is_err());
        assert!(place.inspect(&current.join("沒有這個")).is_err());
        assert!(place.inspect(Path::new("relative")).is_err());
    }
}
