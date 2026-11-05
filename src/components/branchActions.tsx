import { invoke } from '@tauri-apps/api/core';
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { BranchSnapshot, ChangedFile, CommitPreview, CommitPushResult, PrPreview, PrResult, ProjectStatus, WorktreeSnapshot } from '../statusTypes';
import { hasChanges } from '../statusTypes';

const fileStatus = (file: ChangedFile) => {
  if (file.status === '??') return '未跟踪';
  if (file.status.includes('R')) return '重命名';
  if (file.status.includes('D')) return '删除';
  if (file.status.includes('A')) return '新增';
  return '修改';
};

export const BranchActions = ({ branch, project, worktree, coding, onRefresh }: {
  branch: BranchSnapshot;
  project: ProjectStatus;
  worktree: WorktreeSnapshot | undefined;
  coding: boolean;
  onRefresh: () => Promise<void>;
}) => {
  const id = useId();
  const [mode, setMode] = useState<'commit' | 'pr' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commitPreview, setCommitPreview] = useState<CommitPreview | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [commitResult, setCommitResult] = useState<CommitPushResult | null>(null);
  const [retryHead, setRetryHead] = useState<string | null>(null);
  const [prPreview, setPrPreview] = useState<PrPreview | null>(null);
  const [base, setBase] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [prResult, setPrResult] = useState<PrResult | null>(null);
  const dirty = Boolean(worktree && hasChanges(worktree));
  const canCommit = Boolean(worktree && dirty && !worktree.scanError && !branch.isBase && !coding);
  const canPr = !branch.isBase && branch.mergedIntoBase !== true && !dirty && !worktree?.scanError && !coding;
  const existingPr = prPreview?.existing.find((pr) => pr.baseRefName === base);

  const handleOpenCommit = async () => {
    if (!worktree) return;
    setMode('commit'); setCommitPreview(null); setError(''); setBusy(true);
    try {
      const preview = await invoke<CommitPreview>('prepare_commit', { path: worktree.path, branch: branch.name, headSha: branch.head });
      setCommitPreview(preview);
      setSelectedPaths(preview.files.map((file) => file.path));
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const handleOpenPr = async () => {
    setMode('pr'); setPrPreview(null); setError(''); setBusy(true);
    try {
      const preview = await invoke<PrPreview>('prepare_pr', { projectId: project.config.id, branch: branch.name, headSha: branch.head });
      setPrPreview(preview);
      setBase('');
      setTitle(branch.latestCommitSubject || branch.name);
      setBody('');
      setDraft(false);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const handleCommit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!worktree || !commitPreview || selectedPaths.length === 0 || !message.trim()) return;
    setBusy(true); setError('');
    try {
      const result = await invoke<CommitPushResult>('commit_and_push', {
        path: worktree.path, branch: branch.name, headSha: commitPreview.headSha,
        expectedStatusToken: commitPreview.statusToken, selectedPaths, message: message.trim(),
      });
      setCommitResult(result);
      setRetryHead(result.pushed ? null : result.commitSha);
      setMode(null);
      setCommitPreview(null);
      setMessage('');
      await onRefresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const handleRetryPush = async () => {
    if (!worktree || !retryHead) return;
    setBusy(true); setError('');
    try {
      await invoke<string>('push_branch', { path: worktree.path, branch: branch.name, headSha: retryHead });
      setCommitResult({ commitSha: retryHead, pushed: true, pushError: null });
      setRetryHead(null);
      await onRefresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  const handleCreatePr = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prPreview || !base || (!existingPr && !title.trim())) return;
    setBusy(true); setError('');
    try {
      const result = await invoke<PrResult>('create_pr', {
        projectId: project.config.id, branch: branch.name, headSha: prPreview.headSha,
        base, title: existingPr ? (title.trim() || branch.latestCommitSubject || branch.name) : title.trim(), body, draft,
      });
      setPrResult(result);
      setMode(null);
      await onRefresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  if (!canCommit && !canPr && !commitResult && !prResult && mode === null) return null;
  return <div className="branchActions">
    {mode === null && (canCommit || canPr) && <div className="branchActionButtons">
      {canCommit && <button type="button" disabled={busy} onClick={() => void handleOpenCommit()}>Commit / Push</button>}
      {canPr && <button type="button" disabled={busy} onClick={() => void handleOpenPr()}>创建 PR</button>}
    </div>}
    {commitResult && <div className="workflowResult" role="status">
      <span>已提交 <code>{commitResult.commitSha.slice(0, 8)}</code>{commitResult.pushed ? ' · 已推送' : ' · 推送未完成'}</span>
      {retryHead && <button type="button" disabled={busy} onClick={() => void handleRetryPush()}>重试推送</button>}
      {commitResult.pushError && <small>{commitResult.pushError}</small>}
    </div>}
    {prResult && <div className="workflowResult" role="status"><span>{prResult.existing ? '已有 PR' : '已创建 PR'}</span><a href={prResult.url} rel="noreferrer" target="_blank">打开 PR</a></div>}
    {mode === 'commit' && <form className="workflowForm" noValidate onSubmit={(event) => void handleCommit(event)}>
      <h4>提交并推送 · {branch.name}</h4>
      {commitPreview && <>
        <p>勾选本次提交的文件。提交前若改动发生变化，需要重新检查。</p>
        <div className="workflowFiles" role="group" aria-label="选择提交文件">
          {commitPreview.files.map((file) => <label className="workflowFile" key={file.path}>
            <input type="checkbox" checked={selectedPaths.includes(file.path)} onChange={(event) => { const checked = event.currentTarget.checked; setSelectedPaths((paths) => checked ? [...paths, file.path] : paths.filter((path) => path !== file.path)); }} />
            <span>{fileStatus(file)}</span><code title={file.path}>{file.previousPath ? `${file.previousPath} → ` : ''}{file.path}</code>
          </label>)}
        </div>
        <label htmlFor={`${id}-message`}>提交说明</label>
        <input id={`${id}-message`} value={message} maxLength={2000} required placeholder="简述这次改动" onChange={(event) => setMessage(event.currentTarget.value)} />
      </>}
      <div className="workflowFooter"><button type="button" disabled={busy} onClick={() => { setMode(null); setError(''); }}>取消</button><button type="submit" disabled={busy || coding || !commitPreview || selectedPaths.length === 0 || !message.trim()}>{busy ? '处理中…' : '提交并推送'}</button></div>
    </form>}
    {mode === 'pr' && <form className="workflowForm" noValidate onSubmit={(event) => void handleCreatePr(event)}>
      <h4>创建 PR · {branch.name}</h4>
      {prPreview && <>
        <p>仓库 · {prPreview.repository}</p>
        <label htmlFor={`${id}-base`}>目标分支</label>
        <select id={`${id}-base`} value={base} required onChange={(event) => setBase(event.currentTarget.value)}><option value="">选择目标分支</option>{prPreview.targets.map((target) => <option key={target} value={target}>{target}</option>)}</select>
        {existingPr && <p className="workflowNote">这个目标分支已有 PR #{existingPr.number}。继续只会推送当前提交，不修改原有标题或描述。</p>}
        {prPreview.needsPush && <p className="workflowNote">本地提交尚未同步到 origin。继续前会先推送当前分支，不会强制覆盖远端。</p>}
        {!existingPr && <><label htmlFor={`${id}-title`}>PR 标题</label><input id={`${id}-title`} value={title} maxLength={256} required onChange={(event) => setTitle(event.currentTarget.value)} />
          <label htmlFor={`${id}-body`}>描述（可选）</label><textarea className="resize-none" id={`${id}-body`} value={body} maxLength={20000} rows={4} onChange={(event) => setBody(event.currentTarget.value)} />
          <label className="workflowDraft"><input type="checkbox" checked={draft} onChange={(event) => setDraft(event.currentTarget.checked)} /> 先创建为草稿</label></>}
      </>}
      <div className="workflowFooter"><button type="button" disabled={busy} onClick={() => { setMode(null); setError(''); }}>取消</button><button type="submit" disabled={busy || coding || !prPreview || !base || (!existingPr && !title.trim())}>{busy ? '处理中…' : existingPr ? (prPreview?.needsPush ? '推送并打开 PR' : '打开已有 PR') : prPreview?.needsPush ? '推送并创建 PR' : '创建 PR'}</button></div>
    </form>}
    {error && <p className="workflowError" role="alert">{error}</p>}
  </div>;
};
