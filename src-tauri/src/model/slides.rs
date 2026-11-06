//! Slides：`slides` 是投影片，`elements` 是投影片上的物件，座標固定在 1280×720 的畫面上，
//! 放映時再依視窗縮放。圖表與引入的格子只記來源，內容每次重新讀取，所以和試算表保持同步。
//! 簡報至少有一張投影片。

use super::office::{field_flag, field_number, field_string, field_text, set_text, sort_by_key, valid_color};
use super::types::{ElementPatch, NoteType, Slide, SlideElement, SlidesEdit, SlidesOp, SlidesState};
use super::yjs::new_id;
use super::Alexa;
use crate::order::{key_after, key_between};
use std::collections::HashMap;
use yrs::{Map, MapPrelim, MapRef, Out, ReadTxn, Transact, TransactionMut};

const ROOTS: [&str; 2] = ["slides", "elements"];
const STAGE_WIDTH: f64 = 1280.0;
const STAGE_HEIGHT: f64 = 720.0;
const MIN_ELEMENT: f64 = 16.0;
const PASTE_OFFSET: f64 = 24.0;
const DEFAULT_BACKGROUND: &str = "#ffffff";
const INK: &str = "#1f2328";

fn valid_element_kind(kind: &str) -> bool {
    matches!(kind, "text" | "shape" | "image" | "cells" | "chart")
}

fn valid_shape(shape: &str) -> bool {
    matches!(shape, "rect" | "round" | "ellipse" | "triangle" | "arrow" | "line")
}

#[derive(Clone)]
struct RawSlide {
    id: String,
    key: String,
    background: String,
    notes: String,
}

#[derive(Clone)]
struct RawElement {
    key: String,
    element: SlideElement,
}

fn read_slides<T: ReadTxn>(txn: &T, slides: &MapRef) -> Vec<RawSlide> {
    let mut raw: Vec<RawSlide> = slides
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            Some(RawSlide {
                id: id.to_string(),
                key: field_string(&item, txn, "orderKey").unwrap_or_default(),
                background: field_string(&item, txn, "background").unwrap_or_else(|| DEFAULT_BACKGROUND.to_string()),
                notes: field_text(&item, txn, "notes"),
            })
        })
        .collect();
    sort_by_key(&mut raw, |slide| (slide.key.as_str(), slide.id.as_str()));
    raw
}

fn read_elements<T: ReadTxn>(txn: &T, elements: &MapRef) -> Vec<RawElement> {
    let mut raw: Vec<RawElement> = elements
        .iter(txn)
        .filter_map(|(id, value)| {
            let Out::YMap(item) = value else { return None };
            Some(RawElement {
                key: field_string(&item, txn, "zKey").unwrap_or_default(),
                element: SlideElement {
                    id: id.to_string(),
                    slide_id: field_string(&item, txn, "slideId")?,
                    kind: field_string(&item, txn, "kind")?,
                    x: field_number(&item, txn, "x"),
                    y: field_number(&item, txn, "y"),
                    w: field_number(&item, txn, "w"),
                    h: field_number(&item, txn, "h"),
                    text: field_text(&item, txn, "text"),
                    placeholder: field_string(&item, txn, "placeholder"),
                    shape: field_string(&item, txn, "shape"),
                    fill: field_string(&item, txn, "fill"),
                    stroke: field_string(&item, txn, "stroke"),
                    color: field_string(&item, txn, "color"),
                    font_size: field_number(&item, txn, "fontSize"),
                    bold: field_flag(&item, txn, "bold"),
                    italic: field_flag(&item, txn, "italic"),
                    align: field_string(&item, txn, "align"),
                    valign: field_string(&item, txn, "valign"),
                    bullets: field_flag(&item, txn, "bullets"),
                    note_id: field_string(&item, txn, "noteId"),
                    source: field_string(&item, txn, "source").and_then(|json| serde_json::from_str(&json).ok()),
                },
            })
        })
        .collect();
    sort_by_key(&mut raw, |item| (item.key.as_str(), item.element.id.as_str()));
    raw
}

