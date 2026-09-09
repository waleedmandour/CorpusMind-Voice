// CorpusMind Voice — desktop shell (Tauri 2).
// Boots the bundled Next.js standalone server as a Node sidecar, waits until
// it accepts connections, then points the webview at it. Fully offline.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 34567;

fn wait_for_port(port: u16, timeout: std::time::Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    false
}

fn main() {
    // Windows: auto-grant microphone capture inside WebView2 (research app,
    // on-device processing only). Equivalent to accepting the permission prompt.
    #[cfg(target_os = "windows")]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--use-fake-ui-for-media-stream",
    );

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Desktop data locations (writable regardless of install dir)
            let data_dir = handle
                .path()
                .app_data_dir()
                .expect("no app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let models_dir = data_dir.join("models");
            std::fs::create_dir_all(&models_dir)?;

            // Seed the corpus database on first run
            let db_path = data_dir.join("custom.db");
            if !db_path.exists() {
                let resource_dir = handle.path().resource_dir()?;
                let seed = resource_dir.join("seed.db");
                if seed.exists() {
                    std::fs::copy(&seed, &db_path)?;
                }
            }

            // Standalone server lives in <resources>/standalone/server.js
            let server_dir = handle.path().resource_dir()?.join("standalone");

            tauri::async_runtime::spawn(async move {
                match handle.shell().sidecar("node") {
                    Ok(sidecar) => {
                        let spawn = sidecar
                            .args(["server.js"])
                            .current_dir(&server_dir)
                            .env("NODE_ENV", "production")
                            .env("PORT", PORT.to_string())
                            .env("HOSTNAME", "127.0.0.1")
                            .env("DATABASE_URL", format!("file:{}", db_path.display()))
                            // Whisper model manager storage — persists across restarts
                            .env("CM_MODELS_DIR", models_dir.as_os_str())
                            .env("CM_DESKTOP", "1");

                        match spawn.spawn() {
                            Ok((_rx, _child)) => {
                                if wait_for_port(PORT, std::time::Duration::from_secs(30)) {
                                    if let Some(w) = handle.get_webview_window("main") {
                                        let _ = w.eval(&format!(
                                            "window.location.replace('http://127.0.0.1:{PORT}/');"
                                        ));
                                    }
                                }
                            }
                            Err(e) => eprintln!("sidecar spawn failed: {e}"),
                        }
                    }
                    Err(e) => eprintln!("sidecar resolution failed: {e}"),
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running CorpusMind Voice");
}
