# Lefthook 设置

easyBlog 使用 [Lefthook](https://github.com/evilmartians/lefthook) 管理 Git hooks。当前首版配置只执行跨平台的暂存区空白检查，避免在项目工具链尚未确定时绑定具体语言或包管理器。

## 安装

任选一种方式安装 Lefthook：

```bash
# macOS / Linux
brew install lefthook

# npm
npm install -g lefthook

# Windows
scoop install lefthook
# 或
winget install evilmartians.lefthook
```

检查安装结果：

```bash
lefthook version
```

## 初始化

在仓库根目录执行：

```bash
lefthook install
```

当 `lefthook.yml` 发生变化时重新执行该命令即可更新 hooks。

## 手动运行

```bash
lefthook run pre-commit
```

紧急情况下可以对单次提交跳过 hooks，但应在后续补充检查：

```bash
LEFTHOOK=0 git commit -m "chore: temporary commit"
# 或
git commit --no-verify -m "chore: temporary commit"
```

## 当前检查

- `staged-whitespace` 执行 `git diff --cached --check`，阻止暂存文件中的尾随空格和冲突标记。
- `frontend-build` 执行 `npm run build`，检查 TypeScript 类型和 Vite 生产构建。
- `backend-format` 执行 `cargo fmt --manifest-path backend/Cargo.toml --all -- --check`，检查 Rust 格式；使用 `backend` 作为后端目录。

提交钩子不执行 `cargo check` 或网络相关操作，避免因为首次拉取依赖或外部服务不可用而阻塞普通提交。完整编译和测试在本地验证或 CI 中运行。
