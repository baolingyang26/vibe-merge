pub mod config;
mod deployment;
mod git;
mod github;
mod sessions;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeSessions {
    worktree_path: String,
    evidence: Option<sessions::SessionEvidence>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectStatus {
    config: config::ProjectConfig,
    git: Option<git::ProjectSnapshot>,
    error: Option<String>,
    sessions: Vec<WorktreeSessions>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusSnapshot {
    projects: Vec<ProjectStatus>,
    observed_at: u64,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn session_log_path() -> PathBuf {
    if let Ok(path) = std::env::var("GLOBAL_WORK_STATUS_EVENTS") {
        return PathBuf::from(path);
    }
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join(".codex/globalWorkStatus/events.jsonl")
}

fn selected_worktree<'a>(
    projects: &'a [config::ProjectConfig],
    path: &str,
) -> Result<(PathBuf, &'a config::ProjectConfig), String> {
    let selected = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    let git_output = |args: &[&str]| -> Result<String, String> {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&selected)
            .args(args)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err("Selected path is not a Git worktree".into());
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    };
    let root = git_output(&["rev-parse", "--show-toplevel"])?;
    if std::fs::canonicalize(root).map_err(|error| error.to_string())? != selected {
        return Err("Select a worktree root, not a nested folder".into());
    }
    let common_dir = git_output(&["rev-parse", "--path-format=absolute", "--git-common-dir"])?;
    let project = projects
        .iter()
        .find(|project| project.id == common_dir)
        .ok_or("Worktree is not in a selected project; add it first")?;
    Ok((selected, project))
}

fn build_status(projects: Vec<config::ProjectConfig>, log_path: &Path, now: u64) -> StatusSnapshot {
    let session_events = sessions::load_sessions(log_path, now);
    let projects = projects
        .into_iter()
        .map(|config| match git::scan_project(&config) {
            Ok(git) => {
                let sessions = git
                    .worktrees
                    .iter()
                    .map(|worktree| {
                        let evidence = session_events
                            .as_ref()
                            .map_err(|error| error.to_string())
                            .and_then(|events| {
                                sessions::evidence_for_worktree(
                                    events,
                                    Path::new(&worktree.path),
                                    now,
                                    300,
                                )
                                .map_err(|error| error.to_string())
                            });
                        match evidence {
                            Ok(evidence) => WorktreeSessions {
                                worktree_path: worktree.path.clone(),
                                evidence: Some(evidence),
                                error: None,
                            },
                            Err(error) => WorktreeSessions {
                                worktree_path: worktree.path.clone(),
                                evidence: None,
                                error: Some(error),
                            },
                        }
                    })
                    .collect();
                ProjectStatus {
                    config,
                    git: Some(git),
                    error: None,
                    sessions,
                }
            }
            Err(error) => ProjectStatus {
                config,
                git: None,
                error: Some(error),
                sessions: Vec::new(),
            },
        })
        .collect();
    StatusSnapshot {
        projects,
        observed_at: now,
    }
}

fn risk_count(snapshot: &StatusSnapshot) -> usize {
    snapshot
        .projects
        .iter()
        .map(|project| {
            let Some(git) = &project.git else { return 1 };
            git.worktrees
                .iter()
                .filter(|worktree| {
                    let dirty = &worktree.dirty;
                    worktree.scan_error.is_some()
                        || dirty.staged + dirty.unstaged + dirty.untracked > 0
                        || project.sessions.iter().any(|session| {
                            session.worktree_path == worktree.path
                                && session
                                    .evidence
                                    .as_ref()
                                    .is_some_and(|evidence| evidence.shared_worktree_warning)
                        })
                })
                .count()
        })
        .sum()
}

fn update_tray(app: &tauri::AppHandle, snapshot: &StatusSnapshot) {
    if let Some(tray) = app.tray_by_id("status") {
        let count = risk_count(snapshot);
        let title = if count == 0 {
            "◉".to_string()
        } else {
            format!("◉ {count}")
        };
        let _ = tray.set_title(Some(title));
    }
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<config::ProjectConfig>, String> {
    config::load_projects(&app.path().app_data_dir().map_err(|e| e.to_string())?)
}
#[tauri::command]
async fn add_project(
    app: tauri::AppHandle,
    path: String,
    base_branch: Option<String>,
) -> Result<config::ProjectConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        config::add_project_config(
            &app.path().app_data_dir().map_err(|e| e.to_string())?,
            &path,
            base_branch.as_deref(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
fn remove_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    config::remove_project_config(&app.path().app_data_dir().map_err(|e| e.to_string())?, &id)
}

#[tauri::command]
async fn scan_status(app: tauri::AppHandle) -> Result<StatusSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects =
            config::load_projects(&app.path().app_data_dir().map_err(|e| e.to_string())?)?;
        let snapshot = build_status(projects, &session_log_path(), now_seconds());
        update_tray(&app, &snapshot);
        Ok(snapshot)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_github_evidence(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
    target_base: String,
) -> Result<github::GithubEvidence, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects = config::load_projects(
            &app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?,
        )?;
        let (selected, project) = selected_worktree(&projects, &path)?;
        if project.base_branch != target_base {
            return Err("Project base changed; refresh status".into());
        }
        let current_branch = std::process::Command::new("git")
            .arg("-C")
            .arg(&selected)
            .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
            .output()
            .map_err(|error| error.to_string())?;
        let current_head = std::process::Command::new("git")
            .arg("-C")
            .arg(&selected)
            .args(["rev-parse", "HEAD"])
            .output()
            .map_err(|error| error.to_string())?;
        if !current_branch.status.success()
            || !current_head.status.success()
            || String::from_utf8_lossy(&current_branch.stdout).trim() != branch
            || String::from_utf8_lossy(&current_head.stdout).trim() != head_sha
        {
            return Err("Worktree branch or HEAD changed; refresh status".into());
        }
        Ok(github::scan_github(
            &selected,
            &branch,
            &head_sha,
            &target_base,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_deployment_evidence(
    app: tauri::AppHandle,
    path: String,
    environment: String,
    service: String,
) -> Result<deployment::DeploymentEvidence, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects = config::load_projects(
            &app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?,
        )?;
        let (selected, _) = selected_worktree(&projects, &path)?;
        Ok(deployment::scan_deployment(
            &selected,
            &environment,
            &service,
        ))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn set_panel_pinned(app: tauri::AppHandle, pinned: bool) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Panel window is unavailable")?;
    window
        .set_always_on_top(pinned)
        .map_err(|error| error.to_string())?;
    Ok(pinned)
}

#[tauri::command]
fn open_chat(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if session_id.is_empty()
        || session_id.len() > 128
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("Invalid Codex chat ID".into());
    }
    app.opener()
        .open_url(format!("codex://threads/{session_id}"), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_worktree(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let projects = config::load_projects(
        &app.path()
            .app_data_dir()
            .map_err(|error| error.to_string())?,
    )?;
    let (selected, _) = selected_worktree(&projects, &path)?;
    app.opener()
        .open_path(
            selected
                .to_str()
                .ok_or("Worktree path is not valid UTF-8")?,
            None::<&str>,
        )
        .map_err(|error| error.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let (Ok(Some(monitor)), Ok(size)) =
                    (window.current_monitor(), window.outer_size())
                {
                    let x =
                        monitor.position().x + monitor.size().width as i32 - size.width as i32 - 20;
                    let y = monitor.position().y + 54;
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                }
            }
            let open_item = MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::with_id("status")
                .title("◉")
                .tooltip("Global Work Status")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            let app_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                if let Ok(dir) = app_handle.path().app_data_dir() {
                    if let Ok(projects) = config::load_projects(&dir) {
                        let snapshot = build_status(projects, &session_log_path(), now_seconds());
                        update_tray(&app_handle, &snapshot);
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(30));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            scan_status,
            load_github_evidence,
            load_deployment_evidence,
            set_panel_pinned,
            open_chat,
            open_worktree
        ])
        .run(tauri::generate_context!())
        .expect("error while running Global Work Status");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_keeps_invalid_selected_project_visible_as_unknown() {
        let config = config::ProjectConfig {
            id: "missing".into(),
            path: "/definitely/missing/globalWorkStatus".into(),
            base_branch: "main".into(),
        };
        let snapshot = build_status(
            vec![config],
            std::path::Path::new("/missing/events.jsonl"),
            100,
        );
        assert_eq!(snapshot.projects.len(), 1);
        assert_eq!(snapshot.projects[0].config.id, "missing");
        assert!(snapshot.projects[0].git.is_none());
        assert!(snapshot.projects[0].error.is_some());
        assert_eq!(risk_count(&snapshot), 1);
    }
    #[test]
    fn selected_worktree_check_rejects_unregistered_repository() {
        let root =
            std::env::temp_dir().join(format!("global status permission {}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let output = std::process::Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(selected_worktree(&[], root.to_str().unwrap()).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
