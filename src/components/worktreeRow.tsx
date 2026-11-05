import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import type { GithubEvidence, ProjectStatus, WorktreeSnapshot } from '../statusTypes';
import { evidenceTime, isActiveDevelopment } from '../statusTypes';
export const WorktreeRow = ({ worktree, project }: { worktree: WorktreeSnapshot; project: ProjectStatus }) => {
  const [github, setGithub] = useState<GithubEvidence | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setGithub(null); setError(''); }, [worktree.head, worktree.branch]);
  const checkLabels = { passed: '检查通过', failed: '检查失败', pending: '进行中', none: '无检查记录', unknown: '无法确认' };
  const session = project.sessions.find((item) => item.worktreePath === worktree.path);
  const developing = isActiveDevelopment(worktree, session?.evidence, Math.floor(Date.now() / 1000));
  const handleOpenChat = async (sessionId: string) => {
    try { await invoke('open_chat', { sessionId }); }
    catch (error) { setError(`无法打开聊天：${String(error)}`); }
  };
  const handleOpenDirectory = async () => {
    try { await invoke('open_worktree', { path: worktree.path }); }
    catch (error) { setError(`无法打开目录：${String(error)}`); }
  };
  const handleGithub = async () => {
    setBusy(true); setError(''); setGithub(null);
    try { setGithub(await invoke<GithubEvidence>('load_github_evidence', { path: worktree.path, branch: worktree.branch, headSha: worktree.head, targetBase: project.config.baseBranch })); }
    catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <article className="worktree"><details><summary><span className="branch">{worktree.branch ?? '分离 HEAD'}</span><code>{worktree.head.slice(0, 8)}</code><span className="rowHint">展开依据</span></summary>
    <p className="path">{worktree.path}</p><button onClick={handleOpenDirectory}>打开目录</button>
    <div className="dimensions"><span>暂存 <b>{worktree.scanError ? '?' : worktree.dirty.staged}</b></span><span>未暂存 <b>{worktree.scanError ? '?' : worktree.dirty.unstaged}</b></span><span>未跟踪 <b>{worktree.scanError ? '?' : worktree.dirty.untracked}</b></span></div>
    <p>提交 · {worktree.comparison ? `领先 ${worktree.comparison.ahead} / 落后 ${worktree.comparison.behind}` : '无法确认'} · 本地基线 {project.config.baseBranch}</p>
    {worktree.comparison?.uniqueCommits.map((commit) => <p key={commit.sha}><code>{commit.sha.slice(0, 7)}</code> {commit.subject}</p>)}
    <p>会话 · {session?.evidence ? `${session.evidence.sessions.filter((item) => item.active).length} 个活动 / ${session.evidence.sessions.length} 个已关联` : '未获得证据'}{developing ? ' · 正在开发（会话与近期文件改动）' : ''}</p>
    {worktree.dirty.lastChangedAt !== null && <p>最近文件改动 · {evidenceTime(worktree.dirty.lastChangedAt)}</p>}
    {session?.evidence?.sharedWorktreeWarning && <p className="warning">多个活动会话共用此目录，请核对任务。</p>}
    {session?.evidence?.sessions.map((item) => <p key={item.sessionId}><code>{item.sessionId}</code> · <button onClick={() => void handleOpenChat(item.sessionId)}>打开聊天</button> · {evidenceTime(item.lastSeen)}</p>)}
    <button disabled={busy || !worktree.branch} onClick={handleGithub}>{busy ? '正在查询…' : '查询 PR / CI'}</button>
    <p>PR · {github ? github.status : '未查询'}{github?.reason ? ` · ${github.reason}` : ''}</p>
    {github?.pullRequests.map((pr) => <p key={pr.number}><a href={pr.url} rel="noreferrer" target="_blank">#{pr.number} · {pr.state}{pr.isDraft ? ' · 草稿' : ''}</a>{pr.headRefOid !== worktree.head && <strong> · PR 指向另一提交</strong>} → {pr.baseRefName}</p>)}
    <p>CI · {github?.status === 'observed' ? checkLabels[github.checksState] : '无法确认'}</p>
    {github?.status === 'observed' && github.checks.map((check, index) => <p key={`${check.name}/${index}`}>{check.url ? <a href={check.url} rel="noreferrer" target="_blank">{check.name}</a> : check.name} · {checkLabels[check.state]} · {check.source}</p>)}
    {github && <small>GitHub 取证：{evidenceTime(github.observedAt)} · {github.headSha.slice(0, 8)}</small>}
    {[worktree.scanError, worktree.comparisonError, session?.error, error].filter(Boolean).map((message) => <p className="error" key={message}>{message}</p>)}
  </details><div className="quickStatus"><span>改动 {worktree.scanError ? '无法确认' : worktree.dirty.staged + worktree.dirty.unstaged + worktree.dirty.untracked}</span><span>独有提交 {worktree.comparison?.ahead ?? '?'}</span></div></article>;
};
