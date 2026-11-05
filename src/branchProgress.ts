import type { BranchSnapshot, DeploymentEvidence, WorktreeSnapshot } from './statusTypes';
import { hasChanges } from './statusTypes';

export type StageTone = 'done' | 'attention' | 'unknown' | 'delegated';
export interface BranchStage { name: string; detail: string; tone: StageTone }

export const getBranchProgress = (branch: BranchSnapshot, worktree: WorktreeSnapshot | undefined, deployments: DeploymentEvidence[]): [BranchStage, BranchStage, BranchStage] => {
  const commit: BranchStage = worktree?.scanError ? { name: '提交', detail: '改动未核实', tone: 'unknown' }
    : worktree && hasChanges(worktree) ? { name: '提交', detail: '有待提交改动', tone: 'attention' }
      : { name: '提交', detail: '已有提交', tone: 'done' };
  const merge: BranchStage = branch.isBase ? { name: '并入', detail: '当前基线', tone: 'delegated' }
    : branch.mergedIntoBase === true ? { name: '并入', detail: '已并入本地基线', tone: 'done' }
      : branch.mergedIntoBase === false ? { name: '并入', detail: '未见本地并入', tone: 'attention' }
        : { name: '并入', detail: '合并未核实', tone: 'unknown' };
  const running = deployments.filter((item) => item.status === 'verified' && item.runtimeSha === branch.head);
  const deploy: BranchStage = running.length > 0
    ? { name: '部署', detail: `已运行 ${running.map((item) => `${item.environment}/${item.service}`).join('、')}`, tone: 'done' }
    : !branch.isBase ? { name: '部署', detail: '由发布分支核对', tone: 'delegated' }
      : deployments.some((item) => item.status === 'verified') ? { name: '部署', detail: '当前提交未运行', tone: 'attention' }
        : { name: '部署', detail: '部署未核实', tone: 'unknown' };
  return [commit, merge, deploy];
};
