//! 前端能呼叫的所有操作。這裡只轉接，規則都在 `model`。

use crate::arrange::Arrangement;
use crate::data_location::DataLocation;
use crate::workspaces::{WorkspaceList, Workspaces};
use crate::media::MediaStore;
use crate::model::{
    Alexa, ArrowDirection, BoardState, CardMatch, CellRange, ChartData, OfficeDocuments, CreatedChart, CreatedNote, CreatedWhiteboard,
    ImportedFiles, MindEdit, MindNode, Note, NoteDeletion, NoteFit, NoteLinks, NoteMove, NoteType, PlacedCard, RangeView,
    RenamedWhiteboard, SheetOp, SheetState, SlidesEdit, SlidesOp, SlidesState, TagInfo, NoteTag, VideoInfo, ViewState, WhiteboardDeletion,
    WorkspaceState, WriterBlock, WriterEdit, WriterOp, WriterPage,
};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, State};

pub struct AppState(pub Mutex<Alexa>);

fn locked<'a>(state: &'a State<'_, AppState>) -> Result<MutexGuard<'a, Alexa>, String> {
    state.0.lock().map_err(|_| "app state lock poisoned".to_string())
}

type SpacesState = Mutex<Workspaces>;

fn locked_spaces<'a>(spaces: &'a State<'_, SpacesState>) -> Result<MutexGuard<'a, Workspaces>, String> {
    spaces.lock().map_err(|_| "workspace list lock poisoned".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataLocationInfo {
    path: String,
    unavailable: Option<String>,
}

#[tauri::command]
pub fn get_data_location(location: State<'_, DataLocation>) -> DataLocationInfo {
    DataLocationInfo {
        path: location.current.display().to_string(),
        unavailable: location.unavailable.as_ref().map(|dir| dir.display().to_string()),
    }
}

#[tauri::command]
pub fn inspect_data_location(location: State<'_, DataLocation>, path: String) -> Result<bool, String> {
    location.inspect(Path::new(&path))
}

/// 成功時程式會重新啟動，不會回傳。
#[tauri::command(async)]
pub fn set_data_location(
    app: AppHandle,
    state: State<'_, AppState>,
    location: State<'_, DataLocation>,
    spaces: State<'_, SpacesState>,
    path: String,
) -> Result<(), String> {
    let target = PathBuf::from(path);
    let has_data = location.inspect(&target)?;
    let spaces = locked_spaces(&spaces)?;
    if !has_data {
        spaces.copy_media(&target)?;
    }
    // 鎖一直持有到重新啟動，複製之後的編輯才不會留在舊位置。
    let alexa = locked(&state)?;
    if !has_data {
        spaces.copy_media(&target)?;
        spaces.copy_databases(&alexa, &target)?;
    }
    location.remember(&target)?;
    app.restart()
}

#[tauri::command]
pub fn get_workspaces(spaces: State<'_, SpacesState>) -> Result<WorkspaceList, String> {
    Ok(locked_spaces(&spaces)?.list().clone())
}

/// 成功時程式會重新啟動，開啟新的 Workspace，不會回傳。
#[tauri::command(async)]
pub fn create_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    spaces: State<'_, SpacesState>,
    name: String,
) -> Result<(), String> {
    let mut spaces = locked_spaces(&spaces)?;
    let _alexa = locked(&state)?;
    spaces.create(&name)?;
    app.restart()
}

#[tauri::command]
pub fn rename_workspace(spaces: State<'_, SpacesState>, id: String, name: String) -> Result<WorkspaceList, String> {
    let mut spaces = locked_spaces(&spaces)?;
    spaces.rename(&id, &name)?;
    Ok(spaces.list().clone())
}

/// 成功時程式會重新啟動，不會回傳。
#[tauri::command(async)]
pub fn switch_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    spaces: State<'_, SpacesState>,
    id: String,
) -> Result<(), String> {
    // 鎖一直持有到重新啟動，切換之後不會再有編輯寫進來。
    let mut spaces = locked_spaces(&spaces)?;
    let _alexa = locked(&state)?;
    spaces.activate(&id)?;
    app.restart()
}

#[tauri::command(async)]
pub fn delete_workspace(spaces: State<'_, SpacesState>, id: String) -> Result<WorkspaceList, String> {
    let mut spaces = locked_spaces(&spaces)?;
    spaces.delete(&id)?;
    Ok(spaces.list().clone())
}

#[tauri::command]
pub fn get_workspace(state: State<'_, AppState>) -> Result<WorkspaceState, String> {
    locked(&state)?.workspace()
}

