import type { BranchSnapshot, PullRequestEvidence, WorktreeSnapshot } from './statusTypes';
import { hasChanges } from './statusTypes';

export type StageTone = 'done' | 'attention' | 'unknown' | 'delegated';
export interface BranchStage { name: string; detail: string; tone: StageTone; value?: string }
export interface PullRequestLookup { status: 'idle' | 'loading' | 'observed' | 'unknown'; pullRequests: PullRequestEvidence[]; reason?: string }

export const getBranchProgress = (branch: BranchSnapshot, worktree: WorktreeSnapshot | undefined, baseBranch: string, pullRequests: PullRequestLookup): [BranchStage, BranchStage, BranchStage, BranchStage] => {
  const commit: BranchStage = worktree?.scanError ? { name: 'commit', detail: '改动未核实', tone: 'unknown' }
    : worktree && hasChanges(worktree) ? { name: 'commit', detail: '有待提交改动', tone: 'attention' }
      : { name: 'commit', detail: '工作区干净，提交已就绪', tone: 'done' };

  const push: BranchStage = worktree?.scanError ? { name: 'push', detail: '本地状态未核实', tone: 'unknown' }
    : branch.upstream === null ? { name: 'push', detail: '未配置远端跟踪分支，无法确认', tone: 'unknown' }
      : branch.aheadOfUpstream === null ? { name: 'push', detail: '远端差异未核实', tone: 'unknown' }
        : branch.aheadOfUpstream > 0 ? { name: 'push', detail: `有 ${branch.aheadOfUpstream} 个提交待推送`, tone: 'attention', value: `${branch.aheadOfUpstream} 待推送` }
          : { name: 'push', detail: `已推送到 ${branch.upstream}`, tone: 'done' };

  if (branch.isBase) {
    return [commit, push, { name: '提 PR', detail: '基线分支无需创建 PR', tone: 'delegated' }, { name: '已合并/已拒绝', detail: '当前项目基线', tone: 'delegated' }];
  }

  const candidates = pullRequests.status === 'observed'
    ? pullRequests.pullRequests.filter((pr) => pr.headRefName === branch.name && pr.baseRefName === baseBranch)
    : [];
  const pr = candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const request: BranchStage = pullRequests.status === 'idle'
    ? { name: '提 PR', detail: '展开项目后查询 GitHub', tone: 'unknown' }
    : pullRequests.status === 'loading'
    ? { name: '提 PR', detail: '正在查询 GitHub', tone: 'unknown' }
    : pullRequests.status === 'unknown'
      ? { name: '提 PR', detail: pullRequests.reason ?? 'PR 状态未核实', tone: 'unknown' }
      : pr
        ? { name: '提 PR', detail: `已创建 PR #${pr.number}${pr.isDraft ? '（草稿）' : ''}`, tone: 'done', value: `#${pr.number}` }
        : { name: '提 PR', detail: '尚未创建 PR', tone: 'attention' };

  const outcome: BranchStage = pullRequests.status !== 'observed'
    ? { name: '已合并/已拒绝', detail: '等待 PR 状态', tone: 'unknown' }
    : !pr
      ? { name: '已合并/已拒绝', detail: '创建 PR 后显示结果', tone: 'unknown' }
      : pr.state === 'MERGED'
        ? { name: '已合并/已拒绝', detail: `PR #${pr.number} 已合并`, tone: 'done' }
        : pr.state === 'CLOSED'
          ? { name: '已合并/已拒绝', detail: `PR #${pr.number} 已拒绝或关闭`, tone: 'attention' }
          : { name: '已合并/已拒绝', detail: `PR #${pr.number} 等待审核与合并`, tone: 'unknown' };

  return [commit, push, request, outcome];
};
