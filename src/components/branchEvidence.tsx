import type { ProjectStatus, WorktreeSnapshot } from '../statusTypes';
import { WorktreeRow } from './worktreeRow';
import { PanelIcon } from './panelIcon';

export const BranchEvidence = ({ name, worktree, project }: { name: string; worktree: WorktreeSnapshot; project: ProjectStatus }) =>
  <details className="branchEvidence">
    <summary aria-label={`${name}的详细证据`} title="查看详细证据"><PanelIcon name="chevronDown" /></summary>
    <WorktreeRow worktree={worktree} project={project} />
  </details>;