#[tauri::command]
pub fn create_whiteboard(
    state: State<'_, AppState>,
    parent_id: String,
    center_x: f64,
    center_y: f64,
) -> Result<CreatedWhiteboard, String> {
    locked(&state)?.create_whiteboard(&parent_id, center_x, center_y)
}

#[tauri::command]
pub fn rename_whiteboard(
    state: State<'_, AppState>,
    id: String,
    name: String,
) -> Result<RenamedWhiteboard, String> {
    locked(&state)?.rename_whiteboard(&id, &name)
}

#[tauri::command]
pub fn select_whiteboard(state: State<'_, AppState>, id: String) -> Result<WorkspaceState, String> {
    locked(&state)?.select_whiteboard(&id)
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> Result<Option<Note>, String> {
    locked(&state)?.note(&id)
}

#[tauri::command]
pub fn get_tags(state: State<'_, AppState>) -> Result<Vec<TagInfo>, String> {
    locked(&state)?.tags()
}

#[tauri::command]
pub fn add_note_tag(state: State<'_, AppState>, note_id: String, name: String) -> Result<NoteTag, String> {
    locked(&state)?.add_note_tag(&note_id, &name)
}

#[tauri::command]
pub fn remove_note_tag(state: State<'_, AppState>, note_id: String, tag_id: String) -> Result<(), String> {
    locked(&state)?.remove_note_tag(&note_id, &tag_id)
}

#[tauri::command]
pub fn rename_tag(state: State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    locked(&state)?.rename_tag(&id, &name)
}

#[tauri::command]
pub fn set_tag_color(state: State<'_, AppState>, id: String, color: String) -> Result<(), String> {
    locked(&state)?.set_tag_color(&id, &color)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> Result<(), String> {
    locked(&state)?.delete_tag(&id)
}

#[tauri::command]
pub fn get_mindmap(state: State<'_, AppState>, note_id: String) -> Result<Vec<MindNode>, String> {
    locked(&state)?.mindmap(&note_id)
}

#[tauri::command]
pub fn add_mind_node(
    state: State<'_, AppState>,
    note_id: String,
    parent_id: String,
    after: Option<String>,
    side: Option<String>,
) -> Result<MindEdit, String> {
    locked(&state)?.add_mind_node(&note_id, &parent_id, after.as_deref(), side.as_deref())
}

#[tauri::command]
pub fn duplicate_mind_node(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
    parent_id: String,
    after: Option<String>,
) -> Result<MindEdit, String> {
    locked(&state)?.duplicate_mind_node(&note_id, &node_id, &parent_id, after.as_deref())
}

#[tauri::command]
pub fn set_mind_style(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
    key: String,
    value: String,
) -> Result<Vec<MindNode>, String> {
    locked(&state)?.set_mind_style(&note_id, &node_id, &key, &value)
}

#[tauri::command]
pub fn randomize_mind_colors(state: State<'_, AppState>, note_id: String) -> Result<Vec<MindNode>, String> {
    locked(&state)?.randomize_mind_colors(&note_id)
}

#[tauri::command]
pub fn rename_mind_node(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
    text: String,
) -> Result<Vec<MindNode>, String> {
    locked(&state)?.rename_mind_node(&note_id, &node_id, &text)
}

#[tauri::command]
pub fn set_mind_collapsed(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
    collapsed: bool,
) -> Result<Vec<MindNode>, String> {
    locked(&state)?.set_mind_collapsed(&note_id, &node_id, collapsed)
}

#[tauri::command]
pub fn delete_mind_node(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
) -> Result<Vec<MindNode>, String> {
    locked(&state)?.delete_mind_node(&note_id, &node_id)
}

#[tauri::command]
pub fn move_mind_node(
    state: State<'_, AppState>,
    note_id: String,
    node_id: String,
    parent_id: String,
    before: Option<String>,
    side: Option<String>,
) -> Result<Vec<MindNode>, String> {
    locked(&state)?.move_mind_node(&note_id, &node_id, &parent_id, before.as_deref(), side.as_deref())
}

#[tauri::command]
pub fn get_note_library(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    locked(&state)?.note_library()
}

#[tauri::command]
pub fn get_card_notes(state: State<'_, AppState>) -> Result<Vec<Note>, String> {
    locked(&state)?.card_notes()
}

#[tauri::command]
pub fn get_office_documents(state: State<'_, AppState>) -> Result<OfficeDocuments, String> {
    locked(&state)?.office_documents()
}

#[tauri::command]
pub fn search_cards(
    state: State<'_, AppState>,
    query: String,
    exclude_id: String,
) -> Result<Vec<CardMatch>, String> {
    locked(&state)?.search_cards(&query, &exclude_id)
}

#[tauri::command]
pub fn create_card(state: State<'_, AppState>, content: String) -> Result<Note, String> {
    locked(&state)?.create_card(&content)
}

#[tauri::command]
pub fn get_note_deletion(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<NoteDeletion, String> {
    locked(&state)?.note_deletion(&ids)
}

#[tauri::command]
pub fn delete_notes(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    ids: Vec<String>,
) -> Result<(), String> {
    let unused = locked(&state)?.delete_notes(&ids)?;
    for file in unused {
        media.remove(&file);
    }
    Ok(())
}

/// 拖進來或用檔案對話框選的檔案。複製大檔案時不佔著鎖，其他操作不會被卡住。
/// 有問題的檔案列在 `failed`，其餘的照常匯入。
#[tauri::command(async)]
pub fn import_media_files(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    whiteboard_id: String,
    paths: Vec<String>,
    center_x: f64,
    center_y: f64,
) -> Result<ImportedFiles, String> {
    let mut files = Vec::new();
    let mut failed = Vec::new();
    for path in &paths {
        match media.import_file(Path::new(path)) {
            Ok(file) => files.push(file),
            Err(reason) => failed.push(reason),
        }
    }
    locked(&state)?.create_media_notes(&whiteboard_id, &files, center_x, center_y, failed)
}

fn header_text<'a>(request: &'a Request<'_>, name: &str) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| format!("missing header: {name}"))
}

fn header_number(request: &Request<'_>, name: &str) -> Result<f64, String> {
    header_text(request, name)?.parse().map_err(|_| format!("invalid header: {name}"))
}

/// 貼上或用檔案選擇器加入的圖片。內容是二進位，其餘參數放在標頭；
/// 檔名可能有中文，由前端編碼過。
#[tauri::command(async)]
pub fn import_image_bytes(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    request: Request<'_>,
) -> Result<ImportedFiles, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected binary image data".to_string());
    };
    let name = decode_header(header_text(&request, "x-name")?);
    let image = media.import_image_bytes(bytes, &name)?;
    locked(&state)?.create_media_notes(
        header_text(&request, "x-whiteboard")?,
        &[image],
        header_number(&request, "x-center-x")?,
        header_number(&request, "x-center-y")?,
        Vec::new(),
    )
}

