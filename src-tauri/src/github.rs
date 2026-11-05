#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_pr_states_and_no_pr() {
        for state in ["OPEN", "MERGED"] {
            let json = format!(
                r#"[{{"number":7,"url":"https://github.com/o/r/pull/7","state":"{state}","baseRefName":"main","headRefOid":"abc","isDraft":false}}]"#
            );
            assert_eq!(parse_prs(&json).unwrap()[0].state, state);
        }
        assert!(parse_prs("[]").unwrap().is_empty());
        assert!(parse_prs("offline/auth error").is_err());
    }
    #[test]
    fn failure_is_unknown_and_timestamped() {
        let evidence = unknown("offline");
        assert_eq!(evidence.status, "unknown");
        assert!(evidence.observed_at > 0);
        assert!(evidence.checks.is_empty());
    }
    #[test]
    fn classifies_checks_for_the_requested_commit_without_calling_empty_passed() {
        let success = vec![CheckEvidence {
            name: "build".into(),
            state: "passed".into(),
            url: None,
            source: "check-run".into(),
        }];
        assert_eq!(checks_state(&success), "passed");
        let mut failed = success.clone();
        failed.push(CheckEvidence {
            name: "test".into(),
            state: "failed".into(),
            url: None,
            source: "status".into(),
        });
        assert_eq!(checks_state(&failed), "failed");
        let pending = vec![CheckEvidence {
            name: "test".into(),
            state: "pending".into(),
            url: None,
            source: "check-run".into(),
        }];
        assert_eq!(checks_state(&pending), "pending");
        assert_eq!(checks_state(&[]), "none");
    }
    #[test]
    fn parses_real_check_run_and_legacy_status_shapes() {
        let runs = r#"[{"check_runs":[{"name":"build","status":"completed","conclusion":"failure","details_url":"https://example.test/build"},{"name":"test","status":"in_progress","conclusion":null,"details_url":null}]}]"#;
        let statuses = r#"{"statuses":[{"context":"legacy","state":"success","target_url":"https://example.test/legacy"},{"context":"legacy","state":"failure","target_url":null}]}"#;
        let mut checks = parse_check_runs(runs).unwrap();
        checks.extend(parse_commit_statuses(statuses).unwrap());
        assert_eq!(checks.len(), 3);
        assert_eq!(checks[0].state, "failed");
        assert_eq!(checks[1].state, "pending");
        assert_eq!(checks[2].state, "passed");
        assert_eq!(checks_state(&checks), "failed");
    }
}

use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u64,
    pub url: String,
    pub state: String,
    pub base_ref_name: String,
    pub head_ref_oid: String,
    pub is_draft: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubEvidence {
    pub status: String,
    pub reason: Option<String>,
    pub observed_at: u64,
    pub head_sha: String,
    pub pull_requests: Vec<PullRequest>,
    pub checks: Vec<CheckEvidence>,
    pub checks_state: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckEvidence {
    pub name: String,
    pub state: String,
    pub url: Option<String>,
    pub source: String,
}
#[derive(Deserialize)]
struct CheckRun {
    name: String,
    status: String,
    conclusion: Option<String>,
    details_url: Option<String>,
}
#[derive(Deserialize)]
struct CommitStatus {
    context: String,
    state: String,
    target_url: Option<String>,
}
fn checks_state(checks: &[CheckEvidence]) -> &'static str {
    if checks.is_empty() {
        return "none";
    }
    if checks.iter().any(|check| check.state == "failed") {
        return "failed";
    }
    if checks.iter().any(|check| check.state == "pending") {
        return "pending";
    }
    if checks.iter().any(|check| check.state == "unknown") {
        return "unknown";
    }
    "passed"
}
fn check_run_evidence(run: CheckRun) -> CheckEvidence {
    let state = if run.status != "completed" {
        "pending"
    } else {
        match run.conclusion.as_deref() {
            Some("success" | "neutral" | "skipped") => "passed",
            Some("failure" | "timed_out" | "cancelled" | "action_required" | "stale") => "failed",
            _ => "unknown",
        }
    };
    CheckEvidence {
        name: run.name,
        state: state.into(),
        url: run.details_url,
        source: "check-run".into(),
    }
}
fn commit_status_evidence(status: CommitStatus) -> CheckEvidence {
    let state = match status.state.as_str() {
        "success" => "passed",
        "pending" => "pending",
        "failure" | "error" => "failed",
        _ => "unknown",
    };
    CheckEvidence {
        name: status.context,
        state: state.into(),
        url: status.target_url,
        source: "commit-status".into(),
    }
}
fn parse_check_runs(raw: &str) -> Result<Vec<CheckEvidence>, &'static str> {
    let pages: Vec<serde_json::Value> =
        serde_json::from_str(raw).map_err(|_| "invalid checks response")?;
    let mut checks = Vec::new();
    for page in pages {
        let entries = page
            .get("check_runs")
            .and_then(|value| value.as_array())
            .ok_or("missing check runs")?;
        for entry in entries {
            let run = serde_json::from_value::<CheckRun>(entry.clone())
                .map_err(|_| "invalid check run")?;
            checks.push(check_run_evidence(run));
        }
    }
    Ok(checks)
}
fn parse_commit_statuses(raw: &str) -> Result<Vec<CheckEvidence>, &'static str> {
    let response: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "invalid commit statuses response")?;
    let entries = response
        .get("statuses")
        .and_then(|value| value.as_array())
        .ok_or("missing commit statuses")?;
    let mut seen = std::collections::HashSet::new();
    let mut checks = Vec::new();
    for entry in entries {
        let status = serde_json::from_value::<CommitStatus>(entry.clone())
            .map_err(|_| "invalid commit status")?;
        if seen.insert(status.context.clone()) {
            checks.push(commit_status_evidence(status));
        }
    }
    Ok(checks)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn unknown(reason: &str) -> GithubEvidence {
    GithubEvidence {
        status: "unknown".into(),
        reason: Some(reason.into()),
        observed_at: now(),
        head_sha: String::new(),
        pull_requests: vec![],
        checks: vec![],
        checks_state: "unknown".into(),
    }
}
fn parse_prs(raw: &str) -> Result<Vec<PullRequest>, serde_json::Error> {
    serde_json::from_str(raw)
}

