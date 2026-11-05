import type { BranchStage } from '../branchProgress';

export const BranchProgress = ({ stages }: { stages: [BranchStage, BranchStage, BranchStage] }) =>
  <div className="branchProgress" aria-label="分支状态：提交、并入、部署">
    {stages.map((stage) => <div className={`progressStage is-${stage.tone}`} key={stage.name} title={`${stage.name}：${stage.detail}`}>
      <span className="progressDot" aria-hidden="true" />
      <span className="progressName">{stage.name}</span>
      <span className="progressDetail">{stage.detail}</span>
    </div>)}
  </div>;
