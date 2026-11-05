import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectSection } from './components/projectSection';
import type { StatusSnapshot } from './statusTypes';
import { evidenceTime, getDockSummary } from './statusTypes';

export const App = () => {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [lockedOpen, setLockedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [path, setPath] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [showMerged, setShowMerged] = useState(false);
  const [showAllBranches, setShowAllBranches] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshingRef = useRef(false);
  const expandedRef = useRef(false);
  const requestedRef = useRef(false);
  const switchingRef = useRef(false);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const summary = getDockSummary(snapshot, nowSeconds);

  const requestExpansion = useCallback(async (next: boolean) => {
    requestedRef.current = next;
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      while (expandedRef.current !== requestedRef.current) {
        const target = requestedRef.current;
        await invoke<boolean>('set_dock_expanded', { expanded: target });
        expandedRef.current = target;
        setExpanded(target);
      }
    } catch (cause) {
      setError(`无法调整侧栏：${String(cause)}`);
    } finally {
      switchingRef.current = false;
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setBusy(true);
    setError('');
    try { setSnapshot(await invoke<StatusSnapshot>('scan_status')); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); refreshingRef.current = false; }
  }, []);
  useEffect(() => {
    void handleRefresh();
    const timer = window.setInterval(() => { void handleRefresh(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [handleRefresh]);

  const handleAdd = async () => {
    if (!path.trim()) { setError('请输入 Git 项目的绝对路径。'); return; }
    setBusy(true); setError('');
    try {
      await invoke('add_project', { path: path.trim(), ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}) });
      setPath('');
      await handleRefresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const handleRemove = async (id: string) => {
    setBusy(true); setError('');
    try { await invoke('remove_project', { id }); await handleRefresh(); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };

  return <div className={`dock ${expanded ? 'isExpanded' : 'isCollapsed'}`}
    onMouseEnter={() => { void requestExpansion(true); }}
    onMouseLeave={() => { if (!lockedOpen) void requestExpansion(false); }}>
    {!expanded && <button className="rail" aria-label={`展开代码工作台。风险目录 ${summary.risk ?? '未知'}，正在编写 ${summary.coding ?? '未知'}，已并入本地基线 ${summary.merged ?? '未知'}`} onClick={() => { void requestExpansion(true); }} onFocus={() => { void requestExpansion(true); }}>
      <span className="railHandle" aria-hidden="true">‹</span>
      <span className="railMetric" title="未提交或扫描异常的工作目录"><strong>{summary.risk ?? '–'}</strong><small>风险</small></span>
      <span className="railMetric" title="活动 Codex 会话与近期文件改动同时存在"><strong>{summary.coding ?? '–'}</strong><small>编写</small></span>
      <span className="railMetric" title="已并入本地基线的分支"><strong>{summary.merged ?? '–'}</strong><small>已合并</small></span>
    </button>}
    <main hidden={!expanded}>
      <header><div><h1>代码工作台</h1><p className="headerSubtitle">本机分支状态</p></div>
        <button aria-pressed={lockedOpen} onClick={() => setLockedOpen((value) => !value)}>{lockedOpen ? '取消固定' : '固定展开'}</button>
        <button disabled={busy} onClick={() => void handleRefresh()}>{busy ? '读取中…' : '刷新'}</button>
      </header>
      <div className="overview" aria-label="状态概览">
        <div><strong>{summary.risk ?? '–'}</strong><span>风险目录</span></div>
        <div><strong>{summary.coding ?? '–'}</strong><span>正在编写</span></div>
        <div><strong>{summary.merged ?? '–'}</strong><span>已合并分支</span></div>
      </div>
      <section className="toolbar" aria-label="筛选分支">
        <label htmlFor="search">搜索分支或路径</label>
        <div className="search"><input id="search" ref={searchRef} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          {query && <button aria-label="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}>清空</button>}</div>
        <div className="filters">{[['all', '全部'], ['dirty', '未提交'], ['commits', '未合并'], ['active', '活动会话']].map(([value, label]) =>
          <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value ?? 'all')}>{label}</button>)}</div>
      </section>
      <div className="listOptions"><label><input type="checkbox" checked={showAllBranches} onChange={(event) => setShowAllBranches(event.currentTarget.checked)} /> 显示未检出的本地分支</label>
        <label><input type="checkbox" checked={showMerged} onChange={(event) => setShowMerged(event.currentTarget.checked)} /> 显示已并入本地基线的分支</label></div>
      <div aria-live="polite">{error && <p className="error">当前证据可能已过期：{error}</p>}</div>
      {snapshot && <p className="timestamp">本机扫描 {evidenceTime(snapshot.observedAt)} · {snapshot.projects.length} 个项目</p>}
      {snapshot?.projects.map((project) => <ProjectSection key={project.config.id} project={project} query={query} filter={filter} showMerged={showMerged} showAllBranches={showAllBranches} expanded={expanded}
        nowSeconds={nowSeconds} busy={busy} onRemove={(id) => { void handleRemove(id); }} />)}
      {snapshot?.projects.length === 0 && <p className="empty">添加一个 Git 项目，开始查看分支。</p>}
      <details className="addProject"><summary>添加项目</summary><form noValidate onSubmit={(event) => { event.preventDefault(); void handleAdd(); }}>
        <label htmlFor="projectPath">Git 项目绝对路径</label><input id="projectPath" placeholder="/Users/you/projects/repo" value={path} onChange={(event) => setPath(event.currentTarget.value)} />
        <label htmlFor="baseBranch">比较基线（可选）</label><input id="baseBranch" placeholder="main" value={baseBranch} onChange={(event) => setBaseBranch(event.currentTarget.value)} />
        <button disabled={busy} type="submit">添加项目</button>
      </form></details>
    </main>
  </div>;
};
