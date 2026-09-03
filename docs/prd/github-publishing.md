# GitHub 发布

GitHub 以仓库为中心，而不是以本地路径为中心。作者连接 GitHub 后，从拥有推送权限的仓库中选择一个；easyBlog 在应用数据目录创建并管理自己的 Git 工作副本，读取目标仓库、生成适配器所需的文章与资源文件、展示 diff，用户确认后创建一个批次提交并推送。用户无需 clone、选择目录或管理该工作副本的位置。

## 授权与连接

easyBlog 不实现自己的 GitHub 账号体系，也不收集或保存 Personal Access Token。首版复用用户本机的 GitHub CLI（`gh`）：应用每次启动时静默检查 `gh` 是否可用以及 `github.com` 是否已有有效登录；只有未登录时，用户点击“连接 GitHub”才会启动 `gh auth login --web --clipboard --git-protocol https` 的官方浏览器授权流程。浏览器会自动打开，设备码会复制到剪贴板，用户无需打开终端查看或手动抄写。

未安装 `gh`、用户取消登录、授权被撤销或网络检查失败时，应用仍可用于本地来源和变更检测，但 GitHub 目标连接、预览与发布不可用，并显示明确的修复入口。easyBlog 不提供会执行 `gh auth logout` 的应用内登出，以免影响同一台机器上的其他 Git 工作流。

首版只支持 `github.com` HTTPS 仓库。仓库列表来自当前 `gh` 账号可推送的 owned、organization 和 collaborator 仓库，优先展示可能的博客仓库但不隐藏其他仓库；私有仓库同样可用。仓库连接后，easyBlog 只会操作其自有工作副本，不会读取或修改用户已有 clone。仓库列表的“重新加载”只重新请求 GitHub，不会触发终端交互或设备码授权；连接仓库时，easyBlog 会调用 `gh auth setup-git`，使托管工作区的 HTTPS Git 操作复用当前 `gh` 登录凭证。

每个 `owner/repo + 默认分支` 只会有一个可被多个同步范围复用的目标。连接时、预览时和发布时，easyBlog 都会 `fetch --prune`；只有本地没有未推送提交且远端可 fast-forward 时才自动更新。发现未推送提交、脏工作区或无法 fast-forward 的历史时会停止并提示恢复，不自动 merge、rebase 或覆盖内容。

连接仓库不等同于识别博客结构。连接完成后目标处于“待配置发布规则”状态，不能绑定范围、预览或发布；easyBlog 不根据目录名猜测适配器，也不创建 `_posts`、资源目录、`.gitkeep` 或配置文件。发布目标配置是独立的后续流程：作者确认博客适配器、文章目录、资源目录和必要的生成规则后，easyBlog 才能验证布局并允许绑定范围。

首版支持 GitHub Pages 与 Astro content collections 两种发布适配器。GitHub Pages 会生成 Front Matter、slug、文章目录和资源目录，并在初始化时写入系统维护的 `.github/easyblog.yml`；Astro 使用 `src/content/posts` 和 `src/assets/easyblog` 作为建议目录，不写入适配器配置文件。适配器建议只用于解释仓库中已发现的布局，作者必须明确选择适配器和目录；保存配置只持久化元数据，绝不写入工作区。

若所选布局缺少目录或适配器配置，easyBlog 会先展示精确的待创建项。作者确认后，应用仅在干净的托管工作区中创建缺失目录和适配器自有配置；不创建 GitHub Actions，也不会在预览或发布过程中隐式初始化。
