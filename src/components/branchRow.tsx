import type { BranchSnapshot, DeploymentEvidence, ProjectStatus } from '../statusTypes';
import { evidenceTime, hasChanges, isActiveDevelopment, relativeTime } from '../statusTypes';
import { WorktreeRow } from './worktreeRow';

export const BranchRow = ({ branch, project, deployments, nowSeconds }: {
  branch: BranchSnapshot;
  project: ProjectStatus;
  deployments: DeploymentEvidence[];
  nowSeconds: number;
}) => {
  const worktree = project.git?.worktrees.find((item) => item.path === branch.worktreePath);
  const session = project.sessions.find((item) => item.worktreePath === branch.worktreePath);
  const coding = worktree ? isActiveDevelopment(worktree, session?.evidence, nowSeconds) : false;
  const changeCount = worktree ? worktree.dirty.staged + worktree.dirty.unstaged + worktree.dirty.untracked : 0;
  const running = deployments.filter((item) => item.status === 'verified' && item.runtimeSha === branch.head);
  const deploymentLabel = running.length > 0
    ? `已部署 ${running.map((item) => `${item.environment}/${item.service}`).join('、')}`
    : deployments.some((item) => item.status === 'verified') ? '当前提交未运行' : '部署未核实';
  return <article className="branchRow">
    <div className="branchHeading"><h3>{branch.name}</h3>{coding && <span className="statusPill prominent">正在写代码</span>}</div>
    <p className="commitLine" title={branch.latestCommitAt === null ? undefined : evidenceTime(branch.latestCommitAt)}>
      <code>{branch.head.slice(0, 8)}</code> · 最近提交 {relativeTime(branch.latestCommitAt, nowSeconds)}
    </p>
    <p className="commitSubject">{branch.latestCommitSubject || '提交内容未知'}</p>
    <div className="branchStatuses">
      <span className="statusPill">{branch.mergedIntoBase === true ? '已并入本地基线' : branch.mergedIntoBase === false ? '未并入' : '合并未核实'}</span>
      <span className="statusPill">{deploymentLabel}</span>
      {worktree && <span className="statusPill">{worktree.scanError ? '改动未核实' : hasChanges(worktree) ? `未提交 ${changeCount}` : '工作目录干净'}</span>}
      {!worktree && <span className="statusPill">未检出工作目录</span>}
    </div>
    {worktree && <div className="branchDetails"><WorktreeRow worktree={worktree} project={project} /></div>}
  </article>;
};
