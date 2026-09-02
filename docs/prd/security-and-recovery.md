# 安全与恢复

GitHub 首版只使用本地 `gh auth login --web --git-protocol https` 管理 `github.com` 的 HTTPS Git 凭证；不提供 fine-grained token 输入或应用内 OAuth。Token、授权 header 和 `gh` 配置只由 GitHub CLI 及其系统凭证存储管理，easyBlog 不复制、读取或写入这些敏感值。SQLite 仅可缓存非敏感的授权检查结果，实际连接与发布前始终重新检查。飞书应用凭证不写入 SQLite，也不上传到服务端。

日志只记录必要的操作元数据、错误、脱敏路径和文档 ID，不记录正文、Token、Secret 或 Authorization header。可导出诊断日志，导出前自动脱敏。

发布前保留本地变更快照，发布记录关联 commit SHA。失败时不更新成功状态并允许重试；误发布通过历史提交生成新的反向回滚 commit，不能改写远端历史。

GitHub 目标的工作副本位于应用数据目录，由 easyBlog 独占管理，绝不复用用户已有 clone。连接、预览和发布前都会获取远端更新；仅当工作副本干净、没有待推送提交且能够 fast-forward 时才自动更新。任何分叉、待推送提交、脏状态或初始化推送失败都会停止操作并保留可恢复状态，不自动 merge、rebase、强推或删除用户内容。