// Pipes are drained concurrently so a large response cannot deadlock the timeout.
pub(crate) fn run(path: &Path, program: &str, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new(program)
        .args(args)
        .current_dir(path)
        .env("GH_PROMPT_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| format!("{program} unavailable"))?;
    let mut stdout = child.stdout.take().ok_or("stdout unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let bytes = reader.join().map_err(|_| "response reader failed")?;
                if !status.success() {
                    return Err(format!(
                        "{program} failed: offline, unauthenticated, or inaccessible"
                    ));
                }
                return String::from_utf8(bytes).map_err(|_| "invalid response encoding".into());
            }
            Ok(None) if start.elapsed() < Duration::from_secs(10) => {
                std::thread::sleep(Duration::from_millis(25))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{program} timed out or failed"));
            }
        }
    }
}

/// Read-only GitHub evidence. Times are Unix seconds; cached observations retain their original time.
pub fn scan_github(path: &Path, branch: &str, head_sha: &str, target_base: &str) -> GithubEvidence {
    type Cache = HashMap<(std::path::PathBuf, String, String, String), (Instant, GithubEvidence)>;
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let key = (
        path.to_path_buf(),
        branch.into(),
        head_sha.into(),
        target_base.into(),
    );
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(entries) = cache.lock() {
        if let Some((time, value)) = entries.get(&key) {
            if time.elapsed() < Duration::from_secs(30) {
                return value.clone();
            }
        }
    }
    let result = (|| -> Result<GithubEvidence, String> {
        if run(path, "git", &["remote", "get-url", "origin"])?
            .trim()
            .is_empty()
        {
            return Err("repository has no origin remote".into());
        }
        let raw = run(
            path,
            "gh",
            &[
                "pr",
                "list",
                "--state",
                "all",
                "--head",
                branch,
                "--base",
                target_base,
                "--limit",
                "100",
                "--json",
                "number,url,state,baseRefName,headRefOid,isDraft",
            ],
        )?;
        let prs = parse_prs(&raw).map_err(|_| "invalid PR response")?;
        // gh resolves {owner}/{repo} from this worktree's origin. Checks are always queried for the supplied SHA.
        if head_sha.is_empty() || !head_sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid HEAD SHA".into());
        }
        let endpoint =
            format!("repos/{{owner}}/{{repo}}/commits/{head_sha}/check-runs?per_page=100");
        let raw = run(path, "gh", &["api", "--paginate", "--slurp", &endpoint])?;
        let mut checks = parse_check_runs(&raw)?;
        let endpoint = format!("repos/{{owner}}/{{repo}}/commits/{head_sha}/status");
        let raw = run(path, "gh", &["api", &endpoint])?;
        checks.extend(parse_commit_statuses(&raw)?);
        let summary = checks_state(&checks).into();
        Ok(GithubEvidence {
            status: "observed".into(),
            reason: None,
            observed_at: now(),
            head_sha: head_sha.into(),
            pull_requests: prs,
            checks,
            checks_state: summary,
        })
    })();
    let evidence = result.unwrap_or_else(|reason| {
        let mut value = unknown(&reason);
        value.head_sha = head_sha.into();
        value
    });
    if let Ok(mut entries) = cache.lock() {
        if entries.len() > 256 {
            entries.clear();
        }
        entries.insert(key, (Instant::now(), evidence.clone()));
    }
    evidence
}
