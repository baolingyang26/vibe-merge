import { useState } from 'react';
import type { BranchAdvice } from '../branchAdvice';

const dismissedAdvice = new Set<string>();

export const BranchAdviceView = ({ branchHead, target, status, advice, error, retry, compact = false }: {
  branchHead: string;
  target: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  advice: BranchAdvice | null;
  error: string;
  retry: () => void;
  compact?: boolean;
}) => {
  const [dismissed, setDismissed] = useState('');
  const key = `${branchHead}:${target}`;
  if (dismissed === key || dismissedAdvice.has(key)) return <button className="showAdvice" type="button" onClick={() => { dismissedAdvice.delete(key); setDismissed(''); }}>显示提示</button>;
  return <section className={`branchAdvice ${compact ? 'isCompact' : ''} is-${advice?.verdict ?? 'unknown'}`} aria-label={`${advice?.source === 'git' ? 'Git' : 'AI'} 提示：目标 ${target}`} role={advice?.verdict === 'unsuitable' ? 'alert' : 'status'}>
    <div className="adviceHeading"><span>{advice?.source === 'git' ? 'Git 提示' : 'AI 提示'} · → {target}</span><button type="button" onClick={() => { dismissedAdvice.add(key); setDismissed(key); }} aria-label="关闭提示">关闭</button></div>
    {status === 'idle' && <p>点击分析后显示结果。</p>}
    {status === 'loading' && <p>正在分析分支与目标分支的差异…</p>}
    {status === 'ready' && advice && <><strong>{advice.summary}</strong><p>{advice.reason}</p></>}
    {status === 'error' && <><p>暂时无法分析：{error}</p><button type="button" onClick={retry}>重试分析</button></>}
  </section>;
};
