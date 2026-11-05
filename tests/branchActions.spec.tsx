import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BranchActions } from '../src/components/branchActions';
import type { BranchSnapshot, ProjectStatus, WorktreeSnapshot } from '../src/statusTypes';

const branch: BranchSnapshot = {
  name: 'feature', head: 'a'.repeat(40), latestCommitAt: 100,
  latestCommitSubject: 'change', mergedIntoBase: false, isBase: false,
  worktreePath: '/repo/feature',
};
const project: ProjectStatus = {
  config: { id: 'repo', path: '/repo', baseBranch: 'main' },
  git: null, error: null, sessions: [],
};
const worktree: WorktreeSnapshot = {
  path: '/repo/feature', branch: 'feature', head: branch.head,
  dirty: { staged: 0, unstaged: 0, untracked: 1, lastChangedAt: 100 },
  comparison: null, comparisonError: null, scanError: null,
};

const renderActions = (dirty: WorktreeSnapshot['dirty']) => renderToStaticMarkup(
  <BranchActions branch={branch} project={project} worktree={{ ...worktree, dirty }} coding={false} onRefresh={async () => {}} />,
);

test('untracked files alone do not show Commit / Push', () => {
  expect(renderActions(worktree.dirty)).not.toContain('Commit / Push');
});

test('tracked changes still show Commit / Push when untracked files are present', () => {
  expect(renderActions({ ...worktree.dirty, unstaged: 1 })).toContain('Commit / Push');
});
