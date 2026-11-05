# 界面交互约定

本地 macOS 工作台使用原生控件完成明确的小范围选择与提交表单。状态事实仍以 Git、Codex 会话和远端证据为准。

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Select/Listbox | PR 目标分支的原生 select | DESIGN.md、premium-ui.json | macOS 系统弹出列表 | 键盘选择、必选校验、桌面实际打开状态 |
| Form | 原生 form 与 src/styles.css 控件样式 | DESIGN.md、src/components/branchActions.tsx | 添加项目、提交推送、创建 PR | 必填、错误提示、重复提交阻止、取消状态 |
| Scrollbar | src/styles.css 全局滚动条 | DESIGN.md | 主侧栏与文件清单内部滚动 | 窄窗口、长文件名、长列表检查 |

提交推送前，用户查看并选择文件、填写说明；执行时再次验证项目、工作目录、分支、HEAD 与改动快照。提交成功而推送失败时保留提交并提供重试。创建 PR 前，用户明确选择远端目标分支；若已有同一来源和目标的 PR，则打开现有 PR。所有远端推送都不使用强制覆盖。
