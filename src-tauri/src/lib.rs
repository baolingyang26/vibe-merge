pub mod config;
mod deployment;
mod git;
mod github;
mod sessions;
mod workflow;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
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

fn dock_geometry(
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    scale: f64,
    expanded: bool,
) -> (tauri::PhysicalSize<u32>, tauri::PhysicalPosition<i32>) {
    let logical_width = if expanded { 460.0 } else { 72.0 };
    let logical_height = if expanded {
        work_height
    } else {
        ((180.0 * scale).round() as u32).min(work_height)
    };
    let width = ((logical_width * scale).round() as u32).min(work_width);
    let top = if expanded {
        work_y
    } else {
        work_y + ((16.0 * scale).round() as i32).min((work_height - logical_height) as i32)
    };
    (
        tauri::PhysicalSize::new(width, logical_height),
        tauri::PhysicalPosition::new(work_x + work_width as i32 - width as i32, top),
    )
}

fn position_dock(window: &tauri::WebviewWindow, expanded: bool) -> Result<(), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or("No monitor available for the dock")?;
    let area = monitor.work_area();
    let (size, position) = dock_geometry(
        area.position.x,
        area.position.y,
        area.size.width,
        area.size.height,
        monitor.scale_factor(),
        expanded,
    );
    window.set_size(size).map_err(|error| error.to_string())?;
    window
        .set_position(position)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())
}

fn open_dock(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = position_dock(&window, true);
        let _ = window.set_focus();
        let _ = app.emit_to("main", "open-dock", ());
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
async fn resolve_github_avatars(
    app: tauri::AppHandle,
    project_id: String,
    samples: Vec<String>,
) -> Result<std::collections::HashMap<String, git::GithubAvatar>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let projects = config::load_projects(
            &app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())?,
        )?;
        let project = projects
            .into_iter()
            .find(|item| item.id == project_id)
            .ok_or("项目已移除，请刷新后重试")?;
        git::resolve_github_avatars(&project, &samples)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prepare_commit(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
) -> Result<workflow::CommitPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::prepare_commit(app, path, branch, head_sha)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn commit_and_push(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
    expected_status_token: String,
    message: String,
) -> Result<workflow::CommitPushResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::commit_and_push(app, path, branch, head_sha, expected_status_token, message)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn push_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || workflow::push_branch(app, path, branch, head_sha))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn prepare_pr(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
) -> Result<workflow::PrPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::prepare_pr(app, project_id, branch, head_sha)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn create_pr(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
    base: String,
    title: String,
    body: String,
    draft: bool,
) -> Result<workflow::PrResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::create_pr(app, project_id, branch, head_sha, base, title, body, draft)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_branch(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::delete_branch(app, project_id, branch, head_sha)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn analyze_branch(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
    target: String,
) -> Result<workflow::BranchAdvice, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::analyze_branch(app, project_id, branch, head_sha, target)
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
async fn set_dock_expanded(
    app: tauri::AppHandle,
    expanded: bool,
    reduced_motion: bool,
) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Dock window is unavailable")?;
    tauri::async_runtime::spawn_blocking(move || {
        if reduced_motion {
            position_dock(&window, expanded)?;
            return Ok(expanded);
        }
        let monitor = window
            .current_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("No monitor available for the dock")?;
        let area = monitor.work_area();
        let (target, target_position) = dock_geometry(
            area.position.x,
            area.position.y,
            area.size.width,
            area.size.height,
            monitor.scale_factor(),
            expanded,
        );
        let start_size = window.inner_size().map_err(|error| error.to_string())?;
        let start_position = window.outer_position().map_err(|error| error.to_string())?;
        let started = std::time::Instant::now();
        loop {
            let progress = (started.elapsed().as_secs_f64() / 0.34).min(1.0);
            let eased = progress * progress * (3.0 - 2.0 * progress);
            let width = (start_size.width as f64
                + (target.width as f64 - start_size.width as f64) * eased)
                .round() as u32;
            let height = (start_size.height as f64
                + (target.height as f64 - start_size.height as f64) * eased)
                .round() as u32;
            let top = (start_position.y as f64
                + (target_position.y as f64 - start_position.y as f64) * eased)
                .round() as i32;
            window
                .set_size(tauri::PhysicalSize::new(width, height))
                .map_err(|error| error.to_string())?;
            window
                .set_position(tauri::PhysicalPosition::new(
                    area.position.x + area.size.width as i32 - width as i32,
                    top,
                ))
                .map_err(|error| error.to_string())?;
            if progress >= 1.0 {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
        Ok(expanded)
    })
    .await
    .map_err(|error| error.to_string())?
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
                position_dock(&window, false)?;
            }
            let open_item = MenuItem::with_id(app, "open", "打开面板", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::with_id("status")
                .title("◉")
                .tooltip("Vibe Merge")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_dock(app),
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
                        open_dock(tray.app_handle());
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
                let _ = window.set_focus();
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            add_project,
            remove_project,
            scan_status,
            load_github_evidence,
            resolve_github_avatars,
            prepare_commit,
            commit_and_push,
            push_branch,
            prepare_pr,
            create_pr,
            delete_branch,
            analyze_branch,
            load_deployment_evidence,
            set_dock_expanded,
            open_chat,
            open_worktree
        ])
        .build(tauri::generate_context!())
        .expect("error while building Vibe Merge")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                open_dock(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
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

    #[test]
    fn dock_stays_right_aligned_at_retina_scale() {
        let (collapsed, collapsed_position) = dock_geometry(100, 40, 3000, 1800, 2.0, false);
        let (expanded, expanded_position) = dock_geometry(100, 40, 3000, 1800, 2.0, true);
        assert_eq!(collapsed.width, 144);
        assert_eq!(collapsed.height, 360);
        assert_eq!(expanded.width, 920);
        assert_eq!(collapsed_position.x + collapsed.width as i32, 3100);
        assert_eq!(expanded_position.x + expanded.width as i32, 3100);
        assert_eq!(collapsed_position.y, 72);
        assert_eq!(expanded.height, 1800);
    }
}
