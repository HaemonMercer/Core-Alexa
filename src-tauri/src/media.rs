//! 圖片與影片存在資料夾，不進 SQLite。檔名是內容的 SHA-256，所以檔案不會被改寫，
//! 相同內容只存一份。誰用到哪個檔案記在筆記的 `context`，這裡不記錄。
//!
//! 這一層不碰 `Alexa`：讀寫大檔案時不能佔著全域的鎖。

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::http::{header, Response};
use uuid::Uuid;

/// 一次回應的上限：影片邊播邊讀，不必整個檔案載入記憶體。
const MAX_RANGE_RESPONSE: u64 = 1024 * 1024;
const COPY_BUFFER: usize = 64 * 1024;
const HASH_HEX_LENGTH: usize = 64;
const IMAGE_CACHE: &str = "public, max-age=31536000, immutable";

const IMAGE_TYPES: &[(imagesize::ImageType, &str, &str)] = &[
    (imagesize::ImageType::Png, "png", "image/png"),
    (imagesize::ImageType::Jpeg, "jpg", "image/jpeg"),
    (imagesize::ImageType::Gif, "gif", "image/gif"),
    (imagesize::ImageType::Webp, "webp", "image/webp"),
    (imagesize::ImageType::Bmp, "bmp", "image/bmp"),
];

const VIDEO_TYPES: &[(&str, &str)] = &[("mp4", "video/mp4"), ("webm", "video/webm")];
/// HEIC 這類圖片也用 ftyp 開頭，不能當成影片。
const IMAGE_BRANDS: &[&[u8; 4]] = &[b"heic", b"heix", b"heim", b"heis", b"mif1", b"msf1", b"avif", b"avis"];
/// 判斷影片容器只需要檔案開頭。
const VIDEO_HEADER: usize = 64;

fn mime_of(extension: &str) -> Option<&'static str> {
    IMAGE_TYPES
        .iter()
        .find(|(_, candidate, _)| *candidate == extension)
        .map(|(_, _, mime)| *mime)
        .or_else(|| VIDEO_TYPES.iter().find(|(candidate, _)| *candidate == extension).map(|(_, mime)| *mime))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

/// 匯入後的檔案。`file` 就是之後讀取時用的名稱。
/// 影片的寬高要解碼才知道，這裡是 0，由前端量好後另外存回來。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ImportedMedia {
    pub file: String,
    pub name: String,
    pub kind: MediaKind,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
pub struct MediaStore {
    dir: PathBuf,
}