/// 貼進 Writer 的圖片。檔名在標頭裡，由前端編碼過。
#[tauri::command(async)]
pub fn import_writer_image(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    request: Request<'_>,
) -> Result<Note, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected binary image data".to_string());
    };
    let name = decode_header(header_text(&request, "x-name")?);
    let image = media.import_image_bytes(bytes, &name)?;
    locked(&state)?.create_image_note(&image)
}

#[tauri::command]
pub fn save_drawio_xml(state: State<'_, AppState>, note_id: String, xml: String) -> Result<(), String> {
    locked(&state)?.save_drawio_xml(&note_id, &xml)
}

/// 內容是匯出的 PNG。換上新預覽後，舊檔案沒有筆記用到就刪掉。
#[tauri::command(async)]
pub fn save_drawio_preview(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    request: Request<'_>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected binary preview data".to_string());
    };
    let preview = media.import_image_bytes(bytes, "")?;
    let unused = locked(&state)?.save_drawio_preview(header_text(&request, "x-note")?, &preview)?;
    if let Some(file) = unused {
        media.remove(&file);
    }
    Ok(())
}

/// 前端解碼影片後量到的尺寸與封面。內容是封面圖，其餘參數放在標頭。
#[tauri::command(async)]
pub fn save_video_info(
    state: State<'_, AppState>,
    media: State<'_, MediaStore>,
    request: Request<'_>,
) -> Result<BoardState, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected binary poster data".to_string());
    };
    let poster = media.import_image_bytes(bytes, "")?;
    locked(&state)?.save_video_info(
        header_text(&request, "x-whiteboard")?,
        header_text(&request, "x-note")?,
        &VideoInfo {
            width: header_number(&request, "x-width")?,
            height: header_number(&request, "x-height")?,
            duration: header_number(&request, "x-duration")?,
            poster: poster.file,
        },
    )
}

