import { useState } from 'react';
import type { DeploymentEvidence, ProjectStatus } from '../statusTypes';
import { hasChanges, hasWorktreeRisk } from '../statusTypes';
import { BranchRow } from './branchRow';
import { DeploymentPanel } from './deploymentPanel';
import { WorktreeRow } from './worktreeRow';

export const ProjectSection = ({ project, query, filter, showMerged, showAllBranches, expanded, nowSeconds, busy, onRemove }: {
  project: ProjectStatus;
  query: string;
  filter: string;
  showMerged: boolean;
  showAllBranches: boolean;
  expanded: boolean;
  nowSeconds: number;
  busy: boolean;
  onRemove: (id: string) => void;
}) => {
  const [deployments, setDeployments] = useState<DeploymentEvidence[]>([]);
  const branches = project.git?.branches.filter((branch) => {
    if (!showAllBranches && !branch.worktreePath) return false;
    const worktree = project.git?.worktrees.find((item) => item.path === branch.worktreePath);
    const session = project.sessions.find((item) => item.worktreePath === branch.worktreePath);
    const hasActiveSession = Boolean(session?.evidence?.sessions.some((item) => item.active));
    if (!showMerged && branch.mergedIntoBase === true && !(worktree && (hasWorktreeRisk(project, worktree) || hasActiveSession))) return false;
    if (!`${branch.name} ${branch.worktreePath ?? ''}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'dirty') return Boolean(worktree && hasChanges(worktree));
    if (filter === 'commits') return branch.mergedIntoBase === false;
    if (filter === 'active') return hasActiveSession;
    return true;
  }).sort((left, right) => (right.latestCommitAt ?? 0) - (left.latestCommitAt ?? 0) || left.name.localeCompare(right.name));
  const path = project.git?.worktrees.find((item) => !item.scanError)?.path ?? project.config.path;
  const detached = project.git?.worktrees.filter((item) => !item.branch && `${item.path} ${item.head}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="project" aria-label={project.config.path}>
    <div className="projectHeading"><h2>{project.config.path.split('/').filter(Boolean).at(-1)}</h2><button disabled={busy} onClick={() => onRemove(project.config.id)}>移出</button></div>
    <p className="projectMeta">{project.git?.branchCount ?? '?'} 个本地分支 · {project.git?.worktrees.length ?? '?'} 个工作目录 · 基线 {project.config.baseBranch}</p>
    {project.error && <p className="error">{project.error}</p>}
    {branches?.map((branch) => <BranchRow key={branch.name} branch={branch} project={project} deployments={deployments} nowSeconds={nowSeconds} />)}
    {detached?.map((worktree) => <article className="branchRow" key={worktree.path}><div className="branchHeading"><h3>分离 HEAD</h3><span className="statusPill prominent">请确认工作分支</span></div><p className="commitLine"><code>{worktree.head.slice(0, 8)}</code> · {worktree.path}</p><div className="branchDetails"><WorktreeRow worktree={worktree} project={project} /></div></article>)}
    {branches?.length === 0 && detached?.length === 0 && <p className="empty">没有符合条件的分支。</p>}
    <DeploymentPanel path={path} onEvidence={setDeployments} autoCheck={expanded && project.config.baseBranch === 'PA-home-page'} />
  </section>;
};
