// CorpusMind Voice — desktop shell (Tauri 2).
// Boots the bundled Next.js standalone server as a Node sidecar, waits until
// it accepts connections, then points the webview at it. Fully offline.
//
// v1.3 changes:
//   - the sidecar gets CM_DATA_DIR (the OS app-data folder) so audio,
//     worker output and config land on writable storage. Up to 1.2.x they
//     were written under the server's cwd, i.e. the install directory,
//     which is read-only for MSI per-machine installs and broke upload and
//     recording.
//   - recordings saved by <= 1.2.x into the install dir are migrated once
//     into the app data folder (best effort).
//   - sidecar stdout/stderr is captured into logs/sidecar.log inside the
//     app data folder instead of being discarded, so field reports carry
//     the server's own error lines.
//   - when Settings > Phone companion is enabled (companion.json), a second
//     Node sidecar runs scripts/companion.cjs: a token-gated LAN proxy so
//     the phone can open the same PWA.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 34567;
const COMPANION_HTTP_PORT: u16 = 34568;
const COMPANION_TLS_PORT: u16 = 34569;

// Keeps handles to the Node sidecars so the shell can terminate them on
// exit. Without this, closing the window leaves node.exe running in the
// background. It then locks node.exe and the Prisma query engine DLL inside
// the install directory, which breaks every later upgrade or uninstall with
// NSIS "Error opening file for writing" dialogs.
struct Sidecars(Mutex<Vec<CommandChild>>);

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

fn append_log(path: &std::path::Path, line: &[u8]) {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = f.write_all(line);
        if line.last() != Some(&b'\n') {
            let _ = f.write_all(b"\n");
        }
    }
}

// Drain a sidecar's event stream into a log file. The shell previously
// dropped stdout/stderr (`let (_rx, child)`), which made every packaged-app
// failure a guessing game.
fn pump_events(mut rx: tauri::async_runtime::Receiver<CommandEvent>, log_path: std::path::PathBuf) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    append_log(&log_path, &line);
                }
                CommandEvent::Error(line) => append_log(&log_path, line.as_bytes()),
                CommandEvent::Terminated(_) => append_log(&log_path, b"[sidecar terminated]"),
                _ => {}
            }
        }
    });
}

// companion.json is written by the Settings UI (POST /api/companion) next to
// custom.db. It must exist, be enabled, and carry a non-empty token.
fn read_companion_config(data_dir: &std::path::Path) -> Option<Value> {
    let raw = std::fs::read_to_string(data_dir.join("companion.json")).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    if !v.get("enabled").and_then(Value::as_bool).unwrap_or(false) {
        return None;
    }
    if v.get("token")
        .and_then(Value::as_str)
        .unwrap_or("")
        .is_empty()
    {
        return None;
    }
    Some(v)
}

// Move recordings saved by <= 1.2.x into the install directory (writable
// only for per-user installs) into the app data audio store. Copy, not move:
// the source may sit under a read-only Program Files tree.
fn migrate_legacy_audio(server_dir: &std::path::Path, audio_dir: &std::path::Path) {
    let legacy = server_dir.join("data").join("audio");
    if !legacy.is_dir() {
        return;
    }
    let mut copied = 0usize;
    if let Ok(entries) = std::fs::read_dir(&legacy) {
        for entry in entries.flatten() {
            let from = entry.path();
            if !from.is_file() {
                continue;
            }
            let to = audio_dir.join(entry.file_name());
            if to.exists() {
                continue;
            }
            if std::fs::copy(&from, &to).is_ok() {
                copied += 1;
            }
        }
    }
    if copied > 0 {
        eprintln!("migrated {copied} recording(s) from the install dir into app data");
    }
}

