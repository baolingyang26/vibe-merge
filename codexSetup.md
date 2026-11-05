# Codex session evidence (opt in)

Verified against [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) on 2026-11-05. Command handlers receive JSON on stdin with `session_id`, `cwd`, and `hook_event_name`. Hooks are loaded from `~/.codex/hooks.json` or a trusted repo's `.codex/hooks.json`. Existing hooks are additive: merge entries without replacing existing configuration. Review and trust the hook through Codex's hook trust UI; restart/start a new session after installation.

1. Copy `hooks/codexEvents.py` to a stable absolute path, e.g. `~/.codex/hooks/codexEvents.py`.
2. Add the following object to your hooks configuration, replacing `/ABSOLUTE/PATH` with that actual path. Install in only one config layer to avoid duplicates.

```json
{
  "hooks": {
    "SessionStart": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "PreToolUse": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "PostToolUse": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "Stop": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "Interrupt": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}],
    "SessionEnd": [{"hooks":[{"type":"command","command":"python3 /ABSOLUTE/PATH/codexEvents.py","timeout":3}]}]
  }
}
```

Use shell quoting around the script path if it contains spaces. Nothing is installed automatically. Remove these handlers to disable. Delete the log to erase stored metadata.

The script writes only session ID, canonical cwd, event type and local Unix seconds to `~/.codex/globalWorkStatus/events.jsonl` (override with `GLOBAL_WORK_STATUS_EVENTS` in both hook and scanner configuration). It never opens transcripts or saves prompts, tool input/output or source code. Concurrent writers use an exclusive file lock; new directory/file modes are 0700/0600. Hook input failures are ignored without affecting Codex.

Rust `load_sessions(logPath, nowUnixSeconds)` parses the event log once per snapshot, then `evidence_for_worktree` associates sessions with each worktree and reports activity/lastSeen and shared-worktree warnings. Stop/Interrupt/SessionEnd clear activity; silence expires it (recommended 300 seconds). Long model/tool calls without events may expire: activity is evidence freshness, not proof of process liveness. SessionStart is evidence of session initialization, not proof of editing. No hook evidence must remain unknown; missing/unreadable log returns an error. Malformed lines are skipped and counted. Latest timestamp per session wins, preventing older stop events from clearing new activity. Canonical cwd descendants map to the selected worktree; linked worktrees retain separate paths. Subagent-specific events are excluded because official hooks use the parent's session ID.

Tests: `bun test apps/globalWorkStatus/hooks/codexEvents.spec.ts`; Rust tests reside in `sessions.rs` and run with the application crate once wired with `mod sessions;`.
