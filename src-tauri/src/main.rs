// No console window behind the game on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::Manager;

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// The "path" entries of Steam's libraryfolders.vdf.
fn library_paths(vdf: &str) -> Vec<PathBuf> {
    vdf.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('"').collect();
            (parts.len() >= 4 && parts[1] == "path").then(|| PathBuf::from(parts[3].replace("\\\\", "\\")))
        })
        .collect()
}

#[cfg(windows)]
fn steam_root() -> Option<PathBuf> {
    use winreg::{enums::*, RegKey};
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .and_then(|k| k.get_value::<String, _>("SteamPath"))
        .or_else(|_| RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey("SOFTWARE\\WOW6432Node\\Valve\\Steam").and_then(|k| k.get_value::<String, _>("InstallPath")))
        .ok()
        .map(PathBuf::from)
}
#[cfg(not(windows))]
fn steam_root() -> Option<PathBuf> {
    None
}

struct Games {
    csgo: Option<PathBuf>,
    half_life: Option<PathBuf>,
}

// The two game folders in any Steam library. These are the only folders the game can read outside its own data.
fn games() -> &'static Games {
    static GAMES: OnceLock<Games> = OnceLock::new();
    GAMES.get_or_init(|| {
        let mut libraries: Vec<PathBuf> = steam_root().into_iter().collect();
        if let Some(root) = libraries.first().cloned() {
            if let Ok(vdf) = fs::read_to_string(root.join("steamapps/libraryfolders.vdf")) {
                libraries.extend(library_paths(&vdf));
            }
        }
        let find = |name: &str| libraries.iter().map(|l| l.join("steamapps/common").join(name)).find_map(|p| p.canonicalize().ok());
        Games { csgo: find("Counter-Strike Global Offensive"), half_life: find("Half-Life") }
    })
}

fn inside_games(path: &str) -> Option<PathBuf> {
    let real = Path::new(path).canonicalize().ok()?;
    let g = games();
    [&g.csgo, &g.half_life].into_iter().flatten().any(|root| real.starts_with(root)).then_some(real)
}

// A plain relative path only: nothing that can climb out of the app's own folder.
fn safe_relative(file: &str) -> Option<&Path> {
    let p = Path::new(file);
    (!file.is_empty() && p.components().all(|c| matches!(c, Component::Normal(_)))).then_some(p)
}

fn answer(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Content-Length", body.len())
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Allow-Methods", "*")
        .body(body)
        .unwrap()
}
const BYTES: &str = "application/octet-stream";
const JSON_TYPE: &str = "application/json";
fn not_found() -> Response<Vec<u8>> {
    answer(StatusCode::NOT_FOUND, "text/plain", Vec::new())
}
fn file_answer(path: &Path) -> Response<Vec<u8>> {
    let kind = if path.extension().is_some_and(|e| e == "json") { JSON_TYPE } else { BYTES };
    fs::read(path).map_or_else(|_| not_found(), |b| answer(StatusCode::OK, kind, b))
}

fn read_part(path: &Path, offset: u64, len: usize) -> std::io::Result<Vec<u8>> {
    let mut f = fs::File::open(path)?;
    f.seek(SeekFrom::Start(offset))?;
    let mut out = vec![0; len];
    f.read_exact(&mut out)?;
    Ok(out)
}

// The game's way to its local files: http://surfsteam.localhost/...
fn route(request: Request<Vec<u8>>, cache: Option<PathBuf>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return answer(StatusCode::OK, "text/plain", Vec::new());
    }
    let Ok(url) = url::Url::parse(&request.uri().to_string()) else { return not_found() };
    let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
    let path = q.get("path").map(String::as_str).unwrap_or("");
    let cached = q.get("p").and_then(|p| safe_relative(p)).zip(cache.as_ref()).map(|(rel, dir)| dir.join(rel));
    match (request.method().as_str(), url.path()) {
        ("GET", "/info") => {
            let text = |p: &Option<PathBuf>| p.as_ref().map(|p| p.to_string_lossy().trim_start_matches("\\\\?\\").replace('\\', "/"));
            let g = games();
            answer(StatusCode::OK, JSON_TYPE, serde_json::json!({ "csgo": text(&g.csgo), "halfLife": text(&g.half_life) }).to_string().into_bytes())
        }
        ("GET", "/exists") => answer(StatusCode::OK, "text/plain", inside_games(path).is_some().to_string().into_bytes()),
        ("GET", "/list") => match inside_games(path).and_then(|p| fs::read_dir(p).ok()) {
            Some(dir) => {
                let names: Vec<String> = dir.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
                answer(StatusCode::OK, JSON_TYPE, serde_json::to_vec(&names).unwrap())
            }
            None => not_found(),
        },
        ("GET", "/read") => {
            let Some(real) = inside_games(path) else { return not_found() };
            match (q.get("offset").and_then(|v| v.parse().ok()), q.get("len").and_then(|v| v.parse().ok())) {
                (Some(offset), Some(len)) => read_part(&real, offset, len).map_or_else(|_| not_found(), |b| answer(StatusCode::OK, BYTES, b)),
                _ => file_answer(&real),
            }
        }
        ("POST", "/cache") => {
            let Some(target) = cached else { return not_found() };
            let wrote = target.parent().map_or(Ok(()), fs::create_dir_all).and_then(|_| fs::write(&target, request.body()));
            answer(if wrote.is_ok() { StatusCode::OK } else { StatusCode::INTERNAL_SERVER_ERROR }, "text/plain", Vec::new())
        }
        ("POST", "/clear") => {
            if let Some(dir) = &cache {
                let _ = fs::remove_dir_all(dir);
            }
            answer(StatusCode::OK, "text/plain", Vec::new())
        }
        ("GET", "/asset") => {
            let Some(target) = cached else { return not_found() };
            if target.exists() {
                return file_answer(&target);
            }
            // Maps aren't copied: they're read from the game folder itself.
            let rel = q.get("p").map(String::as_str).unwrap_or("");
            match (rel.strip_prefix("maps/"), &games().csgo) {
                (Some(name), Some(csgo)) if name.to_lowercase().ends_with(".bsp") && safe_relative(name).is_some() => file_answer(&csgo.join("csgo/maps").join(name)),
                _ => not_found(),
            }
        }
        _ => not_found(),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![quit])
        .register_asynchronous_uri_scheme_protocol("surfsteam", |ctx, request, responder| {
            let cache = ctx.app_handle().path().app_local_data_dir().ok().map(|d| d.join("imported"));
            std::thread::spawn(move || responder.respond(route(request, cache)));
        })
        .run(tauri::generate_context!())
        .expect("couldn't start the game window");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_steam_library_paths() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t\t\"label\"\t\t\"\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\Games\"\n\t}\n}\n";
        assert_eq!(library_paths(vdf), vec![PathBuf::from("C:\\Program Files (x86)\\Steam"), PathBuf::from("D:\\Games")]);
    }

    #[test]
    fn cache_paths_cannot_climb_out() {
        assert!(safe_relative("cs2/knives/index.json").is_some());
        assert!(safe_relative("../secret").is_none());
        assert!(safe_relative("cs2/../../secret").is_none());
        assert!(safe_relative("C:\\Windows\\win.ini").is_none());
        assert!(safe_relative("/etc/passwd").is_none());
        assert!(safe_relative("").is_none());
    }

    #[test]
    fn files_outside_the_games_are_refused() {
        assert!(inside_games("C:\\Windows\\win.ini").is_none());
        assert!(inside_games(&std::env::current_exe().unwrap().to_string_lossy()).is_none());
    }
}
