// No console window behind the game on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![quit])
        .run(tauri::generate_context!())
        .expect("couldn't start the game window");
}
