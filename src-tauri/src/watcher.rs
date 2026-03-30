use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

use crate::installer::install::shared_skills_dir;
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};

pub fn start_skill_watcher(app: AppHandle) {
    let agents_dir = paths::agents_dir();
    let Ok(configs) = load_agent_configs(&agents_dir) else {
        return;
    };
    let detected = detect_agents(&configs);
    let mut watch_paths: Vec<PathBuf> = detected
        .into_iter()
        .flat_map(|a| a.global_paths.into_iter())
        .map(PathBuf::from)
        .filter(|p| p.exists())
        .collect();

    // Also watch the canonical shared skills directory
    let shared = shared_skills_dir();
    if shared.exists() || std::fs::create_dir_all(&shared).is_ok() {
        watch_paths.push(shared);
    }

    if watch_paths.is_empty() {
        return;
    }

    // Deduplicate watch paths (agent paths might overlap with shared dir)
    watch_paths.sort();
    watch_paths.dedup();

    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // Only emit for relevant changes (create, modify, remove of files/dirs)
                // Skip metadata-only changes
                use notify::EventKind;
                match event.kind {
                    EventKind::Create(_) | EventKind::Remove(_) => {
                        let _ = tx.send(());
                    }
                    EventKind::Modify(modify) => {
                        use notify::event::ModifyKind;
                        match modify {
                            ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any => {
                                let _ = tx.send(());
                            }
                            _ => {} // skip metadata-only
                        }
                    }
                    _ => {}
                }
            }
        }) {
            Ok(w) => w,
            Err(_) => return,
        };

        for path in &watch_paths {
            let _ = watcher.watch(path, RecursiveMode::Recursive);
        }

        // Debounce: batch rapid filesystem events into one emission per 500ms window
        let debounce = Duration::from_millis(500);
        let mut last_emit = Instant::now() - debounce;
        loop {
            match rx.recv_timeout(debounce) {
                Ok(()) => {
                    if last_emit.elapsed() >= debounce {
                        let _ = app.emit("skills-changed", "changed");
                        last_emit = Instant::now();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // No events in this window — nothing to do
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}
