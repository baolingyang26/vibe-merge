use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io::{self, BufRead},
    path::{Path, PathBuf},
};

#[derive(Debug, Deserialize)]
struct Event {
    session_id: String,
    cwd: PathBuf,
    event_type: String,
    timestamp: u64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub session_id: String,
    pub cwd: String,
    pub last_seen: u64,
    pub active: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionEvidence {
    pub sessions: Vec<Session>,
    pub shared_worktree_warning: bool,
    pub malformed_lines: usize,
}

pub struct ParsedSessions {
    latest: BTreeMap<String, Event>,
    malformed: usize,
}

/// Parse the event stream once for a complete snapshot. Newest timestamp wins.
pub fn parse_sessions(reader: impl BufRead, now: u64) -> io::Result<ParsedSessions> {
    let mut latest = BTreeMap::<String, Event>::new();
    let mut malformed = 0;
    for line in reader.split(b'\n') {
        let line = line?;
        if line.is_empty() {
            continue;
        }
        let event = match serde_json::from_slice::<Event>(&line) {
            Ok(e) => e,
            Err(_) => {
                malformed += 1;
                continue;
            }
        };
        if event.session_id.is_empty() || !event.cwd.is_absolute() || event.timestamp > now {
            malformed += 1;
            continue;
        }
        if !matches!(
            event.event_type.as_str(),
            "SessionStart"
                | "UserPromptSubmit"
                | "PreToolUse"
                | "PostToolUse"
                | "Stop"
                | "Interrupt"
                | "SessionEnd"
        ) {
            malformed += 1;
            continue;
        }
        if latest
            .get(&event.session_id)
            .is_none_or(|old| old.timestamp <= event.timestamp)
        {
            latest.insert(event.session_id.clone(), event);
        }
    }
    Ok(ParsedSessions { latest, malformed })
}

/// Only matches canonical descendants of this selected worktree.
pub fn evidence_for_worktree(
    parsed: &ParsedSessions,
    worktree: &Path,
    now: u64,
    expiry: u64,
) -> io::Result<SessionEvidence> {
    let root = worktree.canonicalize()?;
    let sessions: Vec<Session> = parsed
        .latest
        .values()
        .filter_map(|e| {
            let cwd = e.cwd.canonicalize().ok()?;
            if !cwd.starts_with(&root) {
                return None;
            }
            let active = !matches!(e.event_type.as_str(), "Stop" | "Interrupt" | "SessionEnd")
                && now.saturating_sub(e.timestamp) < expiry;
            Some(Session {
                session_id: e.session_id.clone(),
                cwd: cwd.to_string_lossy().into_owned(),
                last_seen: e.timestamp,
                active,
            })
        })
        .collect();
    let shared_worktree_warning = sessions.iter().filter(|s| s.active).count() > 1;
    Ok(SessionEvidence {
        sessions,
        shared_worktree_warning,
        malformed_lines: parsed.malformed,
    })
}

#[cfg(test)]
pub fn read_sessions(
    reader: impl BufRead,
    worktree: &Path,
    now: u64,
    expiry: u64,
) -> io::Result<SessionEvidence> {
    let parsed = parse_sessions(reader, now)?;
    evidence_for_worktree(&parsed, worktree, now, expiry)
}

pub fn load_sessions(path: &Path, now: u64) -> io::Result<ParsedSessions> {
    parse_sessions(io::BufReader::new(std::fs::File::open(path)?), now)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(id: &str, kind: &str, timestamp: u64) -> String {
        serde_json::json!({"session_id":id,"cwd":std::env::temp_dir(),"event_type":kind,"timestamp":timestamp}).to_string()+"\n"
    }
    #[test]
    fn malformed_conflicts_stop_expiry_and_stale_stop() {
        let input = "broken\n".to_owned()
            + &event("a", "UserPromptSubmit", 90)
            + &event("b", "PreToolUse", 91)
            + &event("a", "Stop", 80);
        let result = read_sessions(input.as_bytes(), &std::env::temp_dir(), 100, 30).unwrap();
        assert!(result.shared_worktree_warning);
        assert_eq!(result.malformed_lines, 1);
        let stopped = input + &event("a", "Stop", 99);
        assert!(
            !read_sessions(stopped.as_bytes(), &std::env::temp_dir(), 100, 30)
                .unwrap()
                .shared_worktree_warning
        );
        assert!(
            read_sessions(stopped.as_bytes(), &std::env::temp_dir(), 200, 30)
                .unwrap()
                .sessions
                .iter()
                .all(|s| !s.active)
        );
    }
}
