use crate::{config, selected_worktree};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashSet},
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub previous_path: Option<String>,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPreview {
    pub head_sha: String,
    pub branch: String,
    pub status_token: String,
    pub files: Vec<ChangedFile>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPushResult {
    pub commit_sha: String,
    pub pushed: bool,
    pub push_error: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrSummary {
    pub number: u64,
    pub url: String,
    pub base_ref_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrPreview {
    pub repository: String,
    pub head_sha: String,
    pub branch: String,
    pub targets: Vec<String>,
    pub needs_push: bool,
    pub existing: Vec<PrSummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrResult {
    pub url: String,
    pub existing: bool,
    pub pushed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepositoryIdentity {
    name_with_owner: String,
    url: String,
    ssh_url: String,
}

fn run(path: &Path, program: &str, args: &[&str], timeout: Duration) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(path)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("LC_ALL", "C")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .env_remove("GIT_INDEX_FILE")
        .env_remove("GIT_PREFIX")
        .env_remove("GH_REPO")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 {program}：{error}"))?;
    let mut stdout = child.stdout.take().ok_or("无法读取命令输出")?;
    let mut stderr = child.stderr.take().ok_or("无法读取命令错误")?;
    let output = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let errors = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stderr.read_to_end(&mut bytes);
        bytes
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = output.join().map_err(|_| "命令输出读取失败")?;
                let stderr = errors.join().map_err(|_| "命令错误读取失败")?;
                if !status.success() {
                    let reason = String::from_utf8_lossy(&stderr);
                    let reason = reason.trim().chars().take(500).collect::<String>();
                    return Err(if reason.is_empty() {
                        format!("{program} 执行失败")
                    } else {
                        format!("{program} 执行失败：{reason}")
                    });
                }
                return String::from_utf8(stdout).map_err(|_| "文件名或命令输出不是 UTF-8".into());
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(25));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} 超时或无法完成"));
            }
        }
    }
}

fn git(path: &Path, args: &[&str]) -> Result<String, String> {
    run(path, "git", args, Duration::from_secs(15))
}

fn parse_status(raw: &str) -> Result<Vec<ChangedFile>, String> {
    let fields = raw
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index < fields.len() {
        let entry = fields[index];
        let bytes = entry.as_bytes();
        if bytes.len() < 4 || bytes[2] != b' ' {
            return Err("Git 改动列表格式无效".into());
        }
        let status = &entry[..2];
        if status.bytes().any(|value| value == b'U') || matches!(status, "AA" | "DD") {
            return Err("存在未解决的合并冲突，请先在 Git 中处理".into());
        }
        let path = entry[3..].to_string();
        let rename = status.bytes().any(|value| value == b'R' || value == b'C');
        let previous_path = if rename {
            index += 1;
            Some(fields.get(index).ok_or("Git 重命名记录不完整")?.to_string())
        } else {
            None
        };
        files.push(ChangedFile {
            path,
            previous_path,
            status: status.to_string(),
        });
        index += 1;
    }
    Ok(files)
}

fn status_token(root: &Path, raw: &str, files: &[ChangedFile]) -> String {
    let mut hasher = DefaultHasher::new();
    raw.hash(&mut hasher);
    for file in files {
        for path in [Some(file.path.as_str()), file.previous_path.as_deref()]
            .into_iter()
            .flatten()
        {
            path.hash(&mut hasher);
            match std::fs::symlink_metadata(root.join(path)) {
                Ok(metadata) => {
                    metadata.len().hash(&mut hasher);
                    metadata.file_type().is_symlink().hash(&mut hasher);
                    metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_nanos())
                        .hash(&mut hasher);
                    if metadata.file_type().is_symlink() {
                        std::fs::read_link(root.join(path)).ok().hash(&mut hasher);
                    }
                }
                Err(error) => error.kind().hash(&mut hasher),
            }
        }
    }
    format!("{:016x}", hasher.finish())
}

