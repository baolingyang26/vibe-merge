import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export interface BranchAdvice {
  verdict: 'ready' | 'caution' | 'unsuitable' | 'unknown';
  summary: string;
  reason: string;
  target: string;
  source: 'codex' | 'git';
}

type AdviceState = { key: string; status: 'idle' | 'loading' | 'ready' | 'error'; advice: BranchAdvice | null; error: string };
const cache = new Map<string, { at: number; promise: Promise<BranchAdvice> }>();
const queue: Array<() => Promise<void>> = [];
let running = 0;

const pump = () => {
  while (running < 2 && queue.length > 0) {
    const task = queue.shift();
    if (!task) return;
    running += 1;
    void task().finally(() => { running -= 1; pump(); });
  }
};

const enqueue = (task: () => Promise<BranchAdvice>): Promise<BranchAdvice> => new Promise((resolve, reject) => {
  queue.push(async () => { try { resolve(await task()); } catch (error) { reject(error); } });
  pump();
});

export const useBranchAdvice = (projectId: string, branch: string, headSha: string, target: string, enabled: boolean) => {
  const key = JSON.stringify([projectId, branch, headSha, target]);
  const [state, setState] = useState<AdviceState>({ key: '', status: 'idle', advice: null, error: '' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !target) { setState({ key, status: 'idle', advice: null, error: '' }); return; }
    let mounted = true;
    const cached = cache.get(key);
    const promise = cached && Date.now() - cached.at < 300_000 ? cached.promise : enqueue(() => invoke<BranchAdvice>('analyze_branch', { projectId, branch, headSha, target }));
    if (!cached || promise !== cached.promise) cache.set(key, { at: Date.now(), promise });
    setState({ key, status: 'loading', advice: null, error: '' });
    void promise.then((advice) => {
      if (mounted) setState({ key, status: 'ready', advice, error: '' });
    }, (error) => {
      if (cache.get(key)?.promise === promise) cache.delete(key);
      if (mounted) setState({ key, status: 'error', advice: null, error: String(error) });
    });
    return () => { mounted = false; };
  }, [projectId, branch, headSha, target, enabled, attempt]);
  const retry = () => {
    cache.delete(JSON.stringify([projectId, branch, headSha, target]));
    setAttempt((value) => value + 1);
  };
  return { ...(state.key === key ? state : { key, status: enabled && target ? 'loading' as const : 'idle' as const, advice: null, error: '' }), retry };
};
