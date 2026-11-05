import type { BranchSnapshot, DeploymentEvidence, ProjectStatus } from '../statusTypes';
import { evidenceTime, isActiveDevelopment, relativeTime } from '../statusTypes';
import { BranchEvidence } from './branchEvidence';
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
  const progress = getBranchProgress(branch, worktree, deployments);
  return <article className="branchRow">
    <div className="branchHeading"><span className="branchSymbol"><PanelIcon name="branch" /></span><h3>{branch.name}</h3>{coding && <span className="codingSignal" role="img" aria-label="正在写代码" title="正在写代码" />}</div>
    <p className="commitLine" title={branch.latestCommitAt === null ? undefined : evidenceTime(branch.latestCommitAt)}>
      <code>{branch.head.slice(0, 8)}</code> · 最近提交 {relativeTime(branch.latestCommitAt, nowSeconds)}
    </p>
    <p className="commitSubject">{branch.latestCommitSubject || '提交内容未知'}</p>
    <BranchProgress stages={progress} />
    {worktree && <BranchEvidence name={branch.name} worktree={worktree} project={project} />}
  </article>;
};
