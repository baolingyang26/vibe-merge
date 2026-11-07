import type { BranchStage } from '../branchProgress';

export const BranchProgress = ({ stages }: { stages: [BranchStage, BranchStage, BranchStage, BranchStage] }) =>
  <div className="branchProgress" role="list" aria-label="分支进度：commit、push、提 PR、已合并或已拒绝">
    {stages.map((stage, index) => <div className={`progressStage is-${stage.tone}${stage.tone === 'done' && stages[index + 1]?.tone === 'done' ? ' is-linked' : ''}`} role="listitem" aria-label={`${stage.name}：${stage.detail}`} key={stage.name} title={`${stage.name}：${stage.detail}`}>
      <span className={`progressDot${stage.indicator ? ` is-${stage.indicator}` : ''}`} aria-hidden="true">
        {stage.indicator === 'check' && <svg viewBox="0 0 12 12"><path d="m2.2 6.2 2.4 2.3 5.2-5" /></svg>}
        {stage.indicator === 'cross' && <svg viewBox="0 0 12 12"><path d="m3 3 6 6M9 3 3 9" /></svg>}
      </span>
      <span className="progressName">{stage.name}</span>
      {stage.value && <span className="progressValue">{stage.value}</span>}
    </div>)}
  </div>;
