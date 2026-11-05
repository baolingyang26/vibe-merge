import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectSection } from './components/projectSection';
import { PanelIcon } from './components/panelIcon';
import type { ProjectConfig, StatusSnapshot } from './statusTypes';
import { getDockSummary } from './statusTypes';

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
  const [showMerged, setShowMerged] = useState(true);
  const [showAllBranches, setShowAllBranches] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshingRef = useRef(false);
  const expandedRef = useRef(false);
  const requestedRef = useRef(false);
  const switchingRef = useRef(false);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const summary = getDockSummary(snapshot, nowSeconds);
  const selectedProjectId = snapshot?.projects.some((project) => project.config.id === activeProjectId)
    ? activeProjectId : snapshot?.projects[0]?.config.id;

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
      const added = await invoke<ProjectConfig>('add_project', { path: path.trim(), ...(baseBranch.trim() ? { baseBranch: baseBranch.trim() } : {}) });
      setActiveProjectId(added.id);
      setAddingProject(false);
      setPath('');
      setBaseBranch('');
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
      <header className="topbar">
        <div className="search"><PanelIcon name="search" /><input id="search" ref={searchRef} aria-label="搜索分支或路径" placeholder="搜索分支或路径" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          {query && <button className="iconButton" aria-label="清空搜索" title="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><PanelIcon name="close" /></button>}</div>
        <button className="iconButton" aria-label={lockedOpen ? '取消固定' : '固定展开'} title={lockedOpen ? '取消固定' : '固定展开'} aria-pressed={lockedOpen} onClick={() => setLockedOpen((value) => !value)}><PanelIcon name="pin" /></button>
        <button className={`iconButton ${busy ? 'isRefreshing' : ''}`} aria-label={busy ? '正在刷新' : '刷新'} title="刷新" disabled={busy} onClick={() => void handleRefresh()}><PanelIcon name="refresh" /></button>
      </header>
      <div className="projectTabBar"><div className="projectTabs" role="tablist" aria-label="项目">
        {snapshot?.projects.map((project, index, projects) => <button role="tab" id={`project-tab-${index}`} aria-selected={selectedProjectId === project.config.id} aria-controls={`project-panel-${index}`} tabIndex={selectedProjectId === project.config.id ? 0 : -1} key={project.config.id} title={project.config.path} onClick={() => setActiveProjectId(project.config.id)} onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % projects.length;
          else if (event.key === 'ArrowLeft') next = (index - 1 + projects.length) % projects.length;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = projects.length - 1;
          else return;
          event.preventDefault(); setActiveProjectId(projects[next]?.config.id ?? null); document.getElementById(`project-tab-${next}`)?.focus();
        }}>{project.config.path.split('/').filter(Boolean).at(-1)}</button>)}
      </div><button className="iconButton addTab" aria-label="添加项目" title="添加项目" aria-expanded={addingProject} aria-controls="add-project-form" onClick={() => setAddingProject((value) => !value)}><PanelIcon name="plus" /></button></div>
      {addingProject && <form id="add-project-form" className="addProjectForm" noValidate onSubmit={(event) => { event.preventDefault(); void handleAdd(); }}>
        <label htmlFor="projectPath">Git 项目绝对路径</label><input autoFocus id="projectPath" placeholder="/Users/you/projects/repo" value={path} onChange={(event) => setPath(event.currentTarget.value)} />
        <label htmlFor="baseBranch">比较基线（可选）</label><input id="baseBranch" placeholder="main" value={baseBranch} onChange={(event) => setBaseBranch(event.currentTarget.value)} />
        <div className="formActions"><button type="button" onClick={() => setAddingProject(false)}>取消</button><button disabled={busy} type="submit">添加项目</button></div>
      </form>}
      <section className="toolbar" aria-label="筛选分支">
        <div className="filters">{[['all', '全部'], ['dirty', '未提交'], ['commits', '未合并'], ['active', '活动会话']].map(([value, label]) =>
          <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value ?? 'all')}>{label}</button>)}</div>
      </section>
      <div className="listOptions"><label><input type="checkbox" checked={showAllBranches} onChange={(event) => setShowAllBranches(event.currentTarget.checked)} /> 显示未检出的本地分支</label>
        <label><input type="checkbox" checked={showMerged} onChange={(event) => setShowMerged(event.currentTarget.checked)} /> 显示已并入本地基线的分支</label></div>
      <div aria-live="polite">{error && <p className="error">当前证据可能已过期：{error}</p>}</div>
      {snapshot?.projects.map((project, index) => <div role="tabpanel" id={`project-panel-${index}`} aria-labelledby={`project-tab-${index}`} hidden={selectedProjectId !== project.config.id} key={project.config.id}><ProjectSection project={project} query={query} filter={filter} showMerged={showMerged} showAllBranches={showAllBranches} expanded={expanded && selectedProjectId === project.config.id}
        nowSeconds={nowSeconds} busy={busy} onRemove={(id) => { void handleRemove(id); }} /></div>)}
      {snapshot?.projects.length === 0 && <p className="empty">点击项目栏右侧的 ＋ 添加项目。</p>}
    </main>
  </div>;
};
