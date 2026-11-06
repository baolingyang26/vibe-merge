# Vibe Merge

独立的 macOS 代码工作台，使用 Tauri v2 + React。源码、依赖、Git 历史和构建产物均在本仓库，不再依赖 Tellyn monorepo。

右侧窄条常驻，显示风险、正在编写和已合并数量；悬停展开，离开收起，可固定展开。项目通过横向标签切换，分支按最新提交时间排序。每个分支展示提交、未提交改动、Codex 会话、合并和部署证据，PR 与 CI 在详情中查询。分支卡片需要点击“分析此分支”才会调用本机 Codex；创建 PR 时会针对所选目标分支分析，明确不适合时显示原因并要求再次确认。提示可以关闭。活动分支有轻微动态提示；停止更新后，可在卡片内查看全部改动文件并提交推送，或选择目标分支创建 PR。已并入基线且未被检出的分支可在输入分支名确认后删除本地分支。

分支名旁只显示创建者及提交者头像，悬停时显示姓名；GitHub 能将提交关联到账户时显示头像，否则使用姓名首字。远端检出的分支不会误标本地创建者，提交者只统计检出后的提交。“并入”进度显示已进入本地基线的代码提交数、分支代码提交总数及百分比；改写 SHA 后补丁相同的提交也计入已并入。只有其他本地分支包含当前分支的最新提交时，操作行左侧才显示已并入的分支名；右侧提供分支分析、提交推送和创建 PR 等操作。

## 开发

需要 Bun 1.3.11+、Rust/Cargo 和 macOS Xcode Command Line Tools。AI 提示需要本机已登录的 Codex CLI；分析只读取本地仓库，不会修改代码。

```bash
cd /Users/baoling/Documents/globalWorkStatus
bun install --frozen-lockfile
bun run tauri:dev
```

`bun run dev` 仅启动前端开发服务，完整功能请运行 `tauri:dev`。开发服务使用端口 9440，HMR 使用 9441。

## 验证与打包

```bash
bun run quality
bun run tauri build --bundles app
```

macOS 应用位于 `src-tauri/target/release/bundle/macos/Vibe Merge.app`。

## 数据与连接

- 点击项目标签右侧的 ＋ 添加任意本地 Git 仓库。Tellyn 仓库默认比较基线为 `PA-home-page`。
- Codex 会话需要安装并信任本地钩子，见 [codexSetup.md](codexSetup.md)。已有全局钩子不受源码搬迁影响，无需重复安装。
- PR 与 CI 使用本机 `gh` 登录态；创建 PR 还需要 `origin` 远端和该仓库的推送权限。Tellyn 的部署核对使用既有只读 SSH 与 GitHub Deployment 记录；证据缺失显示“未核实”。
- 应用标识仍为 `com.repo.globalworkstatus`，继续使用原有应用数据目录和已添加项目；事件日志仍为 `~/.codex/globalWorkStatus/events.jsonl`。
- 应用只会在用户查看全部改动文件并点击“提交并推送全部改动”，或选择目标分支并点击“创建 PR”后执行对应操作；不会自动合并或部署代码。基线分支不能从卡片中直接提交推送。删除按钮只删除已并入基线且未被工作目录使用的本地分支，不删除远端分支或 PR。

## 仓库迁移

从 Tellyn 的 `apps/globalWorkStatus` 提取而来，保留该目录的 7 次提交历史（子目录拆分后提交 SHA 会改变）。迁移源提交为 `7fd43326`。本仓库拥有自己的 `.git`、`bun.lock` 和 Cargo 锁文件，远端为 `horisony/vibe-branch-merge-panel`。
