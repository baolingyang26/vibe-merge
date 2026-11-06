import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProjectSection } from './components/projectSection';
import { PanelIcon } from './components/panelIcon';
import type { ProjectConfig, StatusSnapshot } from './statusTypes';
import { getDockSummary } from './statusTypes';
import tellynLogo from './assets/tellynLogo.svg';

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
  const [contextMenu, setContextMenu] = useState<{ id: string; left: number; top: number } | null>(null);
  const previousProjectRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshingRef = useRef(false);
  const expandedRef = useRef(false);
  const requestedRef = useRef(false);
  const switchingRef = useRef(false);
  const collapseTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current); }, []);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const summary = getDockSummary(snapshot, nowSeconds);
  const selectedProjectId = addingProject && activeProjectId === 'new-project' ? 'new-project'
    : snapshot?.projects.some((project) => project.config.id === activeProjectId)
      ? activeProjectId : snapshot?.projects[0]?.config.id;
  const tabCount = (snapshot?.projects.length ?? 0) + (addingProject ? 1 : 0);
  const selectTab = (index: number) => {
    const id = index === snapshot?.projects.length ? 'new-project' : snapshot?.projects[index]?.config.id;
    if (id) { setActiveProjectId(id); document.getElementById(`project-tab-${index}`)?.focus(); }
  };
  useEffect(() => {
    if (!contextMenu) return;
    const handleDismiss = () => setContextMenu(null);
    document.addEventListener('pointerdown', handleDismiss);
    window.addEventListener('blur', handleDismiss);
    return () => {
      document.removeEventListener('pointerdown', handleDismiss);
      window.removeEventListener('blur', handleDismiss);
    };
  }, [contextMenu]);

  const requestExpansion = useCallback(async (next: boolean) => {
    requestedRef.current = next;
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      while (expandedRef.current !== requestedRef.current) {
        const target = requestedRef.current;
        setExpanded(target);
        await invoke<boolean>('set_dock_expanded', { expanded: target, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches });
        expandedRef.current = target;
      }
    } catch (cause) {
      setExpanded(expandedRef.current);
      setError(`无法调整侧栏：${String(cause)}`);
    } finally {
      switchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('open-dock', () => {
      if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
      void requestExpansion(true);
    }).then((stop) => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, [requestExpansion]);

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
      await handleRefresh();
      setActiveProjectId(added.id);
      setAddingProject(false);
      setPath('');
      setBaseBranch('');
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
    onMouseEnter={() => { if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; void requestExpansion(true); }}
    onMouseLeave={(event) => {
      if (lockedOpen) return;
      if (event.clientX > 0 && event.clientX < window.innerWidth && event.clientY > 0 && event.clientY < window.innerHeight) return;
      if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = window.setTimeout(() => { collapseTimerRef.current = null; void requestExpansion(false); }, 140);
    }}>
    <button className="rail" aria-hidden={expanded} tabIndex={expanded ? -1 : 0} aria-label={`展开代码工作台。风险目录 ${summary.risk ?? '未知'}，正在编写 ${summary.coding ?? '未知'}，已并入本地基线 ${summary.merged ?? '未知'}`} onClick={() => { void requestExpansion(true); }} onFocus={() => { void requestExpansion(true); }}>
      <span className="railHandle" aria-hidden="true">‹</span>
      <span className="railMetric" title="未提交或扫描异常的工作目录"><strong>{summary.risk ?? '–'}</strong><small>风险</small></span>
      <span className="railMetric" title="活动 Codex 会话与近期文件改动同时存在"><strong>{summary.coding ?? '–'}</strong><small>编写</small></span>
      <span className="railMetric" title="已并入本地基线的分支"><strong>{summary.merged ?? '–'}</strong><small>已合并</small></span>
    </button>
    <main inert={!expanded} aria-hidden={!expanded}>
      <header className="topbar">
        <img className="brandLogo" src={tellynLogo} alt="Tellyn" width="28" height="28" />
        <div className="search"><PanelIcon name="search" /><input id="search" ref={searchRef} aria-label="搜索分支或路径" placeholder="搜索分支或路径" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          {query && <button className="iconButton" aria-label="清空搜索" title="清空搜索" onClick={() => { setQuery(''); searchRef.current?.focus(); }}><PanelIcon name="close" /></button>}</div>
        <button className="iconButton" aria-label={lockedOpen ? '取消固定' : '固定展开'} title={lockedOpen ? '取消固定' : '固定展开'} aria-pressed={lockedOpen} onClick={() => { if (collapseTimerRef.current !== null) window.clearTimeout(collapseTimerRef.current); collapseTimerRef.current = null; setLockedOpen((value) => !value); }}><PanelIcon name="pin" /></button>
        <button className={`iconButton ${busy ? 'isRefreshing' : ''}`} aria-label={busy ? '正在刷新' : '刷新'} title="刷新" disabled={busy} onClick={() => void handleRefresh()}><PanelIcon name="refresh" /></button>
      </header>
      <div className="projectTabBar"><div className="projectTabs" role="tablist" aria-label="项目">
        {snapshot?.projects.map((project, index) => <button role="tab" id={`project-tab-${index}`} aria-selected={selectedProjectId === project.config.id} aria-controls={`project-panel-${index}`} tabIndex={selectedProjectId === project.config.id ? 0 : -1} key={project.config.id} title={`${project.config.path} · 右键可移出`} onClick={() => { setContextMenu(null); setActiveProjectId(project.config.id); }} onContextMenu={(event) => {
          event.preventDefault(); setActiveProjectId(project.config.id);
          setContextMenu({ id: project.config.id, left: Math.min(event.clientX, window.innerWidth - 140), top: Math.min(event.clientY, window.innerHeight - 54) });
        }} onKeyDown={(event) => {
          let next = index;
          if (event.key === 'ArrowRight') next = (index + 1) % tabCount;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabCount) % tabCount;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = tabCount - 1;
          else if (event.key === 'Escape') { setContextMenu(null); return; }
          else return;
          event.preventDefault(); selectTab(next);
        }}>{project.config.path.split('/').filter(Boolean).at(-1)}</button>)}
        {addingProject && <button role="tab" id={`project-tab-${snapshot?.projects.length ?? 0}`} aria-selected={selectedProjectId === 'new-project'} aria-controls="new-project-panel" tabIndex={selectedProjectId === 'new-project' ? 0 : -1} onClick={() => setActiveProjectId('new-project')} onKeyDown={(event) => {
          const index = tabCount - 1;
          let next = index;
          if (event.key === 'ArrowRight') next = 0;
          else if (event.key === 'ArrowLeft') next = (index - 1 + tabCount) % tabCount;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = index;
          else return;
          event.preventDefault(); selectTab(next);
        }}>New Project</button>}
      </div><button className="iconButton addTab" aria-label="添加项目" title="添加项目" aria-controls="new-project-panel" onClick={() => {
        if (!addingProject) { previousProjectRef.current = selectedProjectId ?? null; setAddingProject(true); setError(''); }
        setActiveProjectId('new-project');
      }}><PanelIcon name="plus" /></button></div>
      {contextMenu && <div className="projectContextMenu" role="menu" aria-label="项目操作" style={{ left: contextMenu.left, top: contextMenu.top }} onPointerDown={(event) => event.stopPropagation()}>
        <button role="menuitem" disabled={busy} onClick={() => { const id = contextMenu.id; setContextMenu(null); void handleRemove(id); }}>移出项目</button>
      </div>}
      {addingProject && <div role="tabpanel" id="new-project-panel" aria-labelledby={`project-tab-${snapshot?.projects.length ?? 0}`} hidden={selectedProjectId !== 'new-project'}>
        <form className="addProjectForm" noValidate onSubmit={(event) => { event.preventDefault(); void handleAdd(); }}>
          <label htmlFor="projectPath">Git 项目绝对路径</label><input autoFocus id="projectPath" placeholder="/Users/you/projects/repo" value={path} onChange={(event) => setPath(event.currentTarget.value)} />
          <label htmlFor="baseBranch">比较基线（可选）</label><input id="baseBranch" placeholder="main" value={baseBranch} onChange={(event) => setBaseBranch(event.currentTarget.value)} />
          <div className="formActions"><button type="button" onClick={() => { setAddingProject(false); setActiveProjectId(previousProjectRef.current); setPath(''); setBaseBranch(''); setError(''); }}>取消</button><button disabled={busy} type="submit">保存项目</button></div>
        </form>
      </div>}
      <div aria-live="polite">{error && <p className="error">{error}</p>}</div>
      {selectedProjectId !== 'new-project' && <>
      <section className="toolbar" aria-label="筛选分支">
        <div className="filters">{[['all', '全部'], ['dirty', '未提交'], ['commits', '未合并'], ['active', '活动会话']].map(([value, label]) =>
          <button aria-pressed={filter === value} key={value} onClick={() => setFilter(value ?? 'all')}>{label}</button>)}</div>
      </section>
      <div className="listOptions"><label><input type="checkbox" checked={showAllBranches} onChange={(event) => setShowAllBranches(event.currentTarget.checked)} /> 显示未检出的本地分支</label>
        <label><input type="checkbox" checked={showMerged} onChange={(event) => setShowMerged(event.currentTarget.checked)} /> 显示已并入本地基线的分支</label></div>
      {snapshot?.projects.map((project, index) => <div role="tabpanel" id={`project-panel-${index}`} aria-labelledby={`project-tab-${index}`} hidden={selectedProjectId !== project.config.id} key={project.config.id}><ProjectSection project={project} query={query} filter={filter} showMerged={showMerged} showAllBranches={showAllBranches} expanded={expanded && selectedProjectId === project.config.id}
        nowSeconds={nowSeconds} onRefresh={handleRefresh} /></div>)}
      {snapshot?.projects.length === 0 && !addingProject && <p className="empty">点击项目栏右侧的 ＋ 添加项目。</p>}
      </>}
    </main>
  </div>;
};
