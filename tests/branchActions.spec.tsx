import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BranchActions, canSubmitPr } from '../src/components/branchActions';
import type { BranchSnapshot, ProjectStatus, WorktreeSnapshot } from '../src/statusTypes';

const branch: BranchSnapshot = {
  name: 'feature', head: 'a'.repeat(40), latestCommitAt: 100,
  latestCommitSubject: 'change', mergedIntoBase: false, isBase: false,
  worktreePath: '/repo/feature',
  people: { creator: null, contributors: [], scope: 'unique' },
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

test('only a merged branch without a checkout offers local deletion', () => {
  const merged = { ...branch, mergedIntoBase: true, worktreePath: null };
  const actions = renderToStaticMarkup(<BranchActions branch={merged} project={project} worktree={undefined} coding={false} onRefresh={async () => {}} />);
  expect(actions).toContain('删除本地分支');
  const checkedOut = renderToStaticMarkup(<BranchActions branch={{ ...merged, worktreePath: worktree.path }} project={project} worktree={worktree} coding={false} onRefresh={async () => {}} />);
  expect(checkedOut).not.toContain('删除本地分支');
});

test('PR submission remains available while optional branch analysis is loading', () => {
  expect(canSubmitPr({ previewReady: true, base: 'main', title: 'change', existingPr: false, adviceStatus: 'loading', adviceVerdict: null, proceedUnsuitable: false })).toBe(true);
  expect(canSubmitPr({ previewReady: true, base: 'main', title: 'change', existingPr: false, adviceStatus: 'ready', adviceVerdict: 'unsuitable', proceedUnsuitable: false })).toBe(false);
});
