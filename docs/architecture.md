# easyBlog 架构设计

## 1. 设计目标

easyBlog 是一个单用户、单机、本地优先的 Tauri 桌面应用：从本地目录、飞书文档和飞书知识库读取内容，经过用户确认后，以 Git 提交发布到 GitHub 博客仓库。

首版采用模块化单体，不引入微服务、复杂插件系统或严格 DDD。系统按能力拆分，使用明确的用户动作组合能力模块；不使用 `api`、`service`、`manager`、`handler` 等无法表达职责的泛化目录名。

## 2. 核心概念

- **Source**：内容来源，如本地目录、飞书文档、飞书知识库。
- **Scope**：来源中的同步范围，包含选择、递归、包含/排除规则、暂停状态和目标绑定。
- **Binding**：来源文章与目标文章之间的唯一映射。
- **Snapshot**：某次检测时来源和目标的状态快照。
- **Change**：由快照比较得到的新增、修改、删除、移动或冲突。
- **ReleaseBatch**：用户确认后的一组发布操作，可按文章、来源或目录拆分。
- **TargetWorkspace**：本地 Git 工作副本，负责目标结构检查、文件生成、diff、提交和推送。
- **Publication**：一次发布记录，关联批次、commit SHA、文件变更和结果。
- **Credential**：由系统安全存储管理的飞书或 GitHub 凭证，不进入 SQLite。

## 3. 总体分层

```text
Frontend Features
        ↓
Frontend Bridge
        ↓
Tauri Commands
        ↓
Actions
        ↓
Capability Modules
        ↓
Provider / Storage / Credential Adapters
```

- 前端按用户工作流组织页面和状态。
- `commands` 是最薄的 Tauri 入口，只做参数转换、调用动作和错误传递。
- `actions` 以用户动作命名，负责流程编排，例如 `scan_scope`、`preview_release`、`publish_release`。
- 能力模块负责稳定的业务规则和数据结构。
- 外部系统实现放在 `providers`，持久化放在 `storage`，系统凭证放在 `credentials`。
- 接口放在使用它的能力模块附近，不建立单独的、泛化的 `ports` 层。

## 4. 最终目录

