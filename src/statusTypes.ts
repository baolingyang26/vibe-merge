export interface ProjectConfig { id: string; path: string; baseBranch: string }
export interface WorktreeSnapshot { path: string; branch: string | null; head: string; dirty: { staged: number; unstaged: number; untracked: number; lastChangedAt: number | null }; comparison: { ahead: number; behind: number; uniqueCommits: { sha: string; subject: string }[] } | null; comparisonError: string | null; scanError: string | null }
export interface SessionEvidence { sessions: { sessionId: string; cwd: string; lastSeen: number; active: boolean }[]; sharedWorktreeWarning: boolean; malformedLines: number }
export interface ProjectStatus { config: ProjectConfig; git: { id: string; path: string; baseBranch: string; commonDir: string; branchCount: number; worktrees: WorktreeSnapshot[]; observedAt: number } | null; error: string | null; sessions: { worktreePath: string; evidence: SessionEvidence | null; error: string | null }[] }
export interface StatusSnapshot { projects: ProjectStatus[]; observedAt: number }
export interface GithubEvidence { status: string; reason?: string; observedAt: number; headSha: string; pullRequests: { number: number; url: string; state: string; baseRefName: string; headRefOid: string; isDraft: boolean }[]; checksState: 'passed' | 'failed' | 'pending' | 'none' | 'unknown'; checks: { name: string; state: 'passed' | 'failed' | 'pending' | 'unknown'; url: string | null; source: string }[] }
export const hasChanges = (worktree: WorktreeSnapshot) => worktree.dirty.staged + worktree.dirty.unstaged + worktree.dirty.untracked > 0;
export const isActiveDevelopment = (worktree: WorktreeSnapshot, evidence: SessionEvidence | null | undefined, nowSeconds: number): boolean => {
  const changedAt = worktree.dirty.lastChangedAt;
  return !worktree.scanError && changedAt !== null && changedAt <= nowSeconds && nowSeconds - changedAt <= 300 && Boolean(evidence?.sessions.some((session) => session.active));
};
export const evidenceTime = (value: number) => new Date(value < 1e12 ? value * 1000 : value).toLocaleString('zh-CN');
export interface DeploymentEvidence { environment: string; service: string; status: 'verified' | 'mismatch' | 'unknown'; runtimeSha: string | null; deploymentSha: string | null; deploymentUrl: string | null; runtimeSource: string; reason: string | null; observedAt: number }
