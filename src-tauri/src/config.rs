use serde::{Deserialize, Serialize};
use std::{fs, path::Path, process::Command};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub id: String,
    pub path: String,
    pub base_branch: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("global-status-config-{}", std::process::id()));
        let projects = vec![ProjectConfig {
            id: "one".into(),
            path: "/tmp/project".into(),
            base_branch: "main".into(),
        }];
        save_projects(&dir, &projects).unwrap();
        assert_eq!(load_projects(&dir).unwrap(), projects);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn linked_checkout_is_same_selected_project() {
        let root =
            std::env::temp_dir().join(format!("global status project {}", std::process::id()));
        let linked = root.with_file_name(format!("global status linked {}", std::process::id()));
        let settings =
            root.with_file_name(format!("global status settings {}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let git = |cwd: &Path, args: &[&str]| {
            let output = Command::new("git")
                .args(args)
                .current_dir(cwd)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&root, &["init", "-b", "main"]);
        git(&root, &["config", "user.email", "fixture@example.test"]);
        git(&root, &["config", "user.name", "Fixture"]);
        fs::write(root.join("file.txt"), "initial").unwrap();
        git(&root, &["add", "file.txt"]);
        git(&root, &["commit", "-m", "initial"]);
        git(
            &root,
            &["worktree", "add", "-b", "feature", linked.to_str().unwrap()],
        );

        let first = add_project_config(&settings, root.to_str().unwrap(), None).unwrap();
        let second = add_project_config(&settings, linked.to_str().unwrap(), None).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(load_projects(&settings).unwrap().len(), 1);

        git(
            &root,
            &["worktree", "remove", "--force", linked.to_str().unwrap()],
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(settings).unwrap();
    }
}

pub fn load_projects(dir: &Path) -> Result<Vec<ProjectConfig>, String> {
    match fs::read(dir.join("projects.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_projects(dir: &Path, projects: &[ProjectConfig]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(projects).map_err(|e| e.to_string())?;
    let temporary = dir.join("projects.tmp");
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, dir.join("projects.json")).map_err(|e| e.to_string())
}

pub fn add_project_config(
    dir: &Path,
    path: &str,
    base: Option<&str>,
) -> Result<ProjectConfig, String> {
    let canonical = fs::canonicalize(path).map_err(|e| format!("Cannot open project: {e}"))?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&canonical)
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Select a folder inside a Git worktree".into());
    }
    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let output = Command::new("git")
        .arg("-C")
        .arg(&canonical)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Cannot identify Git repository".into());
    }
    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let mut projects = load_projects(dir)?;
    if let Some(project) = projects.iter().find(|p| p.id == id) {
        return Ok(project.clone());
    }
    let remote = Command::new("git")
        .arg("-C")
        .arg(&canonical)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok();
    let is_tellyn = remote.as_ref().is_some_and(|output| {
        output.status.success()
            && matches!(
                String::from_utf8_lossy(&output.stdout).trim(),
                "git@github.com:tellyn-ai/tellyn.git"
                    | "https://github.com/tellyn-ai/tellyn.git"
                    | "https://github.com/tellyn-ai/tellyn"
            )
    });
    let project = ProjectConfig {
        id,
        path: root,
        base_branch: base
            .unwrap_or(if is_tellyn { "PA-home-page" } else { "main" })
            .to_string(),
    };
    projects.push(project.clone());
    save_projects(dir, &projects)?;
    Ok(project)
}

pub fn remove_project_config(dir: &Path, id: &str) -> Result<(), String> {
    let mut projects = load_projects(dir)?;
    projects.retain(|project| project.id != id);
    save_projects(dir, &projects)
}