fn write_slide(txn: &mut TransactionMut, slides: &MapRef, id: &str, key: String, background: &str, notes: &str) {
    let item = slides.insert(txn, id, MapPrelim::default());
    item.insert(txn, "orderKey", key);
    item.insert(txn, "background", background.to_string());
    set_text(&item, txn, "notes", notes);
}

fn write_element(
    txn: &mut TransactionMut,
    elements: &MapRef,
    element: &SlideElement,
    key: String,
) -> Result<(), String> {
    let item = elements.insert(txn, element.id.as_str(), MapPrelim::default());
    item.insert(txn, "zKey", key);
    item.insert(txn, "slideId", element.slide_id.clone());
    item.insert(txn, "kind", element.kind.clone());
    item.insert(txn, "x", element.x);
    item.insert(txn, "y", element.y);
    item.insert(txn, "w", element.w);
    item.insert(txn, "h", element.h);
    item.insert(txn, "fontSize", element.font_size);
    item.insert(txn, "bold", element.bold);
    item.insert(txn, "italic", element.italic);
    item.insert(txn, "bullets", element.bullets);
    set_text(&item, txn, "text", &element.text);
    let optional = [
        ("placeholder", &element.placeholder),
        ("shape", &element.shape),
        ("fill", &element.fill),
        ("stroke", &element.stroke),
        ("color", &element.color),
        ("align", &element.align),
        ("valign", &element.valign),
        ("noteId", &element.note_id),
    ];
    for (field, value) in optional {
        if let Some(value) = value {
            item.insert(txn, field, value.clone());
        }
    }
    if let Some(source) = &element.source {
        item.insert(txn, "source", serde_json::to_string(source).map_err(|e| e.to_string())?);
    }
    Ok(())
}

fn text_element(slide_id: &str, rect: [f64; 4], size: f64, bold: bool, placeholder: &str) -> SlideElement {
    SlideElement {
        id: new_id(),
        slide_id: slide_id.to_string(),
        kind: "text".to_string(),
        x: rect[0],
        y: rect[1],
        w: rect[2],
        h: rect[3],
        text: String::new(),
        placeholder: Some(placeholder.to_string()),
        shape: None,
        fill: None,
        stroke: None,
        color: Some(INK.to_string()),
        font_size: size,
        bold,
        italic: false,
        align: None,
        valign: None,
        bullets: false,
        note_id: None,
        source: None,
    }
}

/// 版面決定新投影片一開始有哪些文字框。
fn layout_elements(slide_id: &str, layout: &str) -> Vec<SlideElement> {
    match layout {
        "title" => {
            let mut title = text_element(slide_id, [120.0, 220.0, 1040.0, 160.0], 64.0, true, "按兩下輸入標題");
            title.align = Some("center".to_string());
            title.valign = Some("bottom".to_string());
            let mut subtitle = text_element(slide_id, [240.0, 400.0, 800.0, 90.0], 30.0, false, "按兩下輸入副標題");
            subtitle.align = Some("center".to_string());
            subtitle.color = Some("#57606a".to_string());
            vec![title, subtitle]
        }
        "content" => {
            let title = text_element(slide_id, [80.0, 50.0, 1120.0, 110.0], 44.0, true, "按兩下輸入標題");
            let mut body = text_element(slide_id, [80.0, 180.0, 1120.0, 470.0], 28.0, false, "按兩下輸入內容");
            body.bullets = true;
            vec![title, body]
        }
        "two" => {
            let title = text_element(slide_id, [80.0, 50.0, 1120.0, 110.0], 44.0, true, "按兩下輸入標題");
            let mut left = text_element(slide_id, [80.0, 180.0, 540.0, 470.0], 26.0, false, "按兩下輸入內容");
            left.bullets = true;
            let mut right = text_element(slide_id, [660.0, 180.0, 540.0, 470.0], 26.0, false, "按兩下輸入內容");
            right.bullets = true;
            vec![title, left, right]
        }
        _ => Vec::new(),
    }
}

