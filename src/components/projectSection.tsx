import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { DeploymentEvidence, GithubAvatar, ProjectStatus } from '../statusTypes';
import { hasChanges, hasWorktreeRisk } from '../statusTypes';
import { BranchRow } from './branchRow';
import { BranchEvidence } from './branchEvidence';
import { DeploymentPanel } from './deploymentPanel';

const avatarRequests = new Map<string, Promise<Record<string, GithubAvatar>>>();

export const ProjectSection = ({ project, query, filter, showMerged, showAllBranches, expanded, nowSeconds, onRefresh }: {
  project: ProjectStatus;
  query: string;
  filter: string;
  showMerged: boolean;
  showAllBranches: boolean;
  expanded: boolean;
  nowSeconds: number;
  onRefresh: () => Promise<void>;
}) => {
  const [deployments, setDeployments] = useState<DeploymentEvidence[]>([]);
  const [avatars, setAvatars] = useState<Record<string, GithubAvatar>>({});
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
  const sampleKey = [...new Set(branches?.flatMap((branch) => branch.people.contributors.filter((person) => !person.avatarUrl).map((person) => person.sampleSha).filter((sha): sha is string => Boolean(sha))) ?? [])].join(',');
  useEffect(() => {
    if (!expanded || !sampleKey) return;
    let mounted = true;
    const key = `${project.config.id}:${sampleKey}`;
    let request = avatarRequests.get(key);
    if (!request) {
      if (avatarRequests.size > 30) avatarRequests.clear();
      request = invoke<Record<string, GithubAvatar>>('resolve_github_avatars', { projectId: project.config.id, samples: sampleKey.split(',') });
      avatarRequests.set(key, request);
    }
    void request.then((result) => { if (mounted) setAvatars(result); }, () => { avatarRequests.delete(key); if (mounted) setAvatars({}); });
    return () => { mounted = false; };
  }, [expanded, project.config.id, sampleKey]);
  const avatarsByEmail: Record<string, GithubAvatar> = {};
  for (const branch of project.git?.branches ?? []) {
    for (const person of branch.people.contributors) {
      const avatar = person.sampleSha ? avatars[person.sampleSha] : undefined;
      if (avatar) avatarsByEmail[person.email.toLowerCase()] = avatar;
    }
  }
  const path = project.git?.worktrees.find((item) => !item.scanError)?.path ?? project.config.path;
  const detached = project.git?.worktrees.filter((item) => !item.branch && `${item.path} ${item.head}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="project" aria-label={project.config.path}>
    <p className="projectMeta">{project.git?.branchCount ?? '?'} 个本地分支 · {project.git?.worktrees.length ?? '?'} 个工作目录 · 基线 {project.config.baseBranch}</p>
    {project.error && <p className="error">{project.error}</p>}
    {branches?.map((branch) => <BranchRow key={branch.name} branch={branch} project={project} deployments={deployments} avatars={avatars} avatarsByEmail={avatarsByEmail} nowSeconds={nowSeconds} onRefresh={onRefresh} />)}
    {detached?.map((worktree) => <article className="branchRow" key={worktree.path}><div className="branchHeading"><h3>分离 HEAD</h3></div><p className="commitLine"><code>{worktree.head.slice(0, 8)}</code> · {worktree.path}</p><BranchEvidence name="分离 HEAD" worktree={worktree} project={project} /></article>)}
    {branches?.length === 0 && detached?.length === 0 && <p className="empty">没有符合条件的分支。</p>}
    <DeploymentPanel path={path} onEvidence={setDeployments} autoCheck={expanded && project.config.baseBranch === 'PA-home-page'} />
  </section>;
};
