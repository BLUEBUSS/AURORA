# AURORA

独立的 AI 投研工作台前端。**研究主链路已连接现有 ANLYST Gateway，并完成真实模型、工具、附件、停止与刷新恢复验证**。复用原版聊天内核与过程展示；其他管理页仍处在分阶段迁移中，未宣称整个 V1 已完成。

发行目标为前后端及 Agent 编排开源、用户自行配置模型 API Key（BYOK）。独立安装和首次模型配置尚待实现；下面的启动方式仍用于现有本地开发环境。准备路线见 [开源与用户自带模型方案](docs/open-source-release-plan.md)。

2026-09-25 已完成第一轮发布审查及 7 类前端缺陷修复，最终 320 项单测、32 项浏览器回归通过。**完整产品暂不发布**：拟复用后端的认证/文件边界、依赖整理、独立 runtime 与 BYOK 仍有阻断项。详见 [检查记录](docs/pre-release-audit-2026-09-25.md) 和 [发布清单](docs/release-checklist.md)。

## 本地启动

当前验证工具链为 Node 24、pnpm 11.19.0；最低 Node 22.13。

新增独立本机服务基础：`pnpm build` 后运行 `pnpm start`，由 Node 同源提供页面与文件 API，使用自己的空白状态目录。**研究引擎尚未迁入此入口**，当前真实研究仍走下述开发兼容模式。见 [本机服务实施记录](docs/runtime-foundation.md)。

```powershell
pnpm install --frozen-lockfile
powershell -ExecutionPolicy Bypass -File scripts/start-local.ps1
```

访问 http://127.0.0.1:5174/ 。启动脚本复用已有后端运行配置，并启动或复用前后端；设计预览可传 `-FrontendOnly`，`pnpm dev` 也只启动前端。`scripts/stop-local.ps1` 只停止本项目前端；`scripts/stop-backend.ps1` 单独核对身份后停止本项目管理的 Gateway。

首次打开会尝试连接已有研究后端，读取会话和模型，不自动发送研究问题。手动选择本地演示后会记住选择，可在「账户与连接」中切回真实连接。当前本机沿用旧环境的 anonymous/main 身份，未改认证配置。页面上方「已连接」表示 WebSocket 握手成功。

最新界面修订：左侧按「项目 / 聊天」分区，项目内会话缩进；左下角打开快捷菜单，可进入文件、报告、自选、提醒及项目管理。点击菜单内的「设置」后，按「常规 / 账户与连接 / 演示检查」分类配置；顶部连接状态可直达账户与连接。新建研究页提供六个美股与 AI 产业链案例问题，点击只填入草稿。后续以复用 ANLYST 成熟交互为主，迁移路线见 `docs/interaction-reuse-plan.md`。

聊天区历史线程采用纯文字，项目区保留公司 Logo；模式与模型使用主题浮层菜单。点击日月按钮可体验圆形揭幕切换，系统减少动效偏好会自动关闭此动画。

## 已可操作

- 真实研究：模型绑定/锁定、发送、首事件等待、思考/任务/工具/子任务过程、流式正文、停止、历史和中途刷新恢复。深度研究复用原 skill marker；文本附件真实上传，研究内可只读查看本次附件。
- 原生来源引用：解析 `[[p_xxxx]]` 与字段引用，点击调用原 provenance.resolve/fetchData；此界面与RPC经过夹具测试，金融数据源本身仍需逐项核验。
- 研究组织：切换/搜索/置顶/项目归属，以及本地项目管理；会话重命名和归档的服务端同步尚未完成。
- 项目：创建/重命名/删除分组、归入/移出会话、关联文件。删除项目保留研究内容。
- 文件：文件夹浏览、内容搜索、Markdown/TXT/CSV/JSON 导入（500 KB 上限）、新建/编辑/删除/下载、带入当前研究。
- 报告：列表和主区域阅读、编辑、Markdown 下载、浏览器打印/另存 PDF。Word 导出、批注和分享尚未迁移。
- 自选：按分组查看、添加/移除、发起研究；公司股票和交易合约分开标识，不伪造实时报价。
- 提醒：本地创建/编辑/启停/删除规则；**没有真实调度或通知**。
- 日间「明晰工作台」/夜间「曜黑香槟」、默认跟随系统、手动主题记忆、双分隔线拖动/键盘调整、手机抽屉和基本对话。

文件/报告/自选/提醒管理的上述操作当前主要在演示模式可用，实时模式不会混入示例数据；完整工作区、图表、Word/批注/分享及提醒调度仍待后续迁移。演示通过同一个消息内核重放测试事件，明确标示预设内容，不分析实际问题或附件。

演示数据保存在 `aurora-demo-v1`；真实历史由后端提供。当前标签页会暂存尚在执行的问题及运行标识，以补上后端尚未写入历史时的刷新窗口，确认终态后清除；不保存认证 token。未发出的中断请求恢复到草稿，发送结果不确定时不会自动重发。

## 现有研究后端

开发代理默认指向 `http://127.0.0.1:18789`。可通过启动 Vite 前设置 `AURORA_BACKEND_URL` 更改目标。凭据不写入仓库、不放入构建、不存 localStorage。

设置中的连接入口已实现 bootstrap、既有登录/退出、协议 3 WebSocket、会话与模型读取。2026-09-24 实际使用原本地环境完成模型回复、task_create/read/task_update、附件标记读取、停止确认和已接收运行的刷新恢复。未验证生产域名与多用户账号流程，详见 `docs/backend-acceptance.md`。

项目映射按用户/Agent 分开保存到 `aurora-live-projects-v2:<user>:<agent>`。旧映射只迁移能够判定归属的项目；无归属的旧项目保留原数据，可在账户设置中显式导入。尚未完成跨 origin 和全量历史迁移验收。模型与数据源配置仍由现有后端管理。

## 验证

```powershell
pnpm check:source
pnpm test:release
pnpm typecheck
pnpm lint
pnpm test
pnpm test:runtime
pnpm build
pnpm audit --audit-level=moderate
pnpm exec playwright install chromium
pnpm test:e2e
```

浏览器测试使用独立临时上下文，不操作用户的既有会话。截图和报告在 `artifacts/`（Git 忽略）。生产构建在 `dist/`。`pnpm preview` 仅用于静态演示预览；真实后端代理目前由开发服务器提供，正式部署仍需配置等价同源代理。

代码组织、来源和后续检查点见 `docs/implementation-status.md`、`docs/backend-contracts.md` 与 `docs/design-qa.md`。
