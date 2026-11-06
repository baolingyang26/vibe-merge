import { useState } from 'react';
import type { BranchSnapshot, DeploymentEvidence, GithubAvatar, ProjectStatus } from '../statusTypes';
import { evidenceTime, isActiveDevelopment, relativeTime } from '../statusTypes';
import { BranchEvidence } from './branchEvidence';
import { BranchProgress } from './branchProgress';
import { getBranchProgress } from '../branchProgress';
import { PanelIcon } from './panelIcon';
import { BranchActions } from './branchActions';
import { useBranchAdvice } from '../branchAdvice';
import { BranchAdviceView } from './branchAdvice';
import { BranchPeople } from './branchPeople';

export const BranchRow = ({ branch, project, deployments, avatars, avatarsByEmail, nowSeconds, onRefresh }: {
  branch: BranchSnapshot;
  project: ProjectStatus;
  deployments: DeploymentEvidence[];
  avatars: Record<string, GithubAvatar>;
  avatarsByEmail: Record<string, GithubAvatar>;
  nowSeconds: number;
  onRefresh: () => Promise<void>;
}) => {
  const [requestedHead, setRequestedHead] = useState('');
  const worktree = project.git?.worktrees.find((item) => item.path === branch.worktreePath);
  const session = project.sessions.find((item) => item.worktreePath === branch.worktreePath);
  const coding = worktree ? isActiveDevelopment(worktree, session?.evidence, nowSeconds) : false;
  const progress = getBranchProgress(branch, worktree, deployments);
  const analysisRequested = requestedHead === branch.head;
  const advice = useBranchAdvice(project.config.id, branch.name, branch.head, project.config.baseBranch, analysisRequested && !branch.isBase);
  return <article className="branchRow">
    <div className="branchHeading"><span className="branchSymbol"><PanelIcon name="branch" /></span><div className="branchTitle"><h3>{branch.name}</h3>{coding && <span className="codingSignal" role="img" aria-label="正在写代码" title="正在写代码" />}<BranchPeople people={branch.people} avatars={avatars} avatarsByEmail={avatarsByEmail} /></div></div>
    <p className="commitLine" title={branch.latestCommitAt === null ? undefined : evidenceTime(branch.latestCommitAt)}>
      <code>{branch.head.slice(0, 8)}</code> · 最近提交 {relativeTime(branch.latestCommitAt, nowSeconds)}
    </p>
    <p className="commitSubject">{branch.latestCommitSubject || '提交内容未知'}</p>
    <BranchProgress stages={progress} />
    {branch.isBase && <section className="branchAdvice isCompact" aria-label="分支提示"><div className="adviceHeading">分支提示</div><p>当前是项目基线分支，无需向自身创建 PR。</p></section>}
    <BranchActions branch={branch} project={project} worktree={worktree} coding={coding} onRefresh={onRefresh} analysisAction={!branch.isBase && !analysisRequested ? <button className="showAdvice" type="button" onClick={() => setRequestedHead(branch.head)}>分析此分支</button> : null} />
    {!branch.isBase && analysisRequested && <BranchAdviceView branchHead={branch.head} target={project.config.baseBranch} {...advice} />}
    {worktree && <BranchEvidence name={branch.name} worktree={worktree} project={project} />}
  </article>;
};
