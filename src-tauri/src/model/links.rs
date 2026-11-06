//! Note References：從內文與箭頭推導出來的連結，不另外儲存。

use super::types::{ArrowDirection, NoteLink, NoteLinks, ReferenceSource};
use super::Alexa;
use std::collections::HashSet;

/// 卡片之間的連結存成一般的 Markdown 連結 `[文字](note:<筆記 id>)`，文字可以自訂。
const NOTE_LINK_PREFIX: &str = "(note:";
/// 卡片裡的圖片，網址是檔名，不是給人看的文字。
const MEDIA_LINK_PREFIX: &str = "(media:";

pub(super) struct Reference {
    id: String,
    pub(super) from_id: String,
    pub(super) to_id: String,
    source: ReferenceSource,
    label: String,
    whiteboard_name: Option<String>,
}

/// 找出內文連到的筆記，回傳 (筆記 id, 連結文字)。程式碼裡的連結只是文字，不算。
pub(super) fn mentions(content: &str) -> Vec<(String, String)> {
    let prose = without_fenced_code(content);
    let bytes = prose.as_bytes();
    let mut found = Vec::new();
    let mut opens = Vec::new();
    let mut i = 0;
    // 只比對 ASCII，UTF-8 的多位元組字元不會誤中，切字串的位置也一定在字元邊界上。
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'`' => i = after_code_span(bytes, i),
            b'[' => {
                opens.push(i);
                i += 1;
            }
            b']' => {
                let open = opens.pop();
                i += 1;
                let Some(open) = open else { continue };
                let Some(target) = prose[i..].strip_prefix(NOTE_LINK_PREFIX) else {
                    continue;
                };
                let Some(end) = target.find(')') else { continue };
                let id = &target[..end];
                if !id.is_empty() && !id.contains(char::is_whitespace) {
                    found.push((id.to_string(), prose[open + 1..i - 1].to_string()));
                }
                i += NOTE_LINK_PREFIX.len() + end + 1;
            }
            _ => i += 1,
        }
    }
    found
}

/// 拿掉 `(note:<id>)`，搜尋時才不會比對到使用者看不到的 id。
pub(super) fn without_note_targets(content: &str) -> String {
    let mut visible = String::with_capacity(content.len());
    let mut rest = content;
    let next_target = |text: &str| [NOTE_LINK_PREFIX, MEDIA_LINK_PREFIX].iter().filter_map(|prefix| text.find(prefix)).min();
    while let Some(start) = next_target(rest) {
        visible.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest.find(')') else { break };
        rest = &rest[end + 1..];
    }
    visible.push_str(rest);
    visible
}

/// 回傳行內程式碼結束後的位置；沒有結尾時，開頭的反引號只是文字。
fn after_code_span(bytes: &[u8], start: usize) -> usize {
    let run_at = |index: usize| bytes[index..].iter().take_while(|byte| **byte == b'`').count();
    let run = run_at(start);
    let mut i = start + run;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let close = run_at(i);
        i += close;
        if close == run {
            return i;
        }
    }
    start + run
}

fn without_fenced_code(content: &str) -> String {
    let mut prose = String::with_capacity(content.len());
    let mut fence: Option<(char, usize)> = None;
    for line in content.lines() {
        // 清單裡的程式碼區塊有縮排，所以不限制開頭的空白數量。
        let trimmed = line.trim_start_matches(' ');
        let marker = trimmed.chars().next().filter(|char| matches!(char, '`' | '~'));
        let run = marker.map_or(0, |marker| trimmed.chars().take_while(|char| *char == marker).count());
        let rest = &trimmed[run..];
        match fence {
            Some((open, size)) => {
                if marker == Some(open) && run >= size && rest.trim().is_empty() {
                    fence = None;
                }
            }
            None if run >= 3 && !(marker == Some('`') && rest.contains('`')) => {
                fence = marker.map(|marker| (marker, run));
            }
            None => {
                prose.push_str(line);
                prose.push('\n');
            }
        }
    }
    prose
}