impl MediaStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// 檔案總管或檔案對話框選到的路徑，可能是很大的影片，一邊讀一邊寫。
    pub fn import_file(&self, path: &Path) -> Result<ImportedMedia, String> {
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        let mut file = File::open(path).map_err(|e| format!("{name}: {e}"))?;
        let video = video_extension(&mut file).map_err(|e| format!("{name}: {e}"))?;
        file.rewind().map_err(|e| e.to_string())?;
        let (extension, kind, width, height) = match video {
            Some(extension) => (extension, MediaKind::Video, 0, 0),
            None => {
                let (extension, width, height) =
                    inspect_image(&mut BufReader::new(&mut file)).map_err(|e| format!("{name}: {e}"))?;
                file.rewind().map_err(|e| e.to_string())?;
                (extension, MediaKind::Image, width, height)
            }
        };
        let file = self.store(&mut file, extension).map_err(|e| format!("{name}: {e}"))?;
        Ok(ImportedMedia { file, name, kind, width, height })
    }

    pub fn import_image_bytes(&self, bytes: &[u8], name: &str) -> Result<ImportedMedia, String> {
        let (extension, width, height) = inspect_image(&mut Cursor::new(bytes))?;
        let file = self.store(&mut Cursor::new(bytes), extension)?;
        Ok(ImportedMedia { file, name: name.to_string(), kind: MediaKind::Image, width, height })
    }

    /// 先寫到暫存檔再改名：中途失敗或當機都不會留下內容不完整的正式檔案。
    fn store(&self, source: &mut impl Read, extension: &str) -> Result<String, String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let temporary = self.dir.join(format!("{}.tmp", Uuid::new_v4()));
        let result = write_hashed(source, &temporary).and_then(|hash| {
            let file = format!("{hash}.{extension}");
            let target = self.path_of(&file).ok_or("invalid media name")?;
            fs::create_dir_all(target.parent().ok_or("invalid media path")?).map_err(|e| e.to_string())?;
            if target.exists() {
                fs::remove_file(&temporary).map_err(|e| e.to_string())?;
            } else {
                fs::rename(&temporary, &target).map_err(|e| e.to_string())?;
            }
            Ok(file)
        });
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    /// 只接受我們自己產生的名稱，網址裡的路徑走不出媒體資料夾。
    fn path_of(&self, file: &str) -> Option<PathBuf> {
        let (hash, extension) = file.split_once('.')?;
        let valid = hash.len() == HASH_HEX_LENGTH
            && hash.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
            && mime_of(extension).is_some();
        valid.then(|| self.dir.join(&hash[..2]).join(file))
    }

    /// 已經沒有筆記用到的檔案。失敗只是多留一個檔案，不影響資料。
    pub fn remove(&self, file: &str) {
        if let Some(path) = self.path_of(file) {
            let _ = fs::remove_file(path);
        }
    }

    /// 回應 `media://` 的請求。`range` 是請求的 Range 標頭。
    pub fn serve(&self, file: &str, range: Option<&str>) -> Response<Vec<u8>> {
        let builder = Response::builder().header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
        let found = self.path_of(file).and_then(|path| File::open(path).ok());
        let extension = file.rsplit('.').next().unwrap_or_default();
        let (Some(mut opened), Some(mime)) = (found, mime_of(extension)) else {
            return builder.status(404).body(Vec::new()).unwrap_or_default();
        };
        let Ok(size) = opened.metadata().map(|metadata| metadata.len()) else {
            return builder.status(500).body(Vec::new()).unwrap_or_default();
        };
        let builder = builder
            .header(header::CONTENT_TYPE, mime)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CACHE_CONTROL, IMAGE_CACHE);

        let Some(range) = range else {
            let mut body = Vec::with_capacity(size as usize);
            return match opened.read_to_end(&mut body) {
                Ok(_) => builder.status(200).body(body).unwrap_or_default(),
                Err(_) => builder.status(500).body(Vec::new()).unwrap_or_default(),
            };
        };
        let Some((start, end)) = parse_range(range, size) else {
            return builder
                .status(416)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap_or_default();
        };
        let mut body = vec![0; (end - start + 1) as usize];
        let read = opened.seek(SeekFrom::Start(start)).and_then(|_| opened.read_exact(&mut body));
        if read.is_err() {
            return builder.status(500).body(Vec::new()).unwrap_or_default();
        }
        builder
            .status(206)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"))
            .body(body)
            .unwrap_or_default()
    }
}

fn write_hashed(source: &mut impl Read, target: &Path) -> Result<String, String> {
    let mut output = File::create(target).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; COPY_BUFFER];
    loop {
        let read = source.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
        output.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
    }
    output.flush().map_err(|e| e.to_string())?;
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// 依內容判斷影片容器，不看副檔名。不是影片時回傳 None，交給圖片判斷。
fn video_extension(file: &mut File) -> Result<Option<&'static str>, String> {
    let mut header = Vec::with_capacity(VIDEO_HEADER);
    Read::by_ref(file).take(VIDEO_HEADER as u64).read_to_end(&mut header).map_err(|e| e.to_string())?;
    if header.len() >= 12 && &header[4..8] == b"ftyp" {
        let image = IMAGE_BRANDS.iter().any(|brand| brand.as_slice() == &header[8..12]);
        return Ok((!image).then_some("mp4"));
    }
    if header.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        if header.windows(4).any(|window| window == b"webm") {
            return Ok(Some("webm"));
        }
        return Err("不支援 MKV 影片，請先轉成 MP4".to_string());
    }
    Ok(None)
}

