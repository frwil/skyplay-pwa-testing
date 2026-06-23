use tauri::Manager;

mod commands;
mod retroarch;

/// Register all Tauri plugins and commands, then run the app.
pub fn run() {
    let retroarch_state = retroarch::RetroArchProcess::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(retroarch_state)
        .invoke_handler(tauri::generate_handler![
            commands::read_rom_file,
            commands::launch_sidecar,
            commands::stop_sidecar,
            commands::sidecar_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SkyPlay Desktop");
}
