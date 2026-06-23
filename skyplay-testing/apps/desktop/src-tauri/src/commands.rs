use tauri::{AppHandle, Manager, State};
use crate::retroarch::RetroArchProcess;

/// Read a ROM file from the local filesystem and return its bytes.
#[tauri::command]
pub fn read_rom_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Launch the RetroArch sidecar for a desktop-only system.
///
/// `system` determines which libretro core to use:
/// - "neogeo" → fbneo_libretro
/// - "ps1"    → pcsx_rearmed_libretro
#[tauri::command]
pub fn launch_sidecar(
    app: AppHandle,
    state: State<'_, RetroArchProcess>,
    rom_path: String,
    system: String,
) -> Result<(), String> {
    let core = match system.as_str() {
        "neogeo" => {
            if cfg!(target_os = "windows") { "fbneo_libretro.dll" }
            else if cfg!(target_os = "macos") { "fbneo_libretro.dylib" }
            else { "fbneo_libretro.so" }
        }
        "ps1" => {
            if cfg!(target_os = "windows") { "pcsx_rearmed_libretro.dll" }
            else if cfg!(target_os = "macos") { "pcsx_rearmed_libretro.dylib" }
            else { "pcsx_rearmed_libretro.so" }
        }
        _ => return Err(format!("Unknown system for sidecar launch: {}", system)),
    };

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .to_string();

    state.launch(&resource_dir, &rom_path, core)
}

/// Kill the running RetroArch process.
#[tauri::command]
pub fn stop_sidecar(state: State<'_, RetroArchProcess>) -> Result<(), String> {
    state.stop()
}

/// Check whether RetroArch is still running.
#[tauri::command]
pub fn sidecar_status(state: State<'_, RetroArchProcess>) -> Result<bool, String> {
    Ok(state.is_running())
}
