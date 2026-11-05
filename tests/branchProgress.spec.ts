import { expect, test } from 'bun:test';
import { getBranchProgress } from '../src/branchProgress';
import type { BranchSnapshot, DeploymentEvidence, WorktreeSnapshot } from '../src/statusTypes';

const branch: BranchSnapshot = { name: 'feature', head: 'a'.repeat(40), latestCommitAt: 1, latestCommitSubject: 'change', mergedIntoBase: false, isBase: false, worktreePath: '/repo' };
const worktree: WorktreeSnapshot = { path: '/repo', branch: 'feature', head: branch.head, dirty: { staged: 0, unstaged: 1, untracked: 0, lastChangedAt: 1 }, comparison: null, comparisonError: null, scanError: null };
const verified: DeploymentEvidence = { environment: 'staging', service: 'server', status: 'verified', runtimeSha: branch.head, deploymentSha: branch.head, deploymentUrl: null, runtimeSource: 'runtime', reason: null, observedAt: 1 };

test('feature branch needs a local commit and merge but release handles deployment', () => {
  expect(getBranchProgress(branch, worktree, [])[0].tone).toBe('attention');
  expect(getBranchProgress(branch, worktree, [])[1].tone).toBe('attention');
  expect(getBranchProgress(branch, worktree, [])[2]).toEqual({ name: '部署', detail: '由发布分支核对', tone: 'delegated' });
  expect(getBranchProgress({ ...branch, mergedIntoBase: true }, { ...worktree, dirty: { ...worktree.dirty, unstaged: 0 } }, [])[1].tone).toBe('done');
});

test('exact runtime SHA verifies deployment; unknown evidence never claims success', () => {
  expect(getBranchProgress(branch, worktree, [verified])[2].tone).toBe('done');
  const base = { ...branch, isBase: true, mergedIntoBase: true };
  expect(getBranchProgress(base, undefined, [])[2].tone).toBe('unknown');
  expect(getBranchProgress(base, undefined, [{ ...verified, runtimeSha: 'b'.repeat(40) }])[2].detail).toBe('当前提交未运行');
});
