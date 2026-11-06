import { expect, test } from "bun:test";
import { getDockSummary, isActiveDevelopment, type ProjectStatus, type SessionEvidence, type WorktreeSnapshot } from "../src/statusTypes";

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

test("dock counts risks, active coding branches and merged non-base branches separately", () => {
  const project: ProjectStatus = {
    config: { id: "repo", path: "/repo/worktree", baseBranch: "main" },
    git: {
      id: "repo", path: "/repo/worktree", baseBranch: "main", currentGitEmail: null, commonDir: "/repo/.git", branchCount: 3, observedAt: 120,
      worktrees: [worktree],
      branches: [
        { name: "main", head: "b".repeat(40), latestCommitAt: 90, latestCommitSubject: "base", mergedIntoBase: true, mergedIntoBranches: [], isBase: true, worktreePath: null, people: { creator: null, contributors: [], scope: 'recent' } },
        { name: "feature", head: worktree.head, latestCommitAt: 100, latestCommitSubject: "feature", mergedIntoBase: false, mergedIntoBranches: [], isBase: false, worktreePath: worktree.path, people: { creator: null, contributors: [], scope: 'unique' } },
        { name: "old", head: "c".repeat(40), latestCommitAt: 80, latestCommitSubject: "old", mergedIntoBase: true, mergedIntoBranches: ["main"], isBase: false, worktreePath: null, people: { creator: null, contributors: [], scope: 'recent' } },
      ],
    },
    error: null,
    sessions: [{ worktreePath: worktree.path, evidence: sessions, error: null }],
  };
  expect(getDockSummary({ projects: [project], observedAt: 120 }, 120)).toEqual({ risk: 1, coding: 1, merged: 1 });
  expect(getDockSummary(null, 120)).toEqual({ risk: null, coding: null, merged: null });
});
