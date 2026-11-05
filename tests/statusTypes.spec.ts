import { expect, test } from "bun:test";
import { isActiveDevelopment, type SessionEvidence, type WorktreeSnapshot } from "../src/statusTypes";

const worktree: WorktreeSnapshot = {
  path: "/repo/worktree",
  branch: "feature",
  head: "a".repeat(40),
  dirty: { staged: 0, unstaged: 1, untracked: 0, lastChangedAt: 100 },
  comparison: null,
  comparisonError: null,
  scanError: null,
};
const sessions: SessionEvidence = {
  sessions: [{ sessionId: "thread", cwd: "/repo/worktree", lastSeen: 100, active: true }],
  sharedWorktreeWarning: false,
  malformedLines: 0,
};

test("active development needs both a live Codex session and recent changed file", () => {
  expect(isActiveDevelopment(worktree, sessions, 120)).toBe(true);
  expect(isActiveDevelopment(worktree, sessions, 500)).toBe(false);
  expect(isActiveDevelopment(worktree, { ...sessions, sessions: [] }, 120)).toBe(false);
  expect(isActiveDevelopment({ ...worktree, dirty: { ...worktree.dirty, lastChangedAt: null } }, sessions, 120)).toBe(false);
});
