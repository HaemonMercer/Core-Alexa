mod arrange;
mod commands;
mod data_location;
mod drawio;
mod media;
mod model;
mod order;
mod persisted;
mod storage;
mod workspaces;

use commands::{decode_header, AppState};
use data_location::{saved_location, DataLocation, DATABASE_FILE};
use drawio::{is_trusted_origin, DrawioAssets};
use media::MediaStore;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::http::{header, Response};
use tauri::ipc::Invoke;
use tauri::{Manager, Wry};
use workspaces::Workspaces;

/// 開發版可用 ALEXA_DATA_DIR 指定資料夾，測試時不會碰到真實資料。
fn base_dir(app: &tauri::App) -> tauri::Result<PathBuf> {
    #[cfg(debug_assertions)]
    if let Some(dir) = std::env::var_os("ALEXA_DATA_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path().app_data_dir()
}

/// 選的位置打不開時改用基本資料夾。不能在那裡建新資料庫，
/// 否則外接硬碟晚點接上時，使用者會以為資料不見了。
fn open_data(base: PathBuf) -> Result<(model::Alexa, DataLocation, Workspaces), String> {
    let saved = saved_location(&base);
    let opened = saved.as_ref().filter(|dir| dir.join(DATABASE_FILE).is_file()).and_then(|dir| {
        let spaces = Workspaces::load(dir);
        let alexa = model::Alexa::open(&spaces.active_folder().join(DATABASE_FILE)).ok()?;
        Some((alexa, spaces))
    });
    if let (Some((alexa, spaces)), Some(current)) = (opened, saved.clone()) {
        return Ok((alexa, DataLocation { base, current, unavailable: None }, spaces));
    }
    let spaces = Workspaces::load(&base);
    let alexa = model::Alexa::open(&spaces.active_folder().join(DATABASE_FILE))?;
    Ok((alexa, DataLocation { current: base.clone(), base, unavailable: saved }, spaces))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let base = base_dir(app)?;
            std::fs::create_dir_all(&base)?;
            let (alexa, location, spaces) = open_data(base)?;
            app.manage(AppState(Mutex::new(alexa)));
            app.manage(MediaStore::new(spaces.active_folder().join("media")));
            app.manage(location);
            app.manage(Mutex::new(spaces));
            app.manage(DrawioAssets::new(app.path().resource_dir()?.join("drawio")));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("drawio", |ctx, request, responder| {
            let assets = ctx.app_handle().state::<DrawioAssets>().inner().clone();
            std::thread::spawn(move || {
                responder.respond(assets.serve(&decode_header(request.uri().path())));
            });
        })
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let media = ctx.app_handle().state::<MediaStore>().inner().clone();
            // 讀檔案不能卡住 WebView 的執行緒。
            std::thread::spawn(move || {
                let file = request.uri().path().trim_start_matches('/');
                let range = request.headers().get(header::RANGE).and_then(|value| value.to_str().ok());
                let response: Response<Vec<u8>> = media.serve(file, range);
                responder.respond(response);
            });
        })
        .invoke_handler({
            let handler: Box<dyn Fn(Invoke<Wry>) -> bool + Send + Sync> = Box::new(tauri::generate_handler![
            commands::get_data_location,
            commands::inspect_data_location,
            commands::set_data_location,
            commands::get_workspaces,
            commands::create_workspace,
            commands::rename_workspace,
            commands::switch_workspace,
            commands::delete_workspace,
            commands::get_workspace,
            commands::create_whiteboard,
            commands::rename_whiteboard,
            commands::select_whiteboard,
            commands::get_note,
            commands::get_note_library,
            commands::get_card_notes,
            commands::get_office_documents,
            commands::get_tags,
            commands::add_note_tag,
            commands::remove_note_tag,
            commands::rename_tag,
            commands::set_tag_color,
            commands::delete_tag,
            commands::get_mindmap,
            commands::add_mind_node,
            commands::duplicate_mind_node,
            commands::set_mind_style,
            commands::randomize_mind_colors,
            commands::rename_mind_node,
            commands::set_mind_collapsed,
            commands::delete_mind_node,
            commands::move_mind_node,
            commands::search_cards,
            commands::create_card,
            commands::get_note_deletion,
            commands::delete_notes,
            commands::get_whiteboard_deletion,
            commands::delete_whiteboards,
            commands::get_note_links,
            commands::get_board,
            commands::create_note,
            commands::import_media_files,
            commands::import_image_bytes,
            commands::save_video_info,
            commands::set_code_language,
            commands::save_drawio_xml,
            commands::save_drawio_preview,
            commands::place_note,
            commands::place_table,
            commands::set_placed_table,
            commands::move_notes,
            commands::raise_notes,
            commands::arrange_notes,
            commands::resize_note,
            commands::fit_notes,
            commands::set_auto_fit,
            commands::set_collapsed,
            commands::remove_note,
            commands::create_arrow,
            commands::update_arrow,
            commands::remove_arrow,
            commands::update_note_content,
            commands::get_view,
            commands::save_view,
            commands::create_document,
            commands::rename_note,
            commands::undo_note,
            commands::redo_note,
            commands::get_writer,
            commands::edit_writer,
            commands::import_writer_image,
            commands::get_writer_page,
            commands::set_writer_page,
            commands::get_sheet,
            commands::edit_sheet,
            commands::get_cell_range,
            commands::create_chart,
            commands::get_chart,
            commands::set_chart,
            commands::get_slides,
            commands::edit_slides
        ]);
            // 只有 app 自己的頁面能呼叫指令，Draw.io 的 iframe 不行，原因見 `drawio.rs`。
            move |invoke: Invoke<Wry>| {
                let origin = invoke.message.headers().get("origin").and_then(|value| value.to_str().ok());
                if origin.is_some_and(is_trusted_origin) {
                    return handler(invoke);
                }
                invoke.resolver.reject("forbidden origin");
                true
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
