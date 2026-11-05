# Codex session evidence (opt in)

Verified against [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) on 2026-11-05. Command handlers receive JSON on stdin with `session_id`, `cwd`, and `hook_event_name`. Hooks are loaded from `~/.codex/hooks.json` or a trusted repo's `.codex/hooks.json`. Existing hooks are additive: merge entries without replacing existing configuration. Review and trust the hook through Codex's hook trust UI; restart/start a new session after installation.

Run `python3 apps/globalWorkStatus/hooks/installCodexHook.py` from the repository root to copy the hook to `~/.codex/hooks/codexEvents.py` and append handlers to the existing `~/.codex/hooks.json`. The installer keeps existing hooks, writes a timestamped backup, and is safe to run again. Then review and trust the hook in Codex and start a new chat. To install manually, use the equivalent configuration below; install in only one config layer to avoid duplicates.

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

Use shell quoting around the script path if it contains spaces. The app does not install hooks automatically. Remove these handlers to disable. Delete the log to erase stored metadata.

The script writes only session ID, canonical cwd, event type and local Unix seconds to `~/.codex/globalWorkStatus/events.jsonl` (override with `GLOBAL_WORK_STATUS_EVENTS` in both hook and scanner configuration). It never opens transcripts or saves prompts, tool input/output or source code. Concurrent writers use an exclusive file lock; new directory/file modes are 0700/0600. Hook input failures are ignored without affecting Codex.

Rust `load_sessions(logPath, nowUnixSeconds)` parses the event log once per snapshot, then `evidence_for_worktree` associates sessions with each worktree and reports activity/lastSeen and shared-worktree warnings. Stop/Interrupt/SessionEnd clear activity; silence expires it (recommended 300 seconds). Long model/tool calls without events may expire: activity is evidence freshness, not proof of process liveness. SessionStart is evidence of session initialization, not proof of editing. No hook evidence must remain unknown; missing/unreadable log returns an error. Malformed lines are skipped and counted. Latest timestamp per session wins, preventing older stop events from clearing new activity. Canonical cwd descendants map to the selected worktree; linked worktrees retain separate paths. Subagent-specific events are excluded because official hooks use the parent's session ID.

Tests: `bun test apps/globalWorkStatus/hooks/codexEvents.spec.ts`; Rust tests reside in `sessions.rs` and run with the application crate once wired with `mod sessions;`.
