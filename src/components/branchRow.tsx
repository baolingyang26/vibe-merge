import type { BranchSnapshot, DeploymentEvidence, ProjectStatus } from '../statusTypes';
import { evidenceTime, hasChanges, isActiveDevelopment, relativeTime } from '../statusTypes';
import { WorktreeRow } from './worktreeRow';
import { BranchProgress } from './branchProgress';
import { getBranchProgress } from '../branchProgress';
import { PanelIcon } from './panelIcon';

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
  const progress = getBranchProgress(branch, worktree, deployments);
  return <article className="branchRow">
    <div className="branchHeading"><span className="branchSymbol"><PanelIcon name="branch" /></span><h3>{branch.name}</h3>{coding && <span className="statusPill prominent">正在写代码</span>}</div>
    <p className="commitLine" title={branch.latestCommitAt === null ? undefined : evidenceTime(branch.latestCommitAt)}>
      <code>{branch.head.slice(0, 8)}</code> · 最近提交 {relativeTime(branch.latestCommitAt, nowSeconds)}
    </p>
    <p className="commitSubject">{branch.latestCommitSubject || '提交内容未知'}</p>
    <div className="branchStatuses">
      {branch.mergedIntoBase === false && !branch.isBase && <span className="statusPill attention">未见本地并入</span>}
      {branch.mergedIntoBase === null && !branch.isBase && <span className="statusPill attention">合并未核实</span>}
      {branch.isBase && progress[2].tone !== 'done' && <span className="statusPill attention">{progress[2].detail}</span>}
      {progress[2].tone === 'done' && <span className="statusPill">已部署当前提交</span>}
      {worktree?.scanError && <span className="statusPill attention">改动未核实</span>}
      {worktree && !worktree.scanError && hasChanges(worktree) && <span className="statusPill attention">未提交 {changeCount}</span>}
    </div>
    <BranchProgress stages={progress} />
    {worktree && <div className="branchDetails"><WorktreeRow worktree={worktree} project={project} /></div>}
  </article>;
};
