//! 圖片與影片筆記。檔案本身在 `MediaStore`，這裡只把檔名、原始檔名與尺寸記在 `context`。

use super::card_markdown::ImageFile;
use super::placements::MIN_NOTE_SIZE;
use super::types::{BoardState, ImportedFiles, Note, NoteType, Size, VideoInfo};
use super::whiteboards::ROOT_ID;
use super::yjs::{any_number, now};
use super::Alexa;
use crate::media::{ImportedMedia, MediaKind};
use yrs::{Any, Map, Transact};

/// 大圖一開始不要佔滿畫面，小圖不放大。
const MAX_INITIAL_SIDE: f64 = 480.0;
/// 一次拖進多張時依序錯開，才不會完全疊在一起。
const CASCADE_OFFSET: f64 = 32.0;

fn context_field<'a>(note: &'a Note, key: &str) -> Option<&'a Any> {
    match &note.context {
        Any::Map(fields) => fields.get(key),
        _ => None,
    }
}

/// 這筆筆記用到的媒體檔案：本體、影片封面、Draw.io 預覽圖。
pub(super) fn media_files(note: &Note) -> Vec<String> {
    ["media", "poster", "preview"]
        .into_iter()
        .filter_map(|key| match context_field(note, key) {
            Some(Any::String(file)) => Some(file.to_string()),
            _ => None,
        })
        .collect()
}

fn context_number(note: &Note, key: &str) -> Option<f64> {
    context_field(note, key).and_then(any_number)
}

/// 圖片筆記的檔案與原始大小，欄位不齊時回傳 None。
pub(super) fn image_file(note: &Note) -> Option<ImageFile> {
    let Some(Any::String(file)) = context_field(note, "media") else { return None };
    Some(ImageFile { file: file.to_string(), width: context_number(note, "width")?, height: context_number(note, "height")? })
}

/// 維持比例，長邊不超過上限；太小的圖放大到拖得動的大小。
pub(super) fn fitted_image_size(width: f64, height: f64) -> Size {
    let scale = (MAX_INITIAL_SIDE / width.max(height))
        .min(1.0)
        .max(MIN_NOTE_SIZE.w / width)
        .max(MIN_NOTE_SIZE.h / height);
    Size { w: (width * scale).round(), h: (height * scale).round() }
}

impl Alexa {
    pub(super) fn media_placement_size(&mut self, note_id: &str) -> Option<Size> {
        let note = self.note(note_id).ok()??;
        Some(fitted_image_size(context_number(&note, "width")?, context_number(&note, "height")?))
    }

    fn new_media_note(&mut self, file: &ImportedMedia) -> Result<String, String> {
        let id = self.new_note(match file.kind {
            MediaKind::Image => NoteType::Image,
            MediaKind::Video => NoteType::Video,
        })?;
        let note = self.notes.get_mut(&id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            context.insert(&mut txn, "media", file.file.clone());
            context.insert(&mut txn, "name", file.name.clone());
            if file.kind == MediaKind::Image {
                context.insert(&mut txn, "width", f64::from(file.width));
                context.insert(&mut txn, "height", f64::from(file.height));
            }
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;
        Ok(id)
    }

    /// 貼進 Writer 的圖片：建立圖片筆記，但不放到任何白板上。
    pub fn create_image_note(&mut self, file: &ImportedMedia) -> Result<Note, String> {
        let id = self.new_media_note(file)?;
        self.note(&id)?.ok_or_else(|| format!("unknown note: {id}"))
    }

    /// `center_x`、`center_y` 是第一張的中心點，世界座標。
    pub fn create_media_notes(
        &mut self,
        whiteboard_id: &str,
        files: &[ImportedMedia],
        center_x: f64,
        center_y: f64,
        failed: Vec<String>,
    ) -> Result<ImportedFiles, String> {
        if whiteboard_id == ROOT_ID {
            return Err(super::placements::ROOT_ONLY_WHITEBOARDS.to_string());
        }
        let mut placed_ids = Vec::with_capacity(files.len());
        for (index, file) in files.iter().enumerate() {
            let note_id = self.new_media_note(file)?;
            let offset = index as f64 * CASCADE_OFFSET;
            placed_ids.push(self.add_placement(whiteboard_id, &note_id, center_x + offset, center_y + offset)?);
        }
        Ok(ImportedFiles { placed_ids, failed, board: self.board(whiteboard_id)? })
    }

    /// 存下解碼後的尺寸與封面，並讓這個白板上的放置符合實際比例，中心點不動。
    pub fn save_video_info(
        &mut self,
        whiteboard_id: &str,
        note_id: &str,
        info: &VideoInfo,
    ) -> Result<BoardState, String> {
        if self.note_type(note_id).as_deref() != Some(NoteType::Video.as_str()) {
            return Err(format!("not a video: {note_id}"));
        }
        if info.width <= 0.0 || info.height <= 0.0 {
            return Err("video has no picture".to_string());
        }
        self.ensure_note(note_id)?;
        let note = self.notes.get_mut(note_id).ok_or("note is not open")?;
        let context = note.doc.get_or_insert_map("context");
        let meta = note.doc.get_or_insert_map("meta");
        let update = {
            let mut txn = note.doc.transact_mut();
            context.insert(&mut txn, "width", info.width);
            context.insert(&mut txn, "height", info.height);
            context.insert(&mut txn, "duration", info.duration);
            context.insert(&mut txn, "poster", info.poster.clone());
            meta.insert(&mut txn, "updatedAt", now());
            txn.encode_update_v1()
        };
        note.save(&mut self.conn, update)?;

        let size = fitted_image_size(info.width, info.height);
        let mut board = self.board(whiteboard_id)?;
        for placed in board.placed_notes.iter().filter(|placed| placed.note_id == note_id).cloned().collect::<Vec<_>>() {
            let x = placed.x + (placed.w - size.w) / 2.0;
            let y = placed.y + (placed.h - size.h) / 2.0;
            board = self.resize_note(whiteboard_id, &placed.id, x, y, size.w, size.h)?;
        }
        Ok(board)
    }
}