fn new_element(slide_id: &str, kind: &str, shape: Option<&str>) -> SlideElement {
    let mut element = text_element(slide_id, [440.0, 260.0, 400.0, 200.0], 28.0, false, "");
    element.placeholder = None;
    element.kind = kind.to_string();
    match kind {
        "text" => {
            element.placeholder = Some("輸入文字".to_string());
            element.h = 80.0;
        }
        "shape" => {
            element.shape = Some(shape.unwrap_or("rect").to_string());
            element.fill = Some("#4f5bd5".to_string());
            element.color = Some("#ffffff".to_string());
            element.align = Some("center".to_string());
            element.valign = Some("middle".to_string());
        }
        "chart" => {
            element.x = 300.0;
            element.y = 140.0;
            element.w = 680.0;
            element.h = 460.0;
        }
        "cells" => {
            element.x = 200.0;
            element.y = 180.0;
            element.w = 880.0;
            element.h = 360.0;
            element.font_size = 22.0;
        }
        _ => {}
    }
    element
}

fn item_of<T: ReadTxn>(map: &MapRef, txn: &T, id: &str, what: &str) -> Result<MapRef, String> {
    match map.get(txn, id) {
        Some(Out::YMap(item)) => Ok(item),
        _ => Err(format!("unknown {what}: {id}")),
    }
}

fn apply_patch(item: &MapRef, txn: &mut TransactionMut, patch: &ElementPatch) -> Result<(), String> {
    for color in [&patch.fill, &patch.stroke, &patch.color].into_iter().flatten() {
        if !valid_color(color) {
            return Err(format!("invalid color: {color}"));
        }
    }
    if patch.shape.as_deref().is_some_and(|shape| !valid_shape(shape)) {
        return Err("unknown shape".to_string());
    }
    let numbers = [("x", patch.x), ("y", patch.y)];
    for (key, value) in numbers {
        if let Some(value) = value {
            item.insert(txn, key, value.clamp(-STAGE_WIDTH, STAGE_WIDTH * 2.0));
        }
    }
    for (key, value) in [("w", patch.w), ("h", patch.h)] {
        if let Some(value) = value {
            item.insert(txn, key, value.max(MIN_ELEMENT));
        }
    }
    if let Some(size) = patch.font_size {
        item.insert(txn, "fontSize", size.clamp(8.0, 200.0));
    }
    if let Some(text) = &patch.text {
        set_text(item, txn, "text", text);
    }
    let flags = [("bold", patch.bold), ("italic", patch.italic), ("bullets", patch.bullets)];
    for (key, value) in flags {
        if let Some(value) = value {
            item.insert(txn, key, value);
        }
    }
    let texts = [
        ("shape", &patch.shape),
        ("fill", &patch.fill),
        ("stroke", &patch.stroke),
        ("color", &patch.color),
        ("align", &patch.align),
        ("valign", &patch.valign),
    ];
    for (key, value) in texts {
        if let Some(value) = value {
            item.insert(txn, key, value.clone());
        }
    }
    Ok(())
}

