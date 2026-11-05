export interface ProjectConfig { id: string; path: string; baseBranch: string }
export interface WorktreeSnapshot { path: string; branch: string | null; head: string; dirty: { staged: number; unstaged: number; untracked: number; lastChangedAt: number | null }; comparison: { ahead: number; behind: number; uniqueCommits: { sha: string; subject: string }[] } | null; comparisonError: string | null; scanError: string | null }
export interface PersonEvidence { name: string; email: string; commits: number; sampleSha: string | null; githubLogin: string | null; avatarUrl: string | null }
export interface BranchPeople { creator: PersonEvidence | null; contributors: PersonEvidence[]; scope: 'sinceCreation' | 'unique' | 'recent' }
export interface GithubAvatar { login: string; avatarUrl: string }
export interface BranchSnapshot { name: string; head: string; latestCommitAt: number | null; latestCommitSubject: string; mergedIntoBase: boolean | null; isBase: boolean; worktreePath: string | null; people: BranchPeople }
export interface SessionEvidence { sessions: { sessionId: string; cwd: string; lastSeen: number; active: boolean }[]; sharedWorktreeWarning: boolean; malformedLines: number }
export interface ProjectStatus { config: ProjectConfig; git: { id: string; path: string; baseBranch: string; currentGitEmail: string | null; commonDir: string; branchCount: number; branches: BranchSnapshot[]; worktrees: WorktreeSnapshot[]; observedAt: number } | null; error: string | null; sessions: { worktreePath: string; evidence: SessionEvidence | null; error: string | null }[] }
export interface StatusSnapshot { projects: ProjectStatus[]; observedAt: number }
export interface GithubEvidence { status: string; reason?: string; observedAt: number; headSha: string; pullRequests: { number: number; url: string; state: string; baseRefName: string; headRefOid: string; isDraft: boolean }[]; checksState: 'passed' | 'failed' | 'pending' | 'none' | 'unknown'; checks: { name: string; state: 'passed' | 'failed' | 'pending' | 'unknown'; url: string | null; source: string }[] }
export const hasChanges = (worktree: WorktreeSnapshot) => worktree.dirty.staged + worktree.dirty.unstaged + worktree.dirty.untracked > 0;
export const isActiveDevelopment = (worktree: WorktreeSnapshot, evidence: SessionEvidence | null | undefined, nowSeconds: number): boolean => {
  const changedAt = worktree.dirty.lastChangedAt;
  return !worktree.scanError && changedAt !== null && changedAt <= nowSeconds && nowSeconds - changedAt <= 300 && Boolean(evidence?.sessions.some((session) => session.active));
};
export const evidenceTime = (value: number) => new Date(value < 1e12 ? value * 1000 : value).toLocaleString('zh-CN');
export const relativeTime = (value: number | null, nowSeconds: number): string => {
  if (value === null || value > nowSeconds) return '时间未知';
  const seconds = nowSeconds - value;
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)} 天前`;
  return evidenceTime(value);
};
export const hasWorktreeRisk = (project: ProjectStatus, worktree: WorktreeSnapshot): boolean =>
  Boolean(worktree.scanError || hasChanges(worktree) || project.sessions.some((session) => session.worktreePath === worktree.path && session.evidence?.sharedWorktreeWarning));
export const getDockSummary = (snapshot: StatusSnapshot | null, nowSeconds: number) => {
  if (!snapshot) return { risk: null, coding: null, merged: null };
  return snapshot.projects.reduce((total, project) => {
    if (!project.git) { total.risk += 1; return total; }
    total.risk += project.git.worktrees.filter((worktree) => hasWorktreeRisk(project, worktree)).length;
    total.coding += project.git.branches.filter((branch) => {
      const worktree = project.git?.worktrees.find((item) => item.path === branch.worktreePath);
      const session = project.sessions.find((item) => item.worktreePath === branch.worktreePath);
      return worktree && isActiveDevelopment(worktree, session?.evidence, nowSeconds);
    }).length;
    total.merged += project.git.branches.filter((branch) => !branch.isBase && branch.mergedIntoBase === true).length;
    return total;
  }, { risk: 0, coding: 0, merged: 0 });
};
export interface DeploymentEvidence { environment: string; service: string; status: 'verified' | 'mismatch' | 'unknown'; runtimeSha: string | null; deploymentSha: string | null; deploymentUrl: string | null; runtimeSource: string; reason: string | null; observedAt: number }
export interface ChangedFile { path: string; previousPath: string | null; status: string }
export interface CommitPreview { headSha: string; branch: string; statusToken: string; files: ChangedFile[] }
export interface CommitPushResult { commitSha: string; pushed: boolean; pushError: string | null }
export interface PrSummary { number: number; url: string; baseRefName: string }
export interface PrPreview { repository: string; headSha: string; branch: string; targets: string[]; needsPush: boolean; existing: PrSummary[] }
export interface PrResult { url: string; existing: boolean; pushed: boolean }