/// 依內容判斷格式，不看副檔名。回傳副檔名與顯示時的寬高。
fn inspect_image<R: std::io::BufRead + Seek>(reader: &mut R) -> Result<(&'static str, u32, u32), String> {
    let kind = imagesize::reader_type(&mut *reader).map_err(|_| "不是支援的圖片或影片格式".to_string())?;
    let (extension, _) = IMAGE_TYPES
        .iter()
        .find(|(candidate, _, _)| *candidate == kind)
        .map(|(_, extension, mime)| (*extension, *mime))
        .ok_or("不是支援的圖片或影片格式")?;
    reader.rewind().map_err(|e| e.to_string())?;
    let size = imagesize::reader_size(&mut *reader).map_err(|_| "無法讀取圖片尺寸".to_string())?;
    let (mut width, mut height) = (size.width as u32, size.height as u32);
    if width == 0 || height == 0 {
        return Err("圖片沒有內容".to_string());
    }
    if extension == "jpg" {
        reader.rewind().map_err(|e| e.to_string())?;
        if exif_rotates(reader) {
            std::mem::swap(&mut width, &mut height);
        }
    }
    Ok((extension, width, height))
}

/// 手機直拍的照片檔案裡是橫的，靠 EXIF 記錄方向；瀏覽器顯示時會轉正，尺寸要跟著對調。
fn exif_rotates<R: std::io::BufRead + Seek>(reader: &mut R) -> bool {
    let Ok(data) = exif::Reader::new().read_from_container(reader) else {
        return false;
    };
    data.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        .and_then(|field| field.value.get_uint(0))
        .is_some_and(|orientation| (5..=8).contains(&orientation))
}