impl Alexa {
    pub(super) fn init_slides(&mut self, note_id: &str) -> Result<(), String> {
        let key = key_between(None, None)?;
        self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [slides, elements]| {
            let id = new_id();
            write_slide(txn, slides, &id, key, DEFAULT_BACKGROUND, "");
            let mut z = None;
            for element in layout_elements(&id, "title") {
                let next = key_after(z.as_deref())?;
                write_element(txn, elements, &element, next.clone())?;
                z = Some(next);
            }
            Ok(())
        })?;
        self.forget_history(note_id);
        Ok(())
    }

    fn slides_raw(&mut self, note_id: &str) -> Result<(Vec<RawSlide>, Vec<RawElement>), String> {
        self.check_type(note_id, NoteType::Slides)?;
        self.ensure_note(note_id)?;
        let note = self.notes.get(note_id).ok_or("note is not open")?;
        let [slides, elements] = ROOTS.map(|name| note.doc.get_or_insert_map(name));
        let txn = note.doc.transact();
        Ok((read_slides(&txn, &slides), read_elements(&txn, &elements)))
    }

    pub fn slides(&mut self, note_id: &str) -> Result<SlidesState, String> {
        let (slides, elements) = self.slides_raw(note_id)?;
        let mut by_slide: HashMap<String, Vec<SlideElement>> = HashMap::new();
        for item in elements {
            by_slide.entry(item.element.slide_id.clone()).or_default().push(item.element);
        }
        Ok(SlidesState {
            slides: slides
                .into_iter()
                .map(|slide| Slide {
                    elements: by_slide.remove(&slide.id).unwrap_or_default(),
                    id: slide.id,
                    background: slide.background,
                    notes: slide.notes,
                })
                .collect(),
        })
    }

    pub(super) fn refresh_slides_summary(&mut self, note_id: &str) -> Result<(), String> {
        let state = self.slides(note_id)?;
        let mut lines = vec![format!("{} 張投影片", state.slides.len())];
        lines.extend(
            state
                .slides
                .iter()
                .flat_map(|slide| slide.elements.iter())
                .filter(|element| !element.text.trim().is_empty())
                .map(|element| element.text.replace('\n', " ")),
        );
        self.set_summary(note_id, &lines.join("\n"))
    }

    pub fn edit_slides(&mut self, note_id: &str, op: SlidesOp) -> Result<SlidesEdit, String> {
        let (slides, elements) = self.slides_raw(note_id)?;
        // 方向鍵微調與打備忘稿才併成一步。
        let continuous = matches!(op, SlidesOp::MoveElements { .. } | SlidesOp::PatchSlide { notes: Some(_), .. });
        if !continuous {
            self.split_undo_step(note_id);
        }
        let created = self.apply_slides(note_id, &slides, &elements, op)?;
        if !continuous {
            self.split_undo_step(note_id);
        }
        self.refresh_slides_summary(note_id)?;
        Ok(SlidesEdit { state: self.slides(note_id)?, created })
    }

    fn apply_slides(
        &mut self,
        note_id: &str,
        slides: &[RawSlide],
        elements: &[RawElement],
        op: SlidesOp,
    ) -> Result<Option<String>, String> {
        let slide_index = |id: &str| {
            slides.iter().position(|slide| slide.id == id).ok_or_else(|| format!("unknown slide: {id}"))
        };
        let top_key = |slide_id: &str| {
            let top = elements.iter().rev().find(|item| item.element.slide_id == slide_id);
            key_after(top.map(|item| item.key.as_str()))
        };
        match op {
            SlidesOp::AddSlide { after, layout } => {
                let index = after.as_deref().map(slide_index).transpose()?.unwrap_or(slides.len().saturating_sub(1));
                let key = key_between(
                    slides.get(index).map(|slide| slide.key.as_str()),
                    slides.get(index + 1).map(|slide| slide.key.as_str()),
                )?;
                let id = new_id();
                let background = slides.get(index).map_or(DEFAULT_BACKGROUND, |slide| slide.background.as_str());
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [map, items]| {
                    write_slide(txn, map, &id, key, background, "");
                    let mut z = None;
                    for element in layout_elements(&id, &layout) {
                        let next = key_after(z.as_deref())?;
                        write_element(txn, items, &element, next.clone())?;
                        z = Some(next);
                    }
                    Ok(())
                })?;
                Ok(Some(id))
            }
            SlidesOp::DeleteSlide { id } => {
                slide_index(&id)?;
                if slides.len() < 2 {
                    return Err("簡報至少要留一張投影片".to_string());
                }
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [map, items]| {
                    map.remove(txn, &id);
                    for item in elements.iter().filter(|item| item.element.slide_id == id) {
                        items.remove(txn, &item.element.id);
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            SlidesOp::DuplicateSlide { id } => {
                let index = slide_index(&id)?;
                let source = &slides[index];
                let key = key_between(Some(&source.key), slides.get(index + 1).map(|slide| slide.key.as_str()))?;
                let copy = new_id();
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [map, items]| {
                    write_slide(txn, map, &copy, key, &source.background, &source.notes);
                    for item in elements.iter().filter(|item| item.element.slide_id == id) {
                        let mut element = item.element.clone();
                        element.id = new_id();
                        element.slide_id = copy.clone();
                        write_element(txn, items, &element, item.key.clone())?;
                    }
                    Ok(())
                })?;
                Ok(Some(copy))
            }
            SlidesOp::MoveSlide { id, before } => {
                slide_index(&id)?;
                let rest: Vec<&RawSlide> = slides.iter().filter(|slide| slide.id != id).collect();
                let at = match before.as_deref() {
                    Some(before) => rest.iter().position(|slide| slide.id == before).unwrap_or(rest.len()),
                    None => rest.len(),
                };
                let key = key_between(
                    at.checked_sub(1).map(|at| rest[at].key.as_str()),
                    rest.get(at).map(|slide| slide.key.as_str()),
                )?;
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [map, _]| {
                    item_of(map, txn, &id, "slide")?.insert(txn, "orderKey", key);
                    Ok(())
                })?;
                Ok(None)
            }
            SlidesOp::PatchSlide { id, background, notes, all } => {
                slide_index(&id)?;
                if background.as_deref().is_some_and(|color| color.is_empty() || !valid_color(color)) {
                    return Err("invalid color".to_string());
                }
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [map, _]| {
                    let item = item_of(map, txn, &id, "slide")?;
                    if let Some(notes) = notes {
                        set_text(&item, txn, "notes", &notes);
                    }
                    if let Some(background) = background {
                        let targets: Vec<&str> = if all.unwrap_or(false) {
                            slides.iter().map(|slide| slide.id.as_str()).collect()
                        } else {
                            vec![id.as_str()]
                        };
                        for target in targets {
                            item_of(map, txn, target, "slide")?.insert(txn, "background", background.clone());
                        }
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            SlidesOp::AddElement { slide_id, kind, shape, target, source } => {
                slide_index(&slide_id)?;
                if !valid_element_kind(&kind) {
                    return Err(format!("unknown element kind: {kind}"));
                }
                if shape.as_deref().is_some_and(|shape| !valid_shape(shape)) {
                    return Err("unknown shape".to_string());
                }
                let mut element = new_element(&slide_id, &kind, shape.as_deref());
                element.note_id = target;
                element.source = source;
                let key = top_key(&slide_id)?;
                let id = element.id.clone();
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    write_element(txn, items, &element, key)
                })?;
                Ok(Some(id))
            }
            SlidesOp::PatchElement { id, patch } => {
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    let item = item_of(items, txn, &id, "element")?;
                    apply_patch(&item, txn, &patch)
                })?;
                Ok(None)
            }
            SlidesOp::MoveElements { moves } => {
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    for step in &moves {
                        let item = item_of(items, txn, &step.id, "element")?;
                        item.insert(txn, "x", step.x);
                        item.insert(txn, "y", step.y);
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            SlidesOp::DeleteElements { ids } => {
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    for id in &ids {
                        items.remove(txn, id.as_str());
                    }
                    Ok(())
                })?;
                Ok(None)
            }
            SlidesOp::DuplicateElements { ids } => {
                let mut z: HashMap<String, Option<String>> = HashMap::new();
                let mut copies = Vec::new();
                for item in elements.iter().filter(|item| ids.contains(&item.element.id)) {
                    let slide = item.element.slide_id.clone();
                    let top = match z.get(&slide) {
                        Some(top) => top.clone(),
                        None => elements.iter().rev().find(|other| other.element.slide_id == slide).map(|other| other.key.clone()),
                    };
                    let key = key_after(top.as_deref())?;
                    z.insert(slide, Some(key.clone()));
                    let mut element = item.element.clone();
                    element.id = new_id();
                    element.x += PASTE_OFFSET;
                    element.y += PASTE_OFFSET;
                    copies.push((element, key));
                }
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    for (element, key) in &copies {
                        write_element(txn, items, element, key.clone())?;
                    }
                    Ok(())
                })?;
                Ok(copies.first().map(|(element, _)| element.id.clone()))
            }
            SlidesOp::OrderElement { id, front } => {
                let item = elements.iter().find(|item| item.element.id == id).ok_or("unknown element")?;
                let same: Vec<&RawElement> =
                    elements.iter().filter(|other| other.element.slide_id == item.element.slide_id).collect();
                let key = if front {
                    key_after(same.last().map(|other| other.key.as_str()))?
                } else {
                    key_between(None, same.first().map(|other| other.key.as_str()))?
                };
                self.office_edit(note_id, NoteType::Slides, ROOTS, |txn, [_, items]| {
                    item_of(items, txn, &id, "element")?.insert(txn, "zKey", key);
                    Ok(())
                })?;
                Ok(None)
            }
        }
    }
}

#[allow(dead_code)]
const _: f64 = STAGE_HEIGHT;