impl Alexa {
    /// 這筆筆記連到哪裡，以及哪裡連到它（反向連結）。每次都從內文與白板重新計算。
    /// 無方向和雙向的箭頭兩邊都算，所以會同時出現在兩個清單裡。
    pub fn note_links(&mut self, note_id: &str) -> Result<NoteLinks, String> {
        let mut references = self.mention_references()?;
        references.extend(self.arrow_references()?);

        let mut links = NoteLinks::default();
        for reference in references {
            let Reference { id, from_id, to_id, source, label, whiteboard_name } = reference;
            if from_id == to_id {
                continue;
            }
            let other = match (from_id == note_id, to_id == note_id) {
                (true, _) => &to_id,
                (_, true) => &from_id,
                _ => continue,
            };
            // 另一端可能是白板方塊，或資料已遺失。
            let Some(note) = self.note(other)? else {
                continue;
            };
            let outgoing = from_id == note_id;
            let link = NoteLink { id, from_id, to_id, source, label, whiteboard_name, note };
            if outgoing {
                links.outgoing.push(link);
            } else {
                links.incoming.push(link);
            }
        }
        let newest_first = |a: &NoteLink, b: &NoteLink| {
            b.note
                .updated_at
                .total_cmp(&a.note.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        };
        links.outgoing.sort_by(newest_first);
        links.incoming.sort_by(newest_first);
        Ok(links)
    }

    /// 同一張卡片連到同一個目標多次時只算一筆。
    pub(super) fn mention_references(&mut self) -> Result<Vec<Reference>, String> {
        let mut references = Vec::new();
        for card in self.card_library()? {
            let mut seen = HashSet::new();
            for (target, label) in mentions(&card.content) {
                if seen.insert(target.clone()) {
                    references.push(Reference {
                        id: format!("mention:{}:{target}", card.id),
                        from_id: card.id.clone(),
                        to_id: target,
                        source: ReferenceSource::Mention,
                        label,
                        whiteboard_name: None,
                    });
                }
            }
        }
        for note in self.office_library()? {
            let mut seen = HashSet::new();
            for (target, label) in self.office_targets(&note.id)? {
                if seen.insert(target.clone()) {
                    references.push(Reference {
                        id: format!("mention:{}:{target}", note.id),
                        from_id: note.id.clone(),
                        to_id: target,
                        source: ReferenceSource::Mention,
                        label,
                        whiteboard_name: None,
                    });
                }
            }
        }
        Ok(references)
    }

    fn arrow_references(&mut self) -> Result<Vec<Reference>, String> {
        let mut references = Vec::new();
        for board in self.list_whiteboards() {
            let state = self.board(&board.id)?;
            let note_of = |placed_id: &str| {
                state
                    .placed_notes
                    .iter()
                    .find(|placed| placed.id == placed_id)
                    .map(|placed| placed.note_id.clone())
            };
            for arrow in &state.arrows {
                let (Some(from), Some(to)) =
                    (note_of(&arrow.from_placed_id), note_of(&arrow.to_placed_id))
                else {
                    continue;
                };
                let forward = !matches!(arrow.direction, ArrowDirection::Backward);
                let backward = !matches!(arrow.direction, ArrowDirection::Forward);
                let reference = |from_id: &str, to_id: &str| Reference {
                    id: format!("arrow:{}:{from_id}", arrow.id),
                    from_id: from_id.to_string(),
                    to_id: to_id.to_string(),
                    source: ReferenceSource::Arrow,
                    label: arrow.label.clone(),
                    whiteboard_name: Some(board.name.clone()),
                };
                if forward {
                    references.push(reference(&from, &to));
                }
                if backward {
                    references.push(reference(&to, &from));
                }
            }
        }
        Ok(references)
    }
}