/// 解析單一區段的 Range，並套用回應上限。範圍不合法時回傳 None。
fn parse_range(value: &str, size: u64) -> Option<(u64, u64)> {
    let (first, last) = value.strip_prefix("bytes=")?.split_once('-')?;
    let start: u64 = first.parse().ok()?;
    if start >= size {
        return None;
    }
    let end = if last.is_empty() { size - 1 } else { last.parse::<u64>().ok()?.min(size - 1) };
    if end < start {
        return None;
    }
    Some((start, end.min(start + MAX_RANGE_RESPONSE - 1)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (MediaStore, PathBuf) {
        let dir = std::env::temp_dir().join(format!("alexa-media-{}", Uuid::new_v4()));
        (MediaStore::new(dir.clone()), dir)
    }

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
        bytes
    }

    /// 只有 EXIF 方向與尺寸的最小 JPEG。
    fn jpeg(width: u16, height: u16, orientation: u16) -> Vec<u8> {
        let mut tiff = b"II*\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0".to_vec();
        tiff.extend_from_slice(&orientation.to_le_bytes());
        tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend_from_slice(&tiff);

        let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1];
        bytes.extend_from_slice(&((app1.len() + 2) as u16).to_be_bytes());
        bytes.extend_from_slice(&app1);
        bytes.extend_from_slice(&[0xff, 0xc0, 0, 11, 8]);
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&[1, 1, 0x11, 0]);
        bytes.extend_from_slice(&[0xff, 0xd9]);
        bytes
    }

    #[test]
    fn imports_an_image_by_content_not_by_file_name() {
        let (media, dir) = store();
        let source = dir.with_extension("txt");
        fs::write(&source, png(640, 480)).unwrap();

        let image = media.import_file(&source).unwrap();
        assert!(image.file.ends_with(".png"));
        assert_eq!(image.kind, MediaKind::Image);
        assert_eq!((image.width, image.height), (640, 480));
        assert_eq!(image.name, source.file_name().unwrap().to_string_lossy());
        assert_eq!(media.serve(&image.file, None).body(), &png(640, 480));
        fs::remove_file(source).unwrap();
    }

    #[test]
    fn same_content_is_stored_once() {
        let (media, dir) = store();
        let first = media.import_image_bytes(&png(10, 10), "a.png").unwrap();
        let second = media.import_image_bytes(&png(10, 10), "b.png").unwrap();
        assert_eq!(first.file, second.file);
        assert_ne!(first.name, second.name);

        let subfolder = dir.join(&first.file[..2]);
        assert_eq!(fs::read_dir(subfolder).unwrap().count(), 1);
        // 暫存檔不會留下來：資料夾裡只有一個兩字元的子資料夾。
        assert_eq!(fs::read_dir(dir).unwrap().count(), 1);
    }

    #[test]
    fn rejects_files_that_are_not_images() {
        let (media, dir) = store();
        assert!(media.import_image_bytes(b"just some text, not a picture", "a.png").is_err());
        assert!(!dir.exists());
    }

    #[test]
    fn swaps_size_for_rotated_jpeg_photos() {
        let (media, _) = store();
        let rotated = media.import_image_bytes(&jpeg(400, 300, 6), "直拍.jpg").unwrap();
        assert_eq!((rotated.width, rotated.height), (300, 400));
        let upright = media.import_image_bytes(&jpeg(400, 300, 1), "橫拍.jpg").unwrap();
        assert_eq!((upright.width, upright.height), (400, 300));
    }

    fn imported(media: &MediaStore, name: &str, bytes: &[u8]) -> Result<ImportedMedia, String> {
        let source = std::env::temp_dir().join(format!("{}-{name}", Uuid::new_v4()));
        fs::write(&source, bytes).unwrap();
        let result = media.import_file(&source);
        fs::remove_file(source).unwrap();
        result
    }

    #[test]
    fn recognises_video_containers_by_content() {
        let (media, _) = store();
        let mp4 = imported(&media, "a.bin", b"\0\0\0\x20ftypisom\0\0\x02\0isomiso2avc1mp41").unwrap();
        assert_eq!(mp4.kind, MediaKind::Video);
        assert!(mp4.file.ends_with(".mp4"));

        let webm = imported(&media, "b.bin", b"\x1a\x45\xdf\xa3\x01\0\0\0\0\0\0\x1f\x42\x86\x81\x01webm").unwrap();
        assert!(webm.file.ends_with(".webm"));
        assert_eq!(media.serve(&webm.file, Some("bytes=0-3")).headers()[header::CONTENT_TYPE], "video/webm");
    }

    #[test]
    fn rejects_mkv_and_heic_with_a_reason() {
        let (media, _) = store();
        let mkv = imported(&media, "a.mkv", b"\x1a\x45\xdf\xa3\x01\0\0\0matroska").unwrap_err();
        assert!(mkv.contains("MKV"), "{mkv}");
        assert!(imported(&media, "a.heic", b"\0\0\0\x18ftypheic\0\0\0\0mif1heic").is_err());
    }

    #[test]
    fn serves_only_names_it_generated() {
        let (media, _) = store();
        let image = media.import_image_bytes(&png(4, 4), "a.png").unwrap();
        for bad in [
            "../alexa.db",
            "..%2Falexa.db",
            "a.png",
            &format!("{}.exe", &image.file[..HASH_HEX_LENGTH]),
            &image.file.to_uppercase(),
        ] {
            assert_eq!(media.serve(bad, None).status(), 404, "{bad}");
        }
    }

    #[test]
    fn range_requests_return_part_of_the_file_with_a_cap() {
        let (media, _) = store();
        let mut bytes = png(4, 4);
        bytes.resize(3 * 1024 * 1024, 7);
        let image = media.import_image_bytes(&bytes, "a.png").unwrap();

        let part = media.serve(&image.file, Some("bytes=8-11"));
        assert_eq!(part.status(), 206);
        assert_eq!(part.body(), &bytes[8..12]);
        assert_eq!(part.headers()[header::CONTENT_RANGE], format!("bytes 8-11/{}", bytes.len()));

        let open_ended = media.serve(&image.file, Some("bytes=100-"));
        assert_eq!(open_ended.body().len() as u64, MAX_RANGE_RESPONSE);

        let beyond = media.serve(&image.file, Some("bytes=99999999-"));
        assert_eq!(beyond.status(), 416);
        assert_eq!(media.serve(&image.file, Some("bytes=20-10")).status(), 416);
    }

    #[test]
    fn removing_a_file_only_touches_valid_names() {
        let (media, dir) = store();
        let image = media.import_image_bytes(&png(4, 4), "a.png").unwrap();
        media.remove("../secret.png");
        assert_eq!(media.serve(&image.file, None).status(), 200);
        media.remove(&image.file);
        assert_eq!(media.serve(&image.file, None).status(), 404);
        assert_eq!(fs::read_dir(dir.join(&image.file[..2])).unwrap().count(), 0);
    }
}
