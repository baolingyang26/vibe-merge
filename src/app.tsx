import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeploymentPanel } from './components/deploymentPanel';
import { WorktreeRow } from './components/worktreeRow';
import type { StatusSnapshot } from './statusTypes';
import { evidenceTime, hasChanges } from './statusTypes';
export const App = () => {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [pinBusy, setPinBusy] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showMerged, setShowMerged] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshingRef = useRef(false);
  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setBusy(true); setError('');
    try { setSnapshot(await invoke<StatusSnapshot>('scan_status')); }
    catch (error) { setError(String(error)); } finally { setBusy(false); refreshingRef.current = false; }
  }, []);
  useEffect(() => {
    void handleRefresh();
    const timer = window.setInterval(() => { void handleRefresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [handleRefresh]);
  const handlePin = async () => {
    setPinBusy(true);
    try { setPinned(await invoke<boolean>('set_panel_pinned', { pinned: !pinned })); }
    catch (error) { setError(`无法更改固定状态：${String(error)}`); } finally { setPinBusy(false); }
  };
  const handleAdd = async () => {
    if (!path.trim()) { setError('请输入 Git 项目的绝对路径。'); return; }
    setBusy(true); setError('');
    try { await invoke('add_project', { path: path.trim(), ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}) }); setPath(''); await handleRefresh(); }
    catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  const handleRemove = async (id: string) => {
    setBusy(true); setError('');
    try { await invoke('remove_project', { id }); await handleRefresh(); }
    catch (error) { setError(String(error)); } finally { setBusy(false); }
  };
  return <main><header><div><span className="eyebrow">LOCAL / GIT EVIDENCE</span><h1>代码工作台</h1></div><button aria-pressed={pinned} disabled={pinBusy} onClick={handlePin}>{pinned ? '取消固定' : '固定浮窗'}</button><button disabled={busy} onClick={handleRefresh}>{busy ? '读取中…' : '刷新'}</button></header>
    <p className="intro">每个目录的进展，都有据可查。</p>
    <section className="toolbar" aria-label="筛选工作目录"><label htmlFor="search">搜索分支或路径</label><div className="search"><input id="search" ref={searchRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />{query && <button aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>清空</button>}</div><div className="filters">{[['all', '全部'], ['dirty', '未提交'], ['commits', '有独有提交'], ['active', '活动会话']].map(([value, label]) => <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value ?? 'all')}>{label}</button>)}</div></section>
    <label><input type="checkbox" checked={showMerged} onChange={(event) => setShowMerged(event.currentTarget.checked)} /> 显示已并入本地基线的工作目录</label><div aria-live="polite">{error && <p className="error">无法更新，当前证据可能已过期：{error}</p>}</div>
    {snapshot && <p className="timestamp">本机扫描 {evidenceTime(snapshot.observedAt)} · {snapshot.projects.length} 个项目</p>}
    {snapshot?.projects.map((project) => {
      const rows = project.git?.worktrees.filter((item) => (showMerged || item.scanError !== null || hasChanges(item) || project.sessions.some((session) => session.worktreePath === item.path && session.evidence?.sessions.some((entry) => entry.active)) || item.comparison === null || item.comparison.ahead > 0) && `${item.branch ?? ''} ${item.path}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'dirty' && hasChanges(item) || filter === 'commits' && (item.comparison?.ahead ?? 0) > 0 || filter === 'active' && project.sessions.some((session) => session.worktreePath === item.path && session.evidence?.sessions.some((entry) => entry.active))));
      return <section className="project" key={project.config.id}><div className="projectHeading"><h2>{project.config.path.split('/').filter(Boolean).at(-1)}</h2><button disabled={busy} onClick={() => void handleRemove(project.config.id)}>移出列表</button></div><p className="path">{project.config.path}</p><small>{project.git?.branchCount ?? '?'} 个分支 · 基线 {project.config.baseBranch}</small>{project.error && <p className="error">{project.error}</p>}{rows?.map((worktree) => <WorktreeRow key={worktree.path} project={project} worktree={worktree} />)}<DeploymentPanel key={project.git?.worktrees[0]?.path ?? project.config.path} path={project.git?.worktrees[0]?.path ?? project.config.path} />{rows?.length === 0 && <p className="empty">没有符合筛选条件的工作目录。</p>}</section>;
    })}
    {snapshot?.projects.length === 0 && <p className="empty">添加一个 Git 项目，开始查看本机工作目录。</p>}
    <details className="addProject"><summary>＋ 添加项目</summary><form noValidate onSubmit={(event) => { event.preventDefault(); void handleAdd(); }}><label htmlFor="projectPath">Git 项目绝对路径</label><input id="projectPath" placeholder="/Users/you/projects/repo" value={path} onChange={(event) => setPath(event.currentTarget.value)} /><label htmlFor="baseBranch">比较基线（可选）</label><input id="baseBranch" placeholder="main" value={baseBranch} onChange={(event) => setBaseBranch(event.currentTarget.value)} /><button disabled={busy} type="submit">添加项目</button></form></details><footer>只读观察代码 · 移出列表不会删除本地文件</footer></main>;
};
