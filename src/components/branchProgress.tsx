import type { BranchStage } from '../branchProgress';

export const BranchProgress = ({ stages }: { stages: [BranchStage, BranchStage, BranchStage] }) =>
  <div className="branchProgress" role="list" aria-label="分支进度：提交、并入、部署">
    {stages.map((stage, index) => <div className={`progressStage is-${stage.tone}${stage.tone === 'done' && stages[index + 1]?.tone === 'done' ? ' is-linked' : ''}`} role="listitem" aria-label={`${stage.name}：${stage.detail}`} key={stage.name} title={`${stage.name}：${stage.detail}`}>
      <span className="progressDot" aria-hidden="true" />
      <span className="progressName">{stage.name}</span>
      {stage.value && <span className="progressValue">{stage.value}</span>}
    </div>)}
  </div>;