/// `encodeURIComponent` 的反向。
pub(crate) fn decode_header(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let escaped = (bytes[index] == b'%')
            .then(|| value.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(byte) => {
                decoded.push(byte);
                index += 3;
            }
            None => {
                decoded.push(bytes[index]);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

#[tauri::command]
pub fn get_whiteboard_deletion(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<WhiteboardDeletion, String> {
    locked(&state)?.whiteboard_deletion(&ids)
}

#[tauri::command]
pub fn delete_whiteboards(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<WorkspaceState, String> {
    locked(&state)?.delete_whiteboards(&ids)
}

#[tauri::command]
pub fn get_note_links(state: State<'_, AppState>, id: String) -> Result<NoteLinks, String> {
    locked(&state)?.note_links(&id)
}

#[tauri::command]
pub fn get_board(state: State<'_, AppState>, whiteboard_id: String) -> Result<BoardState, String> {
    locked(&state)?.board(&whiteboard_id)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    whiteboard_id: String,
    note_type: NoteType,
    center_x: f64,
    center_y: f64,
) -> Result<CreatedNote, String> {
    locked(&state)?.create_note(&whiteboard_id, note_type, center_x, center_y)
}

#[tauri::command]
pub fn place_note(
    state: State<'_, AppState>,
    whiteboard_id: String,
    note_id: String,
    center_x: f64,
    center_y: f64,
) -> Result<PlacedCard, String> {
    locked(&state)?.place_note(&whiteboard_id, &note_id, center_x, center_y)
}

#[tauri::command]
pub fn place_table(
    state: State<'_, AppState>,
    whiteboard_id: String,
    note_id: String,
    table_id: String,
    center_x: f64,
    center_y: f64,
) -> Result<PlacedCard, String> {
    locked(&state)?.place_table(&whiteboard_id, &note_id, &table_id, center_x, center_y)
}

#[tauri::command]
pub fn set_placed_table(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_id: String,
    table_id: String,
) -> Result<BoardState, String> {
    locked(&state)?.set_placed_table(&whiteboard_id, &placed_id, &table_id)
}

#[tauri::command]
pub fn move_notes(
    state: State<'_, AppState>,
    whiteboard_id: String,
    moves: Vec<NoteMove>,
) -> Result<BoardState, String> {
    locked(&state)?.move_notes(&whiteboard_id, &moves)
}

#[tauri::command]
pub fn raise_notes(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_ids: Vec<String>,
) -> Result<BoardState, String> {
    locked(&state)?.raise_notes(&whiteboard_id, &placed_ids)
}

#[tauri::command]
pub fn arrange_notes(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_ids: Vec<String>,
    arrangement: Arrangement,
) -> Result<BoardState, String> {
    locked(&state)?.arrange_notes(&whiteboard_id, &placed_ids, arrangement)
}

#[tauri::command]
pub fn resize_note(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<BoardState, String> {
    locked(&state)?.resize_note(&whiteboard_id, &placed_id, x, y, w, h)
}

#[tauri::command]
pub fn set_auto_fit(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_id: String,
    auto_fit: bool,
) -> Result<BoardState, String> {
    locked(&state)?.set_auto_fit(&whiteboard_id, &placed_id, auto_fit)
}

#[tauri::command]
pub fn set_collapsed(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_id: String,
    collapsed: bool,
    collapsed_h: f64,
) -> Result<BoardState, String> {
    locked(&state)?.set_collapsed(&whiteboard_id, &placed_id, collapsed, collapsed_h)
}

#[tauri::command]
pub fn fit_notes(
    state: State<'_, AppState>,
    whiteboard_id: String,
    fits: Vec<NoteFit>,
) -> Result<(), String> {
    locked(&state)?.fit_notes(&whiteboard_id, &fits)
}

#[tauri::command]
pub fn remove_note(
    state: State<'_, AppState>,
    whiteboard_id: String,
    placed_id: String,
) -> Result<BoardState, String> {
    locked(&state)?.remove_note(&whiteboard_id, &placed_id)
}

#[tauri::command]
pub fn create_arrow(
    state: State<'_, AppState>,
    whiteboard_id: String,
    from_placed_id: String,
    to_placed_id: String,
) -> Result<BoardState, String> {
    locked(&state)?.create_arrow(&whiteboard_id, &from_placed_id, &to_placed_id)
}

#[tauri::command]
pub fn update_arrow(
    state: State<'_, AppState>,
    whiteboard_id: String,
    id: String,
    direction: Option<ArrowDirection>,
    label: Option<String>,
) -> Result<BoardState, String> {
    locked(&state)?.update_arrow(&whiteboard_id, &id, direction, label.as_deref())
}

#[tauri::command]
pub fn remove_arrow(
    state: State<'_, AppState>,
    whiteboard_id: String,
    id: String,
) -> Result<BoardState, String> {
    locked(&state)?.remove_arrow(&whiteboard_id, &id)
}

#[tauri::command]
pub fn update_note_content(
    state: State<'_, AppState>,
    note_id: String,
    content: String,
) -> Result<(), String> {
    locked(&state)?.update_note_content(&note_id, &content)
}

#[tauri::command]
pub fn set_code_language(
    state: State<'_, AppState>,
    note_id: String,
    language: String,
) -> Result<(), String> {
    locked(&state)?.set_code_language(&note_id, &language)
}

#[tauri::command]
pub fn get_view(
    state: State<'_, AppState>,
    whiteboard_id: String,
) -> Result<Option<ViewState>, String> {
    locked(&state)?.view(&whiteboard_id)
}

#[tauri::command]
pub fn save_view(
    state: State<'_, AppState>,
    whiteboard_id: String,
    view: ViewState,
) -> Result<(), String> {
    locked(&state)?.save_view(&whiteboard_id, view)
}

#[tauri::command]
pub fn create_document(state: State<'_, AppState>, note_type: NoteType) -> Result<Note, String> {
    locked(&state)?.create_document(note_type)
}

#[tauri::command]
pub fn rename_note(state: State<'_, AppState>, note_id: String, name: String) -> Result<(), String> {
    locked(&state)?.rename_note(&note_id, &name)
}

#[tauri::command]
pub fn undo_note(state: State<'_, AppState>, note_id: String) -> Result<bool, String> {
    locked(&state)?.undo_note(&note_id)
}

#[tauri::command]
pub fn redo_note(state: State<'_, AppState>, note_id: String) -> Result<bool, String> {
    locked(&state)?.redo_note(&note_id)
}

#[tauri::command]
pub fn get_writer(state: State<'_, AppState>, note_id: String) -> Result<Vec<WriterBlock>, String> {
    locked(&state)?.writer(&note_id)
}

#[tauri::command]
pub fn get_writer_page(state: State<'_, AppState>, note_id: String) -> Result<WriterPage, String> {
    locked(&state)?.writer_page(&note_id)
}

#[tauri::command]
pub fn set_writer_page(
    state: State<'_, AppState>,
    note_id: String,
    page: WriterPage,
    typing: bool,
) -> Result<WriterPage, String> {
    locked(&state)?.set_writer_page(&note_id, page, typing)
}

#[tauri::command]
pub fn edit_writer(state: State<'_, AppState>, note_id: String, op: WriterOp) -> Result<WriterEdit, String> {
    locked(&state)?.edit_writer(&note_id, op)
}

#[tauri::command]
pub fn get_sheet(state: State<'_, AppState>, note_id: String) -> Result<SheetState, String> {
    locked(&state)?.sheet(&note_id)
}

#[tauri::command]
pub fn edit_sheet(state: State<'_, AppState>, note_id: String, op: SheetOp) -> Result<SheetState, String> {
    locked(&state)?.edit_sheet(&note_id, op)
}

#[tauri::command]
pub fn get_cell_range(state: State<'_, AppState>, source: CellRange) -> Result<RangeView, String> {
    locked(&state)?.cell_range(&source)
}

#[tauri::command]
pub fn create_chart(
    state: State<'_, AppState>,
    source: CellRange,
    tab_id: String,
    kind: String,
) -> Result<CreatedChart, String> {
    locked(&state)?.create_chart(source, &tab_id, &kind)
}

#[tauri::command]
pub fn get_chart(state: State<'_, AppState>, note_id: String) -> Result<ChartData, String> {
    locked(&state)?.chart(&note_id)
}

#[tauri::command]
pub fn set_chart(
    state: State<'_, AppState>,
    note_id: String,
    kind: Option<String>,
    series_by: Option<String>,
) -> Result<ChartData, String> {
    locked(&state)?.set_chart(&note_id, kind.as_deref(), series_by.as_deref())
}

#[tauri::command]
pub fn get_slides(state: State<'_, AppState>, note_id: String) -> Result<SlidesState, String> {
    locked(&state)?.slides(&note_id)
}

#[tauri::command]
pub fn edit_slides(state: State<'_, AppState>, note_id: String, op: SlidesOp) -> Result<SlidesEdit, String> {
    locked(&state)?.edit_slides(&note_id, op)
}