```text
easyBlog/
├─ src/
│  ├─ main.ts
│  ├─ app/
│  │  ├─ bootstrap.ts
│  │  ├─ routes.ts
│  │  ├─ layout/
│  │  └─ state/
│  ├─ features/
│  │  ├─ sources/
│  │  │  ├─ source-list/
│  │  │  ├─ source-tree/
│  │  │  ├─ scope-editor/
│  │  │  └─ source-state.ts
│  │  ├─ changes/
│  │  │  ├─ change-list/
│  │  │  ├─ diff-view/
│  │  │  ├─ conflict-view/
│  │  │  └─ change-state.ts
│  │  ├─ releases/
│  │  │  ├─ batch-editor/
│  │  │  ├─ release-preview/
│  │  │  ├─ release-progress/
│  │  │  └─ release-state.ts
│  │  ├─ history/
│  │  ├─ settings/
│  │  └─ onboarding/
│  ├─ components/
│  ├─ bridge/
│  │  ├─ sources.ts
│  │  ├─ scopes.ts
│  │  ├─ changes.ts
│  │  ├─ releases.ts
│  │  ├─ history.ts
│  │  └─ settings.ts
│  ├─ contracts/
│  └─ styles/
│
├─ backend/
│  ├─ tauri.conf.json
│  ├─ capabilities/
│  └─ src/
│     ├─ main.rs
│     ├─ lib.rs
│     ├─ app/
│     │  ├─ state.rs
│     │  ├─ wiring.rs
│     │  └─ lifecycle.rs
│     ├─ commands/
│     │  ├─ sources.rs
│     │  ├─ scopes.rs
│     │  ├─ changes.rs
│     │  ├─ releases.rs
│     │  ├─ history.rs
│     │  └─ settings.rs
│     ├─ actions/
│     │  ├─ add_source.rs
│     │  ├─ configure_scope.rs
│     │  ├─ scan_scope.rs
│     │  ├─ preview_release.rs
│     │  ├─ publish_release.rs
│     │  ├─ retry_release.rs
│     │  └─ rollback_publication.rs
│     ├─ sources/
│     │  ├─ source.rs
│     │  ├─ tree.rs
│     │  ├─ selection.rs
│     │  └─ source_errors.rs
│     ├─ scopes/
│     │  ├─ scope.rs
│     │  ├─ rules.rs
│     │  ├─ bindings.rs
│     │  └─ scope_status.rs
│     ├─ content/
│     │  ├─ article.rs
│     │  ├─ resource.rs
│     │  ├─ markdown.rs
│     │  ├─ frontmatter.rs
│     │  ├─ slug.rs
│     │  └─ conversion_warning.rs
│     ├─ tracking/
│     │  ├─ snapshot.rs
│     │  ├─ fingerprint.rs
│     │  ├─ identity.rs
│     │  └─ binding_lookup.rs
│     ├─ changes/
│     │  ├─ scan.rs
│     │  ├─ compare.rs
│     │  ├─ change.rs
│     │  ├─ conflict.rs
│     │  └─ change_set.rs
│     ├─ releases/
│     │  ├─ batch.rs
│     │  ├─ plan.rs
│     │  ├─ file_set.rs
│     │  ├─ stage.rs
│     │  ├─ commit.rs
│     │  ├─ push.rs
│     │  └─ rollback.rs
│     ├─ targets/
│     │  ├─ target.rs
│     │  ├─ layout.rs
│     │  ├─ template.rs
│     │  └─ target_check.rs
│     ├─ workspace/
│     │  ├─ checkout.rs
│     │  ├─ working_tree.rs
│     │  ├─ diff.rs
│     │  ├─ commit_log.rs
│     │  └─ file_lock.rs
│     ├─ providers/
│     │  ├─ local/
│     │  │  ├─ reader.rs
│     │  │  └─ file_tree.rs
│     │  ├─ feishu/
│     │  │  ├─ auth.rs
│     │  │  ├─ docs.rs
│     │  │  ├─ wiki.rs
│     │  │  ├─ blocks.rs
│     │  │  └─ assets.rs
│     │  ├─ github/
│     │  │  ├─ auth.rs
│     │  │  ├─ repository.rs
│     │  │  └─ remote.rs
│     │  └─ git/
│     │     ├─ commands.rs
│     │     └─ parser.rs
│     ├─ storage/
│     │  ├─ database.rs
│     │  ├─ migrations/
│     │  ├─ sources.rs
│     │  ├─ scopes.rs
│     │  ├─ snapshots.rs
│     │  ├─ changes.rs
│     │  ├─ releases.rs
│     │  └─ publications.rs
│     ├─ credentials/
│     │  ├─ keychain.rs
│     │  ├─ feishu.rs
│     │  └─ github.rs
│     ├─ scheduler/
│     │  ├─ schedule.rs
│     │  ├─ runner.rs
│     │  └─ jobs.rs
│     ├─ diagnostics/
│     │  ├─ logging.rs
│     │  ├─ redaction.rs
│     │  └─ export.rs
│     └─ shared/
│        ├─ ids.rs
│        ├─ errors.rs
│        ├─ result.rs
│        └─ time.rs
├─ tests/
│  ├─ content/
│  ├─ changes/
│  ├─ releases/
│  ├─ providers/
│  └─ fixtures/
├─ docs/
│  ├─ PRD.md
│  ├─ prd/
│  ├─ decisions/
│  └─ architecture.md
```

## 5. 关键数据流

### 检测

```text
scan_scope
 → 读取 Scope
 → SourceReader 获取来源节点
 → content 转换为统一文章
 → tracking 读取上次 Snapshot
 → changes.compare 生成 ChangeSet
 → changes.conflict 检查冲突
 → storage 保存结果
```

### 发布

```text
preview_release
 → releases.plan 生成计划
 → targets 检查目标结构
 → content 生成文章和资源
 → workspace.diff 生成预览

publish_release
 → releases.stage
 → 写入工作副本
 → releases.commit
 → releases.push
 → 更新 Snapshot
 → 保存 Publication
```

权限、网络、转换、slug、映射或目标外部修改出现不确定性时，停止受影响项，不覆盖文件，不删除线上内容，不标记成功。

## 6. 模块依赖规则

- `commands` 不直接访问 SQLite、Git 或飞书。
- `actions` 只编排流程，不实现外部协议。
- `sources` 不依赖 GitHub 发布逻辑。
- `changes` 只处理标准化内容和 Snapshot。
- `releases` 不关心内容来自哪个 Source。
- `providers` 只实现外部系统能力。
- `storage` 不保存 Token、Secret 或正文。
- `credentials` 不被前端直接调用。
- `shared` 只存真正跨模块稳定复用的类型。

## 7. 测试边界

重点测试 `content`、`changes`、`tracking`、`releases` 的纯逻辑；provider 使用 fixture 和 mock；workspace 使用临时 Git 仓库验证 diff、提交、推送模拟和回滚。Tauri command 只做少量集成测试，因为它们应保持薄入口和单一职责。

## 8. 设计依据

目录命名和边界参考了 Tauri 的轻量入口、gitui 按用户能力和动作拆分的组织方式，以及 Zed 按独立能力隔离 Rust 模块的方式：入口薄、能力自包含、外部系统适配独立、流程由明确动作组合。
