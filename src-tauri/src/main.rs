// CorpusMind Voice — desktop shell (Tauri 2).
// Boots the bundled Next.js standalone server as a Node sidecar, waits until
// it accepts connections, then points the webview at it. Fully offline.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 34567;

// Keeps a handle to the Node sidecar so the shell can terminate it on exit.
// Without this, closing the window leaves node.exe running in the background.
// It then locks node.exe and the Prisma query engine DLL inside the install
// directory, which breaks every later upgrade or uninstall with NSIS
// "Error opening file for writing" dialogs.
struct Sidecar(Mutex<Option<CommandChild>>);

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
        .manage(Sidecar(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Desktop data locations (writable regardless of install dir)
            let data_dir = handle.path().app_data_dir().expect("no app data dir");
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
                            Ok((_rx, child)) => {
                                #[cfg(target_os = "windows")]
                                bind_job_object(child.pid());

                                // Track the child so normal window close also
                                // terminates the server (cross-platform path).
                                let state = handle.state::<Sidecar>();
                                if let Ok(mut guard) = state.0.lock() {
                                    *guard = Some(child);
                                }

                                if wait_for_port(PORT, std::time::Duration::from_secs(30)) {
                                    if let Some(w) = handle.get_webview_window("main") {
                                        let _ = w.eval(format!(
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
        .build(tauri::generate_context!())
        .expect("error while building CorpusMind Voice")
        .run(|app, event| {
            // Last chance cleanup: the shell is exiting, so stop the sidecar
            // explicitly (covers macOS and Linux where there is no Job Object).
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut guard) = app.state::<Sidecar>().0.lock() {
                    if let Some(child) = guard.take() {
                        if let Err(e) = child.kill() {
                            eprintln!("sidecar kill on exit failed: {e}");
                        }
                    }
                }
            }
        });
}
