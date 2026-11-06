use crate::config::ProjectConfig;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirtyCounts {
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub last_changed_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitEvidence {
    pub sha: String,
    pub subject: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchComparison {
    pub ahead: usize,
    pub behind: usize,
    pub unique_commits: Vec<CommitEvidence>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeSnapshot {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub dirty: DirtyCounts,
    pub comparison: Option<BranchComparison>,
    pub comparison_error: Option<String>,
    pub scan_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchSnapshot {
    pub name: String,
    pub head: String,
    pub latest_commit_at: Option<u64>,
    pub latest_commit_subject: String,
    pub merged_into_base: Option<bool>,
    pub is_base: bool,
    pub worktree_path: Option<String>,
    pub people: BranchPeople,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonEvidence {
    pub name: String,
    pub email: String,
    pub commits: usize,
    pub sample_sha: Option<String>,
    pub github_login: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchPeople {
    pub creator: Option<PersonEvidence>,
    pub contributors: Vec<PersonEvidence>,
    pub scope: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub id: String,
    pub path: String,
    pub base_branch: String,
    pub current_git_email: Option<String>,
    pub common_dir: String,
    pub branch_count: usize,
    pub branches: Vec<BranchSnapshot>,
    pub worktrees: Vec<WorktreeSnapshot>,
    pub observed_at: u64,
}

fn git(cwd: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| format!("git failed to start: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output.stdout)
}

fn git_text(cwd: &Path, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&git(cwd, args)?).trim().to_string())
}

fn github_repo_from_origin(origin: &str) -> Option<(String, String)> {
    let path = origin
        .trim()
        .strip_prefix("git@github.com:")
        .or_else(|| origin.trim().strip_prefix("https://github.com/"))?;
    let path = path
        .trim_end_matches('/')
        .strip_suffix(".git")
        .unwrap_or(path.trim_end_matches('/'));
    let (owner, repo) = path.split_once('/')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    };
    if !valid(owner) || !valid(repo) {
        return None;
    }
    Some((owner.into(), repo.into()))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubAvatar {
    pub login: String,
    pub avatar_url: String,
}

pub fn resolve_github_avatars(
    config: &ProjectConfig,
    samples: &[String],
) -> Result<HashMap<String, GithubAvatar>, String> {
    let cwd = Path::new(&config.path);
    if git_text(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )? != config.id
    {
        return Err("项目仓库已变化，请刷新后重试".into());
    }
    let origin = match git_text(cwd, &["remote", "get-url", "origin"]) {
        Ok(value) => value,
        Err(_) => return Ok(HashMap::new()),
    };
    let Some((owner, repo)) = github_repo_from_origin(&origin) else {
        return Ok(HashMap::new());
    };
    let samples = samples
        .iter()
        .filter(|sha| sha.len() == 40 && sha.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .take(500)
        .collect::<Vec<_>>();
    let mut avatars = HashMap::new();
    for chunk in samples.chunks(40) {
        let fields = chunk.iter().enumerate().map(|(index, sha)| format!("c{index}:object(oid:\"{sha}\"){{... on Commit{{author{{user{{login avatarUrl}}}}}}}}"))
            .collect::<Vec<_>>().join(" ");
        let query = format!("query($owner:String!,$repo:String!){{repository(owner:$owner,name:$repo){{{fields}}}}}");
        let output = Command::new("gh")
            .args([
                "api",
                "graphql",
                "-f",
                &format!("query={query}"),
                "-F",
                &format!("owner={owner}"),
                "-F",
                &format!("repo={repo}"),
            ])
            .current_dir(cwd)
            .env("GH_PROMPT_DISABLED", "1")
            .output();
        let Ok(output) = output else { break };
        if !output.status.success() {
            break;
        }
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
            break;
        };
        let Some(repository) = value.get("data").and_then(|data| data.get("repository")) else {
            break;
        };
        for (index, sha) in chunk.iter().enumerate() {
            let Some(user) = repository
                .get(format!("c{index}"))
                .and_then(|object| object.get("author"))
                .and_then(|author| author.get("user"))
            else {
                continue;
            };
            let (Some(login), Some(url)) = (
                user.get("login").and_then(|item| item.as_str()),
                user.get("avatarUrl").and_then(|item| item.as_str()),
            ) else {
                continue;
            };
            if url.starts_with("https://avatars.githubusercontent.com/") {
                avatars.insert(
                    (*sha).clone(),
                    GithubAvatar {
                        login: login.into(),
                        avatar_url: url.into(),
                    },
                );
            }
        }
    }
    Ok(avatars)
}

fn github_login_from_email(email: &str) -> Option<String> {
    let local = email.to_ascii_lowercase();
    let local = local.strip_suffix("@users.noreply.github.com")?;
    let login = local.rsplit_once('+').map_or(local, |(_, login)| login);
    if login.is_empty()
        || login.len() > 39
        || !login
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    Some(login.to_string())
}

fn person(name: &str, email: &str, sample_sha: Option<String>) -> PersonEvidence {
    let github_login = github_login_from_email(email);
    let avatar_url = github_login
        .as_ref()
        .map(|login| format!("https://github.com/{login}.png?size=64"));
    PersonEvidence {
        name: name.into(),
        email: email.into(),
        commits: 0,
        sample_sha,
        github_login,
        avatar_url,
    }
}

fn is_local_branch_creation(message: &str) -> bool {
    let Some(source) = message.strip_prefix("branch: Created from ") else {
        return false;
    };
    !source.starts_with("origin/")
        && !source.starts_with("refs/remotes/")
        && !source.starts_with("remotes/origin/")
}

fn branch_people(cwd: &Path, branch: &str, base: &str) -> BranchPeople {
    let branch_ref = format!("refs/heads/{branch}");
    let creation = git_text(
        cwd,
        &[
            "reflog",
            "show",
            "--format=%H%x00%gs%x00%gN%x00%gE",
            &branch_ref,
        ],
    )
    .ok()
    .and_then(|raw| {
        raw.lines().find_map(|line| {
            let mut fields = line.splitn(4, '\0');
            let start = fields.next()?;
            let message = fields.next()?;
            let name = fields.next()?;
            let email = fields.next()?;
            message.strip_prefix("branch: Created from ").map(|_| {
                (
                    start.to_string(),
                    is_local_branch_creation(message).then(|| person(name, email, None)),
                )
            })
        })
    });
    let (range, initial_scope) = if branch == base {
        (branch_ref.clone(), "recent")
    } else if let Some((start, _)) = &creation {
        (format!("{start}..{branch_ref}"), "sinceCreation")
    } else {
        (format!("refs/heads/{base}..{branch_ref}"), "unique")
    };
    let initial = git_text(cwd, &["log", "-201", "--format=%H%x00%aN%x00%aE", &range]);
    let recent_fallback =
        initial.as_ref().map_or(true, |raw| raw.is_empty()) && branch != base && creation.is_none();
    let output = if recent_fallback {
        git_text(
            cwd,
            &["log", "-31", "--format=%H%x00%aN%x00%aE", &branch_ref],
        )
    } else {
        initial
    };
    let mut contributors = Vec::<PersonEvidence>::new();
    let mut count = 0;
    if let Ok(raw) = output {
        for line in raw.lines() {
            let mut fields = line.splitn(3, '\0');
            let (Some(sha), Some(name), Some(email)) =
                (fields.next(), fields.next(), fields.next())
            else {
                continue;
            };
            count += 1;
            if count > 200 {
                break;
            }
            if let Some(existing) = contributors
                .iter_mut()
                .find(|item| item.email.eq_ignore_ascii_case(email))
            {
                existing.commits += 1;
            } else {
                let mut author = person(name, email, Some(sha.to_string()));
                author.commits = 1;
                contributors.push(author);
            }
        }
    }
    BranchPeople {
        creator: creation.and_then(|(_, creator)| creator),
        contributors,
        scope: if count > 200 || recent_fallback {
            "recent".into()
        } else {
            initial_scope.into()
        },
    }
}

fn dirty_counts(cwd: &Path) -> Result<DirtyCounts, String> {
    let output = git(
        cwd,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    let entries: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect();
    let mut counts = DirtyCounts::default();
    let mut index = 0;
    while index < entries.len() {
        let entry = entries[index];
        if entry.len() < 3 {
            return Err("invalid git status entry".to_string());
        }
        let changed_path = cwd.join(String::from_utf8_lossy(&entry[3..]).as_ref());
        if let Ok(modified) =
            std::fs::metadata(changed_path).and_then(|metadata| metadata.modified())
        {
            if let Ok(time) = modified.duration_since(UNIX_EPOCH) {
                let seconds = time.as_secs();
                counts.last_changed_at = Some(
                    counts
                        .last_changed_at
                        .map_or(seconds, |previous| previous.max(seconds)),
                );
            }
        }
        match &entry[..2] {
            b"??" => counts.untracked += 1,
            status => {
                if status[0] != b' ' && status[0] != b'?' {
                    counts.staged += 1;
                }
                if status[1] != b' ' && status[1] != b'?' {
                    counts.unstaged += 1;
                }
                if status[0] == b'R' || status[0] == b'C' || status[1] == b'R' || status[1] == b'C'
                {
                    index += 1;
                }
            }
        }
        index += 1;
    }
    Ok(counts)
}

fn compare_branch(cwd: &Path, base: &str) -> Result<BranchComparison, String> {
    git_text(
        cwd,
        &[
            "rev-parse",
            "--verify",
            &format!("refs/heads/{base}^{{commit}}"),
        ],
    )
    .map_err(|_| format!("base branch {base} is unavailable"))?;
    let counts = git_text(
        cwd,
        &[
            "rev-list",
            "--left-right",
            "--count",
            &format!("{base}...HEAD"),
        ],
    )?;
    let mut values = counts.split_whitespace();
    let behind = values
        .next()
        .ok_or("invalid ahead/behind output")?
        .parse::<usize>()
        .map_err(|error| error.to_string())?;
    let ahead = values
        .next()
        .ok_or("invalid ahead/behind output")?
        .parse::<usize>()
        .map_err(|error| error.to_string())?;
    let log = git_text(
        cwd,
        &["log", "-20", "--format=%H%x09%s", &format!("{base}..HEAD")],
    )?;
    let unique_commits = log
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(sha, subject)| CommitEvidence {
            sha: sha.to_string(),
            subject: subject.to_string(),
        })
        .collect();
    Ok(BranchComparison {
        ahead,
        behind,
        unique_commits,
    })
}

pub fn scan_project(config: &ProjectConfig) -> Result<ProjectSnapshot, String> {
    let cwd = Path::new(&config.path);
    let common_dir = git_text(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let branches = git_text(cwd, &["branch", "--format=%(refname:short)"])?;
    let output = git(cwd, &["worktree", "list", "--porcelain", "-z"])?;
    let mut worktrees = Vec::new();
    for record in output
        .split(|byte| *byte == 0)
        .collect::<Vec<_>>()
        .split(|entry| entry.is_empty())
    {
        if record.is_empty() {
            continue;
        }
        let mut path = None;
        let mut branch = None;
        let mut head = String::new();
        let mut prunable = false;
        for field in record {
            let field = String::from_utf8_lossy(field);
            if let Some(value) = field.strip_prefix("worktree ") {
                path = Some(value.to_string());
            } else if let Some(value) = field.strip_prefix("branch refs/heads/") {
                branch = Some(value.to_string());
            } else if let Some(value) = field.strip_prefix("HEAD ") {
                head = value.to_string();
            } else if field.starts_with("prunable ") {
                prunable = true;
            }
        }
        let Some(path) = path else { continue };
        let worktree_path = Path::new(&path);
        let (dirty, comparison, comparison_error, scan_error) =
            if prunable || !worktree_path.exists() {
                (
                    DirtyCounts::default(),
                    None,
                    None,
                    Some("worktree is unavailable or prunable".to_string()),
                )
            } else {
                let (dirty, scan_error) = match dirty_counts(worktree_path) {
                    Ok(dirty) => (dirty, None),
                    Err(error) => (DirtyCounts::default(), Some(error)),
                };
                let (comparison, comparison_error) =
                    match compare_branch(worktree_path, &config.base_branch) {
                        Ok(comparison) => (Some(comparison), None),
                        Err(error) => (None, Some(error)),
                    };
                (dirty, comparison, comparison_error, scan_error)
            };
        worktrees.push(WorktreeSnapshot {
            path,
            branch,
            head,
            dirty,
            comparison,
            comparison_error,
            scan_error,
        });
    }
    let base_ref = format!("refs/heads/{}", config.base_branch);
    let merged = git_text(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            &format!("--merged={base_ref}"),
            "refs/heads/",
        ],
    )
    .ok();
    let metadata = git_text(
        cwd,
        &[
            "for-each-ref",
            "--format=%(refname:short)%00%(objectname)%00%(committerdate:unix)%00%(subject)",
            "refs/heads/",
        ],
    )?;
    let branch_snapshots = metadata
        .lines()
        .filter_map(|line| {
            let mut fields = line.splitn(4, '\0');
            let name = fields.next()?.to_string();
            let head = fields.next()?.to_string();
            let latest_commit_at = fields.next()?.parse().ok();
            let latest_commit_subject = fields.next()?.to_string();
            let worktree_path = worktrees
                .iter()
                .find(|tree| tree.branch.as_deref() == Some(name.as_str()))
                .map(|tree| tree.path.clone());
            let people = branch_people(cwd, &name, &config.base_branch);
            Some(BranchSnapshot {
                is_base: name == config.base_branch,
                merged_into_base: merged
                    .as_ref()
                    .map(|names| names.lines().any(|candidate| candidate == name)),
                name,
                head,
                latest_commit_at,
                latest_commit_subject,
                worktree_path,
                people,
            })
        })
        .collect();
    let observed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    Ok(ProjectSnapshot {
        id: config.id.clone(),
        path: config.path.clone(),
        base_branch: config.base_branch.clone(),
        current_git_email: git_text(cwd, &["config", "user.email"])
            .ok()
            .filter(|email| !email.is_empty()),
        common_dir,
        branch_count: branches.lines().count(),
        branches: branch_snapshots,
        worktrees,
        observed_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_ID: AtomicU64 = AtomicU64::new(0);

    struct Repository {
        root: PathBuf,
    }

    impl Repository {
        fn new() -> Self {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "global status git fixture {} {}",
                std::process::id(),
                id
            ));
            fs::create_dir_all(&root).unwrap();
            let repository = Self { root };
            repository.git(&["init", "-b", "base"]);
            repository.git(&["config", "user.email", "fixture@example.test"]);
            repository.git(&["config", "user.name", "Fixture"]);
            fs::write(repository.root.join("tracked.txt"), "initial\n").unwrap();
            repository.git(&["add", "tracked.txt"]);
            repository.git(&["commit", "-m", "initial"]);
            repository
        }

        fn git(&self, args: &[&str]) -> String {
            let output = Command::new("git")
                .args(args)
                .current_dir(&self.root)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {:?}: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
            String::from_utf8(output.stdout).unwrap()
        }

        fn config(&self) -> ProjectConfig {
            ProjectConfig {
                id: "fixture".to_string(),
                path: self.root.to_string_lossy().into_owned(),
                base_branch: "base".to_string(),
            }
        }
    }

    impl Drop for Repository {
        fn drop(&mut self) {
            let _ = Command::new("git")
                .args(["worktree", "prune"])
                .current_dir(&self.root)
                .output();
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn worktree<'a>(project: &'a ProjectSnapshot, path: &Path) -> &'a WorktreeSnapshot {
        let expected = fs::canonicalize(path).unwrap();
        project
            .worktrees
            .iter()
            .find(|candidate| fs::canonicalize(&candidate.path).ok().as_ref() == Some(&expected))
            .expect("worktree is present")
    }

    #[test]
    fn includes_unchecked_branches_and_preserves_unknown_merge_state() {
        let repo = Repository::new();
        repo.git(&["branch", "inactive"]);
        repo.git(&["switch", "-c", "feature"]);
        fs::write(repo.root.join("tracked.txt"), "feature\n").unwrap();
        repo.git(&["commit", "-am", "feature addition"]);
        let snapshot = scan_project(&repo.config()).unwrap();
        let inactive = snapshot
            .branches
            .iter()
            .find(|branch| branch.name == "inactive")
            .unwrap();
        assert_eq!(inactive.merged_into_base, Some(true));
        assert!(inactive.worktree_path.is_none());
        assert!(inactive.latest_commit_at.is_some());
        let feature = snapshot
            .branches
            .iter()
            .find(|branch| branch.name == "feature")
            .unwrap();
        assert_eq!(feature.merged_into_base, Some(false));
        assert_eq!(feature.latest_commit_subject, "feature addition");
        assert!(feature.worktree_path.is_some());
        assert!(
            snapshot
                .branches
                .iter()
                .find(|branch| branch.name == "base")
                .unwrap()
                .is_base
        );
        let mut config = repo.config();
        config.base_branch = "missing".into();
        assert!(scan_project(&config)
            .unwrap()
            .branches
            .iter()
            .all(|branch| branch.merged_into_base.is_none()));
    }

    #[test]
    fn groups_linked_worktrees_and_counts_dirty_file_kinds() {
        let repo = Repository::new();
        let second = repo.root.with_file_name(format!(
            "{} feature",
            repo.root.file_name().unwrap().to_string_lossy()
        ));
        repo.git(&["worktree", "add", "-b", "feature", second.to_str().unwrap()]);
        fs::write(second.join("tracked.txt"), "changed\n").unwrap();
        fs::write(second.join("staged.txt"), "staged\n").unwrap();
        fs::write(second.join("untracked.txt"), "new\n").unwrap();
        let add = Command::new("git")
            .args(["add", "staged.txt"])
            .current_dir(&second)
            .output()
            .unwrap();
        assert!(add.status.success());

        let project = scan_project(&repo.config()).unwrap();
        assert_eq!(project.worktrees.len(), 2);
        assert_eq!(project.branch_count, 2);
        assert_eq!(
            fs::canonicalize(&project.common_dir).unwrap(),
            fs::canonicalize(repo.root.join(".git")).unwrap()
        );
        let feature = worktree(&project, &second);
        assert_eq!(feature.branch.as_deref(), Some("feature"));
        assert_eq!(feature.dirty.staged, 1);
        assert_eq!(feature.dirty.unstaged, 1);
        assert_eq!(feature.dirty.untracked, 1);
        assert!(feature.dirty.last_changed_at.is_some());

        repo.git(&["worktree", "remove", "--force", second.to_str().unwrap()]);
    }

    #[test]
    fn compares_feature_commit_with_base() {
        let repo = Repository::new();
        repo.git(&["switch", "-c", "feature"]);
        fs::write(repo.root.join("tracked.txt"), "feature\n").unwrap();
        repo.git(&["commit", "-am", "feature change"]);

        let project = scan_project(&repo.config()).unwrap();
        let feature = worktree(&project, &repo.root);
        let comparison = feature.comparison.as_ref().unwrap();
        assert_eq!(comparison.ahead, 1);
        assert_eq!(comparison.behind, 0);
        assert_eq!(comparison.unique_commits.len(), 1);
        assert_eq!(comparison.unique_commits[0].subject, "feature change");
    }

    #[test]
    fn branch_people_separate_creator_from_own_commit_authors() {
        let repo = Repository::new();
        repo.git(&["switch", "-c", "feature"]);
        fs::write(repo.root.join("tracked.txt"), "alice\n").unwrap();
        repo.git(&[
            "-c",
            "user.name=Alice",
            "-c",
            "user.email=alice@example.test",
            "commit",
            "-am",
            "Alice change",
        ]);
        fs::write(repo.root.join("tracked.txt"), "bob\n").unwrap();
        repo.git(&[
            "-c",
            "user.name=Bob",
            "-c",
            "user.email=bob@example.test",
            "commit",
            "-am",
            "Bob change",
        ]);
        let snapshot = scan_project(&repo.config()).unwrap();
        assert_eq!(
            snapshot.current_git_email.as_deref(),
            Some("fixture@example.test")
        );
        let people = &snapshot
            .branches
            .iter()
            .find(|branch| branch.name == "feature")
            .unwrap()
            .people;
        assert_eq!(
            people.creator.as_ref().map(|person| person.name.as_str()),
            Some("Fixture")
        );
        assert_eq!(people.scope, "sinceCreation");
        assert_eq!(
            people
                .contributors
                .iter()
                .map(|person| person.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Bob", "Alice"]
        );
        assert_eq!(
            people
                .contributors
                .iter()
                .map(|person| person.commits)
                .collect::<Vec<_>>(),
            vec![1, 1]
        );
    }

    #[test]
    fn github_origin_parser_accepts_only_repository_urls() {
        assert_eq!(
            github_repo_from_origin("git@github.com:tellyn-ai/tellyn.git"),
            Some(("tellyn-ai".into(), "tellyn".into()))
        );
        assert_eq!(
            github_repo_from_origin("https://github.com/horisony/vibe-branch-merge-panel.git"),
            Some(("horisony".into(), "vibe-branch-merge-panel".into()))
        );
        assert_eq!(
            github_repo_from_origin("https://example.com/other/repo.git"),
            None
        );
    }

    #[test]
    fn remote_tracking_checkout_is_not_treated_as_branch_creator() {
        assert!(is_local_branch_creation("branch: Created from base"));
        assert!(!is_local_branch_creation(
            "branch: Created from origin/feature"
        ));
        assert!(!is_local_branch_creation(
            "branch: Created from refs/remotes/origin/feature"
        ));
    }

    #[test]
    fn remote_tracking_branch_counts_only_commits_after_checkout() {
        let repo = Repository::new();
        repo.git(&["switch", "-c", "seed"]);
        fs::write(repo.root.join("tracked.txt"), "older work\n").unwrap();
        repo.git(&[
            "-c", "user.name=Older", "-c", "user.email=older@example.test",
            "commit", "-am", "older work",
        ]);
        repo.git(&["update-ref", "refs/remotes/origin/seed", "HEAD"]);
        repo.git(&["switch", "base"]);
        repo.git(&["switch", "-c", "feature", "origin/seed"]);
        fs::write(repo.root.join("tracked.txt"), "new work\n").unwrap();
        repo.git(&[
            "-c", "user.name=Newer", "-c", "user.email=newer@example.test",
            "commit", "-am", "new work",
        ]);

        let people = branch_people(&repo.root, "feature", "base");
        assert!(people.creator.is_none());
        assert_eq!(people.scope, "sinceCreation");
        assert_eq!(people.contributors.len(), 1);
        assert_eq!(people.contributors[0].name, "Newer");
    }

    #[test]
    fn keeps_detached_head_visible_when_base_is_missing() {
        let repo = Repository::new();
        repo.git(&["switch", "--detach"]);
        let mut config = repo.config();
        config.base_branch = "does-not-exist".to_string();

        let project = scan_project(&config).unwrap();
        let detached = worktree(&project, &repo.root);
        assert!(detached.branch.is_none());
        assert!(!detached.head.is_empty());
        assert!(detached.comparison.is_none());
        assert!(detached
            .comparison_error
            .as_ref()
            .unwrap()
            .contains("does-not-exist"));
    }
}
