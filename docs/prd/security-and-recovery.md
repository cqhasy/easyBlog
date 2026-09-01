# 安全与恢复

GitHub 使用本地 `gh auth login` 或 fine-grained token；只申请目标仓库所需权限。飞书应用凭证不写入 SQLite，也不上传到服务端。

日志只记录必要的操作元数据、错误、脱敏路径和文档 ID，不记录正文、Token、Secret 或 Authorization header。可导出诊断日志，导出前自动脱敏。

发布前保留本地变更快照，发布记录关联 commit SHA。失败时不更新成功状态并允许重试；误发布通过历史提交生成新的反向回滚 commit，不能改写远端历史。
