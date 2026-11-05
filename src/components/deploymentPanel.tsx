import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeploymentEvidence } from '../statusTypes';
import { evidenceTime } from '../statusTypes';

export const DeploymentPanel = ({ path, onEvidence, autoCheck = false }: { path: string; onEvidence?: (evidence: DeploymentEvidence[]) => void; autoCheck?: boolean }) => {
  const [evidence, setEvidence] = useState<DeploymentEvidence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkedPath = useRef<string | null>(null);
  const handleCheck = useCallback(async () => {
    setBusy(true); setError(''); setEvidence([]);
    const results = await Promise.allSettled(['production', 'staging'].flatMap((environment) => ['server', 'admin', 'sales-admin'].map((service) => invoke<DeploymentEvidence>('load_deployment_evidence', { path, environment, service }))));
    const next = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    setEvidence(next); onEvidence?.(next);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length > 0) setError(`${failures.length} 项部署证据无法读取；未返回的环境与服务无法确认。`);
    setBusy(false);
  }, [path, onEvidence]);
  useEffect(() => {
    if (autoCheck && checkedPath.current !== path) {
      checkedPath.current = path;
      void handleCheck();
    }
  }, [autoCheck, handleCheck, path]);
  return <details className="deploymentPanel"><summary>部署 · 按环境与服务核对</summary><p>只有运行版本与部署记录一致，才显示已部署。</p><button disabled={busy} onClick={handleCheck}>{busy ? '正在核对…' : '核对部署'}</button>{error && <p className="error">{error}</p>}{['production', 'staging'].flatMap((environment) => ['server', 'admin', 'sales-admin'].map((service) => {
    const item = evidence.find((entry) => entry.environment === environment && entry.service === service);
    return <section className="deploymentItem" key={`${environment}/${service}`}><b>{environment} / {service}</b><p>{item?.status === 'verified' ? '已部署 · 双重证据一致' : item?.status === 'mismatch' ? '版本不一致' : '无法确认'}</p><p>运行 SHA <code>{item?.runtimeSha ?? '未知'}</code></p><p>部署 SHA <code>{item?.deploymentSha ?? '未知'}</code></p>{item && <><p>{item.reason}</p><small>来源：{item.runtimeSource} · {evidenceTime(item.observedAt)}</small>{item.deploymentUrl && <p><a href={item.deploymentUrl} rel="noreferrer" target="_blank">查看部署记录</a></p>}</>}</section>;
  }))}</details>;
};
