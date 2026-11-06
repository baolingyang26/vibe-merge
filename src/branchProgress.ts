import type { BranchSnapshot, DeploymentEvidence, WorktreeSnapshot } from './statusTypes';
import { hasChanges } from './statusTypes';

export type StageTone = 'done' | 'attention' | 'unknown' | 'delegated';
export interface BranchStage { name: string; detail: string; tone: StageTone; value?: string }

export const getBranchProgress = (branch: BranchSnapshot, worktree: WorktreeSnapshot | undefined, deployments: DeploymentEvidence[]): [BranchStage, BranchStage, BranchStage] => {
  const commit: BranchStage = worktree?.scanError ? { name: '提交', detail: '改动未核实', tone: 'unknown' }
    : worktree && hasChanges(worktree) ? { name: '提交', detail: '有待提交改动', tone: 'attention' }
      : { name: '提交', detail: '已有提交', tone: 'done' };
  const progress = branch.mergeProgress;
  const merge: BranchStage = branch.isBase ? { name: '并入', detail: '当前基线', tone: 'delegated' }
    : !progress ? { name: '并入', detail: '提交并入状态未核实', tone: 'unknown' }
      : progress.total === 0 ? { name: '并入', detail: '没有可统计的代码提交', tone: 'delegated', value: '0/0' }
        : { name: '并入', detail: `${progress.merged}/${progress.total} 个提交已进入本地基线${progress.equivalent ? `，其中 ${progress.equivalent} 个为等价补丁` : ''}`, tone: progress.merged === progress.total ? 'done' : 'attention', value: `${progress.merged}/${progress.total}` };
  const running = deployments.filter((item) => item.status === 'verified' && item.runtimeSha === branch.head);
  const deploy: BranchStage = running.length > 0
    ? { name: '部署', detail: `已运行 ${running.map((item) => `${item.environment}/${item.service}`).join('、')}`, tone: 'done' }
    : !branch.isBase ? { name: '部署', detail: '由发布分支核对', tone: 'delegated' }
      : deployments.some((item) => item.status === 'verified') ? { name: '部署', detail: '当前提交未运行', tone: 'attention' }
        : { name: '部署', detail: '部署未核实', tone: 'unknown' };
  return [commit, merge, deploy];
};
