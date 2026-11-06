//! Draw.io 編輯器的靜態檔案，以及它帶來的安全邊界。
//!
//! Windows 上 Tauri 會把 IPC 注入每個 iframe，而且依最上層頁面的網址判斷來源，
//! iframe 因此被當成本機頁面，裡面的腳本能呼叫所有指令。兩道防線缺一不可：
//! `is_trusted_origin` 擋下 app 的指令，但 `plugin:*` 指令不經過它；
//! 回應裡的 CSP 不讓 iframe 連到 IPC，內建指令也一起擋住。

use std::path::{Path, PathBuf};
use tauri::http::{header, Response};

const CONTENT_SECURITY_POLICY: &str = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; \
    connect-src 'self' data: blob:; frame-src 'self' blob:; object-src 'none'";

/// 開發時頁面由 Vite 提供，正式版由 Tauri 提供，Windows 與其他平台的網址不同。
const TRUSTED_ORIGINS: &[&str] = &["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
#[cfg(debug_assertions)]
const DEV_ORIGIN: &str = "http://localhost:1420";

/// IPC 請求是否來自 app 自己的頁面。沒有 Origin 的請求一律不信任。
pub fn is_trusted_origin(origin: &str) -> bool {
    #[cfg(debug_assertions)]
    if origin == DEV_ORIGIN {
        return true;
    }
    TRUSTED_ORIGINS.contains(&origin)
}

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "html" => "text/html; charset=utf-8",
        "js" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "gif" => "image/gif",
        "jpg" | "jpeg" => "image/jpeg",
        "ico" => "image/x-icon",
        "json" => "application/json",
        "xml" => "application/xml",
        "txt" => "text/plain; charset=utf-8",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

#[derive(Clone)]
pub struct DrawioAssets {
    root: PathBuf,
}

impl DrawioAssets {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// 路徑的每一段都要是普通名稱，走不出資源資料夾。
    fn resolve(&self, path: &str) -> Option<PathBuf> {
        let mut resolved = self.root.clone();
        for part in path.split('/') {
            let safe = !part.is_empty()
                && part != "."
                && part != ".."
                && !part.contains(['\\', ':'])
                && Path::new(part).file_name().is_some();
            if !safe {
                return None;
            }
            resolved.push(part);
        }
        Some(resolved)
    }

    /// `path` 是網址的路徑，已經解碼。
    pub fn serve(&self, path: &str) -> Response<Vec<u8>> {
        let path = path.trim_start_matches('/');
        let path = if path.is_empty() { "index.html" } else { path };
        let builder = Response::builder().header(header::CONTENT_SECURITY_POLICY, CONTENT_SECURITY_POLICY);
        match self.resolve(path).and_then(|file| std::fs::read(file).ok()) {
            Some(body) => builder.status(200).header(header::CONTENT_TYPE, mime_of(path)).body(body),
            None => builder.status(404).body(Vec::new()),
        }
        .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    fn assets() -> (DrawioAssets, PathBuf) {
        let base = std::env::temp_dir().join(format!("alexa-drawio-{}", Uuid::new_v4()));
        let root = base.join("drawio");
        fs::create_dir_all(root.join("js")).unwrap();
        fs::write(root.join("index.html"), "<html>").unwrap();
        fs::write(root.join("js/app.min.js"), "var a").unwrap();
        fs::write(base.join("secret.db"), "secret").unwrap();
        (DrawioAssets::new(root), base)
    }

    #[test]
    fn serves_files_with_their_type_and_the_security_policy() {
        let (drawio, _) = assets();
        let page = drawio.serve("/");
        assert_eq!(page.status(), 200);
        assert_eq!(page.body(), b"<html>");
        assert!(page.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with("text/html"));

        let script = drawio.serve("/js/app.min.js");
        assert!(script.headers()[header::CONTENT_TYPE].to_str().unwrap().starts_with("text/javascript"));
    }

    #[test]
    fn every_response_blocks_ipc_even_when_the_file_is_missing() {
        let (drawio, _) = assets();
        for response in [drawio.serve("/index.html"), drawio.serve("/missing.js")] {
            let policy = response.headers()[header::CONTENT_SECURITY_POLICY].to_str().unwrap();
            assert!(policy.contains("connect-src 'self' data: blob:"), "{policy}");
            assert!(!policy.contains("ipc:"), "{policy}");
        }
    }

    #[test]
    fn paths_cannot_leave_the_asset_folder() {
        let (drawio, base) = assets();
        for bad in [
            "../secret.db",
            "/../secret.db",
            "js/../../secret.db",
            "..\\secret.db",
            "js\\..\\..\\secret.db",
            "C:\\Windows\\win.ini",
            "C:/Windows/win.ini",
            "/js//app.min.js",
            "./index.html",
        ] {
            assert_eq!(drawio.serve(bad).status(), 404, "{bad}");
        }
        assert!(base.join("secret.db").exists());
    }

    #[test]
    fn only_the_app_itself_is_a_trusted_origin() {
        assert!(is_trusted_origin("http://tauri.localhost"));
        assert!(is_trusted_origin("tauri://localhost"));
        assert!(is_trusted_origin("http://localhost:1420"));
        for origin in [
            "http://drawio.localhost",
            "http://media.localhost",
            "http://tauri.localhost.evil.test",
            "null",
            "",
        ] {
            assert!(!is_trusted_origin(origin), "{origin}");
        }
    }
}
