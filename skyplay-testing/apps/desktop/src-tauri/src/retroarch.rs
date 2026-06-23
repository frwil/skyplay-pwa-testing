use std::process::{Child, Command};
use std::sync::Mutex;

/// Manages the RetroArch sidecar process lifecycle.
///
/// Launch → RetroArch runs in fullscreen with the given core + ROM
/// Stop  → kills the child process
/// Status → checks if the process is still alive
pub struct RetroArchProcess {
    child: Mutex<Option<Child>>,
}

impl RetroArchProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    /// Launch RetroArch with a core and ROM.
    pub fn launch(&self, resource_dir: &str, rom_path: &str, core_name: &str) -> Result<(), String> {
        let retroarch_exe = if cfg!(target_os = "windows") {
            format!("{}/retroarch/retroarch.exe", resource_dir)
        } else if cfg!(target_os = "macos") {
            format!("{}/retroarch/retroarch", resource_dir)
        } else {
            format!("{}/retroarch/retroarch", resource_dir)
        };

        let core_path = format!("{}/retroarch/cores/{}", resource_dir, core_name);

        let child = Command::new(&retroarch_exe)
            .args(["-L", &core_path, rom_path, "--fullscreen"])
            .spawn()
            .map_err(|e| format!("Failed to launch RetroArch: {}", e))?;

        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);

        Ok(())
    }

    /// Kill the running RetroArch process.
    pub fn stop(&self) -> Result<(), String> {
        let mut guard = self.child.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.take() {
            child.kill().map_err(|e| format!("Failed to stop RetroArch: {}", e))?;
        }
        Ok(())
    }

    /// Check whether the RetroArch process is still running.
    pub fn is_running(&self) -> bool {
        let guard = match self.child.lock() {
            Ok(g) => g,
            Err(_) => return false,
        };
        guard.as_ref().map_or(false, |c| {
            c.try_wait().ok().flatten().is_none()
        })
    }
}
