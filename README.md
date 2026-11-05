# Global Work Status

独立的 macOS 代码工作台，使用 Tauri v2 + React。源码、依赖、Git 历史和构建产物均在本仓库，不再依赖 Tellyn monorepo。

右侧窄条常驻，显示风险、正在编写和已合并数量；悬停展开，离开收起，可固定展开。项目通过横向标签切换，分支按最新提交时间排序。每个分支展示提交、未提交改动、Codex 会话、合并和部署证据，PR 与 CI 在详情中查询。

## 开发

需要 Bun 1.3.11+、Rust/Cargo 和 macOS Xcode Command Line Tools。

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

macOS 应用位于 `src-tauri/target/release/bundle/macos/Global Work Status.app`。

## 数据与连接

- 点击项目标签右侧的 ＋ 添加任意本地 Git 仓库。Tellyn 仓库默认比较基线为 `PA-home-page`。
- Codex 会话需要安装并信任本地钩子，见 [codexSetup.md](codexSetup.md)。已有全局钩子不受源码搬迁影响，无需重复安装。
- PR 与 CI 使用本机 `gh` 登录态。Tellyn 的部署核对使用既有只读 SSH 与 GitHub Deployment 记录；证据缺失显示“未核实”。
- 应用标识仍为 `com.repo.globalworkstatus`，继续使用原有应用数据目录和已添加项目；事件日志仍为 `~/.codex/globalWorkStatus/events.jsonl`。
- 应用不会自动提交、合并或部署代码。

## 仓库迁移

从 Tellyn 的 `apps/globalWorkStatus` 提取而来，保留该目录的 7 次提交历史（子目录拆分后提交 SHA 会改变）。迁移源提交为 `7fd43326`。本仓库拥有自己的 `.git`、`bun.lock` 和 Cargo 锁文件，未配置远程仓库。