fn current_status(root: &Path) -> Result<(String, Vec<ChangedFile>), String> {
    let raw = git(
        root,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let files = parse_status(&raw)?;
    Ok((raw, files))
}

fn worktree_context(
    app: &tauri::AppHandle,
    path: &str,
    branch: &str,
    expected_head: &str,
) -> Result<PathBuf, String> {
    let projects = config::load_projects(&app.path().app_data_dir().map_err(|e| e.to_string())?)?;
    let (root, project) = selected_worktree(&projects, path)?;
    if branch == project.base_branch {
        return Err("基线分支不能从这里直接提交或推送，请先创建功能分支".into());
    }
    let common_dir = git(
        &root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if common_dir.trim() != project.id {
        return Err("工作目录不再属于所选项目，请刷新后重试".into());
    }
    let actual_branch = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let actual_head = git(&root, &["rev-parse", "--verify", "HEAD"])?;
    if actual_branch.trim() != branch || actual_head.trim() != expected_head {
        return Err("工作目录的分支或 HEAD 已变化，请刷新后重试".into());
    }
    Ok(root)
}

pub fn prepare_commit(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
) -> Result<CommitPreview, String> {
    let root = worktree_context(&app, &path, &branch, &head_sha)?;
    let (raw, files) = current_status(&root)?;
    if files.is_empty() {
        return Err("这个工作目录没有待提交改动".into());
    }
    Ok(CommitPreview {
        head_sha,
        branch,
        status_token: status_token(&root, &raw, &files),
        files,
    })
}

fn push_ref(root: &Path, branch: &str, source: &str) -> Result<(), String> {
    let refspec = format!("{source}:refs/heads/{branch}");
    run(
        root,
        "git",
        &["push", "--porcelain", "--set-upstream", "origin", &refspec],
        Duration::from_secs(90),
    )?;
    Ok(())
}

pub fn commit_and_push(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
    expected_status_token: String,
    selected_paths: Vec<String>,
    message: String,
) -> Result<CommitPushResult, String> {
    let root = worktree_context(&app, &path, &branch, &head_sha)?;
    commit_selected_and_push(
        &root,
        &branch,
        &head_sha,
        &expected_status_token,
        selected_paths,
        &message,
    )
}

fn commit_selected_and_push(
    root: &Path,
    branch: &str,
    expected_head: &str,
    expected_status_token: &str,
    selected_paths: Vec<String>,
    message: &str,
) -> Result<CommitPushResult, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 2000 {
        return Err("请输入 1 到 2000 个字符的提交说明".into());
    }
    if git(root, &["rev-parse", "--verify", "HEAD"])?.trim() != expected_head
        || git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?.trim() != branch
    {
        return Err("提交前分支或 HEAD 已变化，请重新检查".into());
    }
    let (raw, files) = current_status(root)?;
    if status_token(root, &raw, &files) != expected_status_token {
        return Err("改动已变化，请重新检查文件清单".into());
    }
    let selected = selected_paths.into_iter().collect::<HashSet<_>>();
    if selected.is_empty() || selected.len() > files.len() {
        return Err("请至少选择一个文件".into());
    }
    let mut paths = Vec::new();
    let mut new_paths = Vec::new();
    for file in files.iter().filter(|file| selected.contains(&file.path)) {
        paths.push(file.path.as_str());
        if let Some(previous) = &file.previous_path {
            paths.push(previous.as_str());
        }
        if file.status == "??" {
            new_paths.push(file.path.as_str());
        }
    }
    if paths.is_empty()
        || selected.len()
            != files
                .iter()
                .filter(|file| selected.contains(&file.path))
                .count()
    {
        return Err("所选文件不在当前改动清单中，请重新检查".into());
    }
    if !new_paths.is_empty() {
        let mut args = vec!["add", "-N", "--"];
        args.extend(new_paths.iter().copied());
        git(root, &args)?;
    }
    let mut args = vec!["commit", "--only", "-m", message, "--"];
    args.extend(paths.iter().copied());
    if let Err(error) = run(root, "git", &args, Duration::from_secs(120)) {
        if !new_paths.is_empty() {
            let mut reset = vec!["reset", "--"];
            reset.extend(new_paths.iter().copied());
            let _ = git(root, &reset);
        }
        return Err(error);
    }
    let commit_sha = git(root, &["rev-parse", "--verify", "HEAD"])?
        .trim()
        .to_string();
    let current_branch = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    let push_error = if current_branch.trim() == branch {
        push_ref(root, branch, &commit_sha).err()
    } else {
        Some("提交后工作分支已变化，未推送；请核对后重试".into())
    };
    Ok(CommitPushResult {
        commit_sha,
        pushed: push_error.is_none(),
        push_error,
    })
}

pub fn push_branch(
    app: tauri::AppHandle,
    path: String,
    branch: String,
    head_sha: String,
) -> Result<String, String> {
    let root = worktree_context(&app, &path, &branch, &head_sha)?;
    push_ref(&root, &branch, &head_sha)?;
    Ok(head_sha)
}

fn project_context(
    app: &tauri::AppHandle,
    project_id: &str,
    branch: &str,
    expected_head: &str,
) -> Result<(PathBuf, config::ProjectConfig), String> {
    let projects = config::load_projects(&app.path().app_data_dir().map_err(|e| e.to_string())?)?;
    let project = projects
        .into_iter()
        .find(|item| item.id == project_id)
        .ok_or("项目已移除，请刷新后重试")?;
    if branch == project.base_branch {
        return Err("不能为基线分支创建指向自身的 PR".into());
    }
    let root = std::fs::canonicalize(&project.path).map_err(|e| e.to_string())?;
    let common_dir = git(
        &root,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if common_dir.trim() != project.id {
        return Err("项目仓库已变化，请重新添加项目".into());
    }
    let branch_ref = format!("refs/heads/{branch}^{{commit}}");
    let head = git(&root, &["rev-parse", "--verify", &branch_ref])?;
    if head.trim() != expected_head {
        return Err("分支已有新提交，请刷新后重试".into());
    }
    Ok((root, project))
}

fn remote_heads(root: &Path) -> Result<Vec<(String, String)>, String> {
    let output = run(
        root,
        "git",
        &["ls-remote", "--heads", "origin"],
        Duration::from_secs(30),
    )?;
    output
        .lines()
        .map(|line| {
            let (sha, reference) = line.split_once('\t').ok_or("远端分支列表格式无效")?;
            let name = reference
                .strip_prefix("refs/heads/")
                .ok_or("远端分支列表格式无效")?;
            Ok((name.to_string(), sha.to_string()))
        })
        .collect()
}

fn normalized_remote(value: &str) -> &str {
    value.trim().trim_end_matches('/').trim_end_matches(".git")
}

fn repository_for_origin(root: &Path) -> Result<(String, String), String> {
    let origin = git(root, &["remote", "get-url", "origin"])?;
    let raw = run(
        root,
        "gh",
        &["repo", "view", "--json", "nameWithOwner,url,sshUrl"],
        Duration::from_secs(30),
    )?;
    let identity: RepositoryIdentity =
        serde_json::from_str(&raw).map_err(|_| "GitHub 仓库信息格式无效")?;
    if normalized_remote(&origin) != normalized_remote(&identity.url)
        && normalized_remote(&origin) != normalized_remote(&identity.ssh_url)
    {
        return Err("gh 当前仓库与 origin 不一致，已停止 PR 操作".into());
    }
    let owner = identity
        .name_with_owner
        .split_once('/')
        .map(|(owner, _)| owner)
        .filter(|owner| !owner.is_empty())
        .ok_or("无法确认 origin 对应的 GitHub 仓库")?;
    let host = identity
        .url
        .strip_prefix("https://")
        .and_then(|value| value.split_once('/'))
        .map(|(host, _)| host)
        .ok_or("GitHub 仓库地址格式无效")?;
    let repository = if host == "github.com" {
        identity.name_with_owner.clone()
    } else {
        format!("{host}/{}", identity.name_with_owner)
    };
    Ok((repository, owner.to_string()))
}

fn existing_prs(
    root: &Path,
    branch: &str,
    repository: &str,
    owner: &str,
) -> Result<Vec<PrSummary>, String> {
    let raw = run(
        root,
        "gh",
        &[
            "pr",
            "list",
            "--state",
            "open",
            "--head",
            branch,
            "--repo",
            repository,
            "--limit",
            "100",
            "--json",
            "number,url,baseRefName,headRepositoryOwner",
        ],
        Duration::from_secs(30),
    )?;
    parse_existing_prs(&raw, owner)
}

fn parse_existing_prs(raw: &str, owner: &str) -> Result<Vec<PrSummary>, String> {
    let entries: Vec<serde_json::Value> =
        serde_json::from_str(&raw).map_err(|_| "GitHub PR 列表格式无效")?;
    entries
        .into_iter()
        .filter(|entry| {
            entry
                .get("headRepositoryOwner")
                .and_then(|value| value.get("login"))
                .and_then(|value| value.as_str())
                .is_some_and(|login| login.eq_ignore_ascii_case(owner))
        })
        .map(|entry| serde_json::from_value(entry).map_err(|_| "GitHub PR 记录格式无效".into()))
        .collect()
}

fn ensure_branch_clean(root: &Path, branch: &str) -> Result<(), String> {
    let records = git(root, &["worktree", "list", "--porcelain", "-z"])?;
    let mut path = None;
    for field in records.split('\0') {
        if let Some(value) = field.strip_prefix("worktree ") {
            path = Some(value.to_string());
        } else if field == format!("branch refs/heads/{branch}") {
            if let Some(path) = &path {
                if !current_status(Path::new(path))?.1.is_empty() {
                    return Err("分支还有未提交改动，请先完成提交".into());
                }
            }
        }
    }
    Ok(())
}

pub fn prepare_pr(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
) -> Result<PrPreview, String> {
    let (root, project) = project_context(&app, &project_id, &branch, &head_sha)?;
    ensure_branch_clean(&root, &branch)?;
    let remote = remote_heads(&root)?;
    let mut targets = remote
        .iter()
        .filter(|(name, _)| name != &branch)
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    targets.sort();
    if let Some(index) = targets.iter().position(|name| name == &project.base_branch) {
        let base = targets.remove(index);
        targets.insert(0, base);
    }
    if targets.is_empty() {
        return Err("远端没有可选的目标分支".into());
    }
    let (repository, owner) = repository_for_origin(&root)?;
    let needs_push = remote
        .iter()
        .find(|(name, _)| name == &branch)
        .is_none_or(|(_, sha)| sha != &head_sha);
    Ok(PrPreview {
        repository: repository.clone(),
        head_sha,
        branch: branch.clone(),
        targets,
        needs_push,
        existing: existing_prs(&root, &branch, &repository, &owner)?,
    })
}

pub fn create_pr(
    app: tauri::AppHandle,
    project_id: String,
    branch: String,
    head_sha: String,
    base: String,
    title: String,
    body: String,
    draft: bool,
) -> Result<PrResult, String> {
    let title = title.trim();
    if title.is_empty() || title.len() > 256 || body.len() > 20_000 {
        return Err("PR 标题或描述长度无效".into());
    }
    let (root, _) = project_context(&app, &project_id, &branch, &head_sha)?;
    ensure_branch_clean(&root, &branch)?;
    let remote = remote_heads(&root)?;
    if base == branch || !remote.iter().any(|(name, _)| name == &base) {
        return Err("请选择有效的远端目标分支".into());
    }
    let (repository, owner) = repository_for_origin(&root)?;
    let existing = existing_prs(&root, &branch, &repository, &owner)?
        .into_iter()
        .find(|pr| pr.base_ref_name == base);
    let needs_push = remote
        .iter()
        .find(|(name, _)| name == &branch)
        .is_none_or(|(_, sha)| sha != &head_sha);
    if needs_push {
        let branch_ref = format!("refs/heads/{branch}^{{commit}}");
        if git(&root, &["rev-parse", "--verify", &branch_ref])?.trim() != head_sha {
            return Err("推送前分支已有新提交，请刷新后重试".into());
        }
        push_ref(&root, &branch, &head_sha)?;
    }
    if let Some(pr) = existing {
        return Ok(PrResult {
            url: pr.url,
            existing: true,
            pushed: needs_push,
        });
    }
    let mut args = vec![
        "pr",
        "create",
        "--repo",
        &repository,
        "--base",
        &base,
        "--head",
        &branch,
        "--title",
        title,
        "--body",
        &body,
    ];
    if draft {
        args.push("--draft");
    }
    let output = run(&root, "gh", &args, Duration::from_secs(90))?;
    let url = output
        .lines()
        .find(|line| line.trim().starts_with("https://"))
        .ok_or("PR 已提交，但未收到链接；请在 GitHub 核对，避免重复创建")?
        .trim()
        .to_string();
    Ok(PrResult {
        url,
        existing: false,
        pushed: needs_push,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_renames_and_untracked_files() {
        let files = parse_status("R  new.txt\0old.txt\0?? fresh.txt\0").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "new.txt");
        assert_eq!(files[0].previous_path.as_deref(), Some("old.txt"));
        assert_eq!(files[1].status, "??");
        assert!(parse_status("UU conflicted.txt\0").is_err());
    }

    #[test]
    fn existing_prs_excludes_fork_with_same_branch_name() {
        let raw = r#"[{"number":1,"url":"https://example.test/1","baseRefName":"main","headRepositoryOwner":{"login":"ours"}},{"number":2,"url":"https://example.test/2","baseRefName":"main","headRepositoryOwner":{"login":"other"}}]"#;
        let prs = parse_existing_prs(raw, "ours").unwrap();
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].number, 1);
    }

    #[test]
    fn token_changes_when_file_changes() {
        let root =
            std::env::temp_dir().join(format!("global-status-workflow-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("file.txt");
        std::fs::write(&path, "old").unwrap();
        let files = vec![ChangedFile {
            path: "file.txt".into(),
            previous_path: None,
            status: " M".into(),
        }];
        let first = status_token(&root, " M file.txt\0", &files);
        std::fs::write(&path, "new content").unwrap();
        assert_ne!(first, status_token(&root, " M file.txt\0", &files));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selected_commit_push_preserves_unselected_staged_file() {
        let root = std::env::temp_dir().join(format!(
            "global-status-commit-flow-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let worktree = root.join("worktree");
        let remote = root.join("remote.git");
        std::fs::create_dir_all(&worktree).unwrap();
        let command = |cwd: &Path, args: &[&str]| {
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
            String::from_utf8(output.stdout).unwrap()
        };
        command(&root, &["init", "--bare", "-q", remote.to_str().unwrap()]);
        command(&worktree, &["init", "-q", "-b", "feature"]);
        command(&worktree, &["config", "user.name", "Test"]);
        command(&worktree, &["config", "user.email", "test@example.invalid"]);
        std::fs::write(worktree.join("selected.txt"), "old").unwrap();
        std::fs::write(worktree.join("other.txt"), "old").unwrap();
        command(&worktree, &["add", "-A"]);
        command(&worktree, &["commit", "-qm", "initial"]);
        command(
            &worktree,
            &["remote", "add", "origin", remote.to_str().unwrap()],
        );
        command(&worktree, &["push", "-q", "-u", "origin", "feature"]);
        std::fs::write(worktree.join("selected.txt"), "new").unwrap();
        std::fs::write(worktree.join("other.txt"), "staged but not selected").unwrap();
        std::fs::write(worktree.join("fresh.txt"), "new file").unwrap();
        command(&worktree, &["add", "other.txt"]);
        let (raw, files) = current_status(&worktree).unwrap();
        let token = status_token(&worktree, &raw, &files);
        let result = commit_selected_and_push(
            &worktree,
            "feature",
            command(&worktree, &["rev-parse", "HEAD"]).trim(),
            &token,
            vec!["selected.txt".into(), "fresh.txt".into()],
            "selected changes",
        )
        .unwrap();
        assert!(result.pushed);
        assert_eq!(
            command(&worktree, &["status", "--short"]).trim(),
            "M  other.txt"
        );
        assert_eq!(
            command(&worktree, &["ls-remote", "origin", "refs/heads/feature"])
                .split_whitespace()
                .next(),
            Some(result.commit_sha.as_str())
        );
        let other_checkout = root.join("other-checkout");
        command(
            &root,
            &[
                "clone",
                "-q",
                remote.to_str().unwrap(),
                other_checkout.to_str().unwrap(),
            ],
        );
        command(&other_checkout, &["checkout", "-q", "feature"]);
        command(&other_checkout, &["config", "user.name", "Test"]);
        command(
            &other_checkout,
            &["config", "user.email", "test@example.invalid"],
        );
        std::fs::write(other_checkout.join("remote.txt"), "new remote commit").unwrap();
        command(&other_checkout, &["add", "remote.txt"]);
        command(&other_checkout, &["commit", "-qm", "advance remote"]);
        command(&other_checkout, &["push", "-q", "origin", "feature"]);
        assert!(push_ref(&worktree, "feature", &result.commit_sha).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
