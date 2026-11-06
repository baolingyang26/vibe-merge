import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BranchActions, canSubmitPr } from '../src/components/branchActions';
import type { BranchSnapshot, ProjectStatus, WorktreeSnapshot } from '../src/statusTypes';

const branch: BranchSnapshot = {
  name: 'feature', head: 'a'.repeat(40), latestCommitAt: 100,
  latestCommitSubject: 'change', mergedIntoBase: false, mergedIntoBranches: [], mergeProgress: { merged: 0, total: 1, equivalent: 0 }, isBase: false,
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
  const merged = { ...branch, mergedIntoBase: true, mergedIntoBranches: ['main'], worktreePath: null };
  const actions = renderToStaticMarkup(<BranchActions branch={merged} project={project} worktree={undefined} coding={false} onRefresh={async () => {}} />);
  expect(actions).toContain('删除本地分支');
  const checkedOut = renderToStaticMarkup(<BranchActions branch={{ ...merged, worktreePath: worktree.path }} project={project} worktree={worktree} coding={false} onRefresh={async () => {}} />);
  expect(checkedOut).not.toContain('删除本地分支');
});

test('PR submission remains available while optional branch analysis is loading', () => {
  expect(canSubmitPr({ previewReady: true, base: 'main', title: 'change', existingPr: false, adviceStatus: 'loading', adviceVerdict: null, proceedUnsuitable: false })).toBe(true);
  expect(canSubmitPr({ previewReady: true, base: 'main', title: 'change', existingPr: false, adviceStatus: 'ready', adviceVerdict: 'unsuitable', proceedUnsuitable: false })).toBe(false);
});

test('places branch analysis in the same action row as PR creation', () => {
  const actions = renderToStaticMarkup(<BranchActions branch={branch} project={project} worktree={undefined} coding={false} onRefresh={async () => {}} analysisAction={<button className="showAdvice" type="button">分析此分支</button>} />);
  expect(actions).not.toContain('未并入');
  expect(actions).not.toContain('mergeTargetStatus');
  expect(actions).toMatch(/class="branchActionButtons"[^>]*><button class="showAdvice"[^>]*>分析此分支<\/button><button[^>]*>创建 PR<\/button>/);
});

test('shows the base branch target when merged, including without action buttons', () => {
  const merged = { ...branch, mergedIntoBase: true, mergedIntoBranches: ['main'], worktreePath: worktree.path };
  const actions = renderToStaticMarkup(<BranchActions branch={merged} project={project} worktree={worktree} coding={false} onRefresh={async () => {}} />);
  expect(actions).toContain('已并入 main');
  expect(actions).not.toContain('创建 PR');
});

test('shows the containing branch even when the configured base does not contain it', () => {
  const inOtherBranch = { ...branch, mergedIntoBranches: ['integration'] };
  const actions = renderToStaticMarkup(<BranchActions branch={inOtherBranch} project={project} worktree={undefined} coding={false} onRefresh={async () => {}} />);
  expect(actions).toContain('已并入 integration');
  expect(actions).not.toContain('未并入 main');
});
