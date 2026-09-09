# easyBlog

easyBlog 是一个本地优先的桌面博客发布工具。它读取本地目录中的 Markdown 文章，在你确认变更后，将内容转换为一次 Git 提交并推送到 GitHub 博客仓库。

> 当前版本为 `0.1.0`，主要面向开发和体验。当前可用流程是 **本地 Markdown 目录 -> GitHub Pages / Astro 内容仓库**，检测需要手动触发。飞书来源和定时检测仍在规划中。

## 当前能力

- 添加本地目录，并选择整个目录、子目录或单篇 Markdown 文件作为同步范围
- 使用包含/排除规则控制参与同步的路径
- 通过本机 GitHub CLI 授权，连接具有推送权限的 GitHub 仓库
- 支持 GitHub Pages 和 Astro Content Collections 两种发布布局
- 检测新增、修改、移动、删除及受阻内容
- 发布前逐篇评审，并预览目标文件和 Git diff
- 将确认的内容提交并推送到目标仓库
- 查看发布历史、重试失败的推送，以及通过反向提交回滚已发布批次

## 使用前准备

当前仓库暂未提供安装包，需要从源码启动桌面应用。

请先安装：

- [Node.js](https://nodejs.org/) 18 或更高版本
- [Rust](https://www.rust-lang.org/tools/install)
- [Git](https://git-scm.com/downloads)
- [GitHub CLI](https://cli.github.com/)
- [Tauri 2 所需的系统依赖](https://v2.tauri.app/start/prerequisites/)

Windows 还需要 Microsoft Edge WebView2；Windows 10 1803 及更高版本通常已自带。macOS 开发环境需要 Xcode Command Line Tools。

检查主要工具是否可用：

```bash
node --version
npm --version
rustc --version
cargo --version
git --version
gh --version
```

## 启动应用

克隆仓库并安装前端依赖：

```bash
git clone https://github.com/cqhasy/easyBlog.git
cd easyBlog
npm install
```

启动完整的 Tauri 桌面应用：

```bash
npm run tauri:dev
```

首次编译 Rust 依赖会花费一些时间。`npm run dev` 只启动浏览器中的前端页面，不具备本地文件、GitHub 和发布能力，因此日常使用请运行 `npm run tauri:dev`。

## 首次配置

### 1. 连接 GitHub

应用启动后会检查本机的 GitHub CLI 登录状态。尚未登录时：

1. 点击 **继续使用 GitHub**。
2. 应用会打开 GitHub 官方设备授权页面，并显示一次性验证码。
3. 在浏览器中输入验证码并完成授权。
4. 返回 easyBlog；应用会自动检查结果，也可以点击 **我已完成授权**。

也可以在启动应用前通过终端完成登录：

```bash
gh auth login
gh auth status
```

easyBlog 使用 `gh` 管理 GitHub 身份和 HTTPS Git 凭据，不会要求你在应用中粘贴 Personal Access Token。

### 2. 添加内容来源

1. 打开侧边栏的 **Sources**。
2. 点击 **添加内容来源**。
3. 填写包含 Markdown 文件的本地目录路径；显示名称可以留空。
4. 提交后，该目录会出现在 **内容来源** 列表中。

当前只会将 Markdown 文件作为文章处理。文章标题优先读取 Front Matter 中的 `title`，其次使用正文中的第一个一级标题。

示例文章：

```markdown
---
title: 我的第一篇文章
date: 2026-09-09
tags:
  - easyBlog
---

# 我的第一篇文章

正文内容。
```

### 3. 连接并配置发布目标

1. 在 **Sources** 页面点击 **连接 GitHub 目标**。
2. 从列表中选择当前 GitHub 账号有推送权限的仓库。
3. 连接完成后，在 **发布目标** 标签页选择该仓库并点击 **编辑目标**。
4. 选择发布适配器，确认文章目录和资源目录。
5. 保存配置。如果目标仓库缺少必要目录或配置，先查看待创建项，再确认初始化。

适配器的常见目录：

| 适配器 | 文章目录 | 资源目录 | 说明 |
| --- | --- | --- | --- |
| GitHub Pages | `_posts` | `assets/easyblog` | 初始化时会维护 `.github/easyblog.yml` |
| Astro Content Collections | `src/content/posts` | `src/assets/easyblog` | 不会修改 Astro 配置文件 |

目录以目标仓库根目录为基准。easyBlog 会为目标仓库维护独立工作副本，不会修改你已有的本地 clone。

### 4. 创建同步范围

1. 回到 **内容来源** 标签页，选择刚添加的来源并点击 **编辑来源**。
2. 新建同步范围并填写名称。
3. 选择已配置完成的 GitHub 发布目标。
4. 选择整个来源、目录或单篇 Markdown 文件。
5. 必要时展开 **高级规则**，添加包含或排除路径规则。
6. 保存同步范围。

一个来源可以创建多个同步范围。同步范围也可以暂停、恢复或删除；暂停后不会出现在 Dashboard 的活动来源中。

## 发布文章

完成首次配置后，一次标准发布包含以下步骤：

1. 在 **Dashboard** 点击 **检查全部**，或进入某个同步范围后点击重新检测按钮。
2. 打开有变更的来源，查看新增、更新、移动、删除和受阻项目。
3. 勾选本次要处理的文章，然后点击 **进入评审**。
4. 逐篇检查内容；删除项不会默认选中，必须明确确认。
5. 生成发布预览，检查目标路径、文件变化和 Git diff。
6. 点击发布并在确认对话框中确认。easyBlog 会创建提交并推送到仓库默认分支。

受阻项目不能被选择。常见原因包括 Markdown 无法解析、slug 冲突、目标文件被外部修改，或目标仓库状态不适合安全发布。请先按页面提示修复，再重新检测。

## 发布历史与恢复

打开侧边栏的 **History** 可以查看每次发布涉及的文章、资源、目标路径、提交 SHA 和批次 ID。

- **等待推送**：本地提交已经创建，但尚未成功推送。恢复网络或仓库权限后点击 **重试推送**。
- **等待推送回滚**：反向提交已经创建，但尚未推送。点击 **重试回滚推送**。
- **已发布**：可以从操作菜单选择 **回滚**。回滚会创建并推送一条新的反向提交，不会改写 Git 历史。
- **需要恢复**：应用检测到发布状态不确定。不要手动修改 easyBlog 管理的工作副本，请先根据记录中的提示处理。

## 使用约束

- 同步方向仅为本地来源到 GitHub，目标仓库的修改不会反向写回来源。
- 当前只支持 `github.com` 上的 HTTPS 仓库。
- 发布直接进入仓库默认分支，目前不创建 Pull Request。
- easyBlog 不负责构建博客，也不会创建或管理 GitHub Actions。
- 连接仓库、生成预览和发布前都会同步远端状态；遇到脏工作区、未推送提交或无法 fast-forward 时会停止操作。
- 应用元数据保存在系统应用数据目录中的 SQLite 数据库，托管的 Git 工作副本也位于该目录。GitHub 凭据由 GitHub CLI 管理，不以明文写入数据库。

## 开发命令

```bash
# 启动完整桌面应用
npm run tauri:dev

# 仅启动 Vite 前端
npm run dev

# 运行前端测试
npm test

# 检查 TypeScript 并构建前端
npm run build

# 运行 Rust 测试
cargo test --manifest-path backend/Cargo.toml

# 检查 Rust 格式
cargo fmt --manifest-path backend/Cargo.toml --all -- --check

# 构建桌面应用
npm run tauri:build
```

当前 `backend/tauri.conf.json` 中的 `bundle.active` 为 `false`，因此 `tauri:build` 只构建应用，不生成平台安装包。

## 相关文档

- [产品需求](docs/PRD.md)
- [GitHub 发布设计](docs/prd/github-publishing.md)
- [同步模型](docs/prd/sync-model.md)
- [安全与恢复](docs/prd/security-and-recovery.md)
- [架构设计](docs/architecture.md)
- [开发计划](docs/plans/v1-development-plan.md)
- [Lefthook 设置](docs/lefthook-setup.md)