// Windows safety net: bind the sidecar to a Job Object flagged with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE. When this shell process terminates,
// for any reason (normal exit, crash, force kill), the operating system
// closes our job handle and instantly terminates node.exe with it. This
// makes orphaned sidecars impossible, even if Rust cleanup never runs.
#[cfg(target_os = "windows")]
fn bind_job_object(pid: u32) {
    if pid == 0 {
        return;
    }
    unsafe {
        use windows::Win32::System::JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
        };

        let job = match CreateJobObjectW(None, None) {
            Ok(h) => h,
            Err(e) => {
                eprintln!("job object creation failed: {e}");
                return;
            }
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if let Err(e) = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) {
            eprintln!("job object setup failed: {e}");
            return;
        }
        match OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) {
            Ok(p) => {
                if let Err(e) = AssignProcessToJobObject(job, p) {
                    eprintln!("job assignment failed: {e}");
                }
            }
            Err(e) => eprintln!("sidecar process open failed: {e}"),
        }
    }
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
        .manage(Sidecars(Mutex::new(Vec::new())))
        .setup(|app| {
            let handle = app.handle().clone();

            // Desktop data locations (writable regardless of install dir)
            let data_dir = handle.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir)?;
            let models_dir = data_dir.join("models");
            std::fs::create_dir_all(&models_dir)?;
            let audio_dir = data_dir.join("audio");
            std::fs::create_dir_all(&audio_dir)?;
            let logs_dir = data_dir.join("logs");
            std::fs::create_dir_all(&logs_dir)?;

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
            migrate_legacy_audio(&server_dir, &audio_dir);

            // Phone companion: enabled in Settings, persisted by the server
            // as companion.json; decide BEFORE the main sidecar boots.
            let companion_cfg = read_companion_config(&data_dir);
            let companion_token = companion_cfg
                .as_ref()
                .map(|c| {
                    c.get("token")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string()
                })
                .unwrap_or_default();

            tauri::async_runtime::spawn(async move {
                let sidecar_log = logs_dir.join("sidecar.log");
                match handle.shell().sidecar("node") {
                    Ok(sidecar) => {
                        let spawn = sidecar
                            .args(["server.js"])
                            .current_dir(&server_dir)
                            .env("NODE_ENV", "production")
                            .env("PORT", PORT.to_string())
                            .env("HOSTNAME", "127.0.0.1")
                            .env("DATABASE_URL", format!("file:{}", db_path.display()))
                            // Whisper model manager storage + audio/output/config
                            // root - persists across restarts, writable everywhere
                            .env("CM_MODELS_DIR", models_dir.as_os_str())
                            .env("CM_DATA_DIR", data_dir.as_os_str())
                            .env("CM_DESKTOP", "1");
                        // The server needs to know the pairing token so
                        // /api/config can report the companion as ACTIVE
                        // (the Settings card would otherwise ask for a
                        // restart forever).
                        let spawn = if companion_token.is_empty() {
                            spawn
                        } else {
                            spawn.env("CM_TOKEN", companion_token.as_str())
                        };

                        match spawn.spawn() {
                            Ok((rx, child)) => {
                                #[cfg(target_os = "windows")]
                                bind_job_object(child.pid());

                                pump_events(rx, sidecar_log);

                                // Track the child so normal window close also
                                // terminates the server (cross-platform path).
                                let state = handle.state::<Sidecars>();
                                if let Ok(mut guard) = state.0.lock() {
                                    guard.push(child);
                                }

                                if wait_for_port(PORT, std::time::Duration::from_secs(30)) {
                                    if let Some(w) = handle.get_webview_window("main") {
                                        let _ = w.eval(format!(
                                            "window.location.replace('http://127.0.0.1:{PORT}/');"
                                        ));
                                    }
                                }

                                // Phone companion proxy: only after the main
                                // server is up (its upstream), same Node binary.
                                if let Some(cfg) = companion_cfg {
                                    let token = companion_token;
                                    let http_port = cfg
                                        .get("port")
                                        .and_then(Value::as_u64)
                                        .unwrap_or(COMPANION_HTTP_PORT as u64)
                                        as u16;
                                    let tls_port = cfg
                                        .get("tlsPort")
                                        .and_then(Value::as_u64)
                                        .unwrap_or(COMPANION_TLS_PORT as u64)
                                        as u16;
                                    let cert =
                                        cfg.get("cert").and_then(Value::as_str).map(str::to_string);
                                    let key =
                                        cfg.get("key").and_then(Value::as_str).map(str::to_string);

                                    match handle.shell().sidecar("node") {
                                        Ok(csidecar) => {
                                            let mut cspawn = csidecar
                                                .args(["companion.cjs"])
                                                .current_dir(&server_dir)
                                                .env("CM_TOKEN", token)
                                                .env("CM_PORT", http_port.to_string())
                                                .env("CM_TLS_PORT", tls_port.to_string())
                                                .env(
                                                    "CM_UPSTREAM",
                                                    format!("http://127.0.0.1:{PORT}"),
                                                );
                                            if let Some(c) = &cert {
                                                cspawn = cspawn.env("CM_CERT", c);
                                            }
                                            if let Some(k) = &key {
                                                cspawn = cspawn.env("CM_KEY", k);
                                            }
                                            match cspawn.spawn() {
                                                Ok((crx, cchild)) => {
                                                    #[cfg(target_os = "windows")]
                                                    bind_job_object(cchild.pid());

                                                    pump_events(
                                                        crx,
                                                        logs_dir.join("companion.log"),
                                                    );

                                                    let state = handle.state::<Sidecars>();
                                                    if let Ok(mut guard) = state.0.lock() {
                                                        guard.push(cchild);
                                                    }
                                                    eprintln!(
                                                        "phone companion listening on :{http_port}"
                                                    );
                                                }
                                                Err(e) => {
                                                    eprintln!("companion spawn failed: {e}")
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            eprintln!("companion sidecar resolve failed: {e}")
                                        }
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
        .build(tauri::generate_context!())
        .expect("error while building CorpusMind Voice")
        .run(|app, event| {
            // Last chance cleanup: the shell is exiting, so stop the sidecars
            // explicitly (covers macOS and Linux where there is no Job Object).
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = app.state::<Sidecars>().0.lock() {
                    for child in guard.drain(..) {
                        if let Err(e) = child.kill() {
                            eprintln!("sidecar kill on exit failed: {e}");
                        }
                    }
                }
            }
        });
}
