# AURORA

本机运行的 AI 投研工作台，聚焦美股公司、AI 产业链与相关交易合约。采用 MIT 许可证，公开前后端、Agent 编排和数据工具适配代码；模型与需要认证的数据源均由用户自行配置 API Key。

**当前为 Alpha 源码预览。** 研究主链路已经可以运行，部分管理页面仍为演示或待接入；请按下方能力边界使用。没有交易下单能力。

## 安装与启动

需要 Node.js 22.13 或更高版本（当前本机验证版本为 Node 24），以及 pnpm 11.19.0。首批本机验收目标为 Windows；其他平台以 CI 与实际验收结果为准。

```sh
git clone https://github.com/BLUEBUSS/AURORA.git
cd AURORA
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

打开 http://127.0.0.1:5174/ 。程序同时提供前端、HTTP 与 WebSocket，不需要安装相邻 ANLYST 项目。仓库尚为私有时，需要仓库访问权限才能克隆。

Windows 构建完成后，也可运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/start-aurora.ps1
```

该脚本在后台启动服务并打开默认浏览器，重复运行会复用当前项目的服务。端口被其他程序占用时提示错误，不强制结束进程。加 `-NoBrowser` 可只启动服务。后台服务不会因关闭浏览器而退出。

可更改端口与数据目录：

```sh
pnpm start --port 5175 --state-dir .aurora-state
```

## 第一次配置

1. 在「设置 → 模型」填写协议、Base URL、模型 ID 和自己的 API Key，点击「测试并保存」。支持 OpenAI 兼容 Chat Completions、OpenAI Responses、Anthropic Messages；目前真实供应商验收覆盖 Kimi Chat Completions，不代表所有兼容服务均已验证。
2. 在「设置 → 数据源」按需配置 SEC、EODHD、Alpha Vantage、FRED。SEC 使用应用名称和联系邮箱；其他三项使用自己的 API Key/Token。展开卡片可访问官方申请说明。
3. 数据源先保存，再点击「测试已保存配置」。保存不发起网络请求，测试可能消耗账户额度。停用保留凭据，移除删除凭据；配置变更在下一轮研究生效。
4. 返回研究页开始提问。官方 Kimi 服务可沿用用户自己的模型 Key 进行联网检索；无需认证的公开数据接口不要求额外 Key。

未配置的服务会说明限制，不会调用作者账户或寻找旧 Key。模型 Key 与行情、宏观数据 Key 属于不同账户。已有研究保留模型绑定，更换模型后应新建会话。

## 当前能力

| 范围 | Alpha 状态 |
| --- | --- |
| 研究对话 | 真实模型、流式回答、任务计划、工具执行、子任务、停止、历史恢复 |
| 研究资料 | 文本附件读取、Markdown 报告生成与阅读、来源引用 |
| 会话 | 重命名、归档/恢复由后端持久化；项目分组和置顶仍为浏览器本地元数据 |
| 模型与数据源 | 用户凭据配置、保存、测试、停用/移除和重启恢复 |
| 联网检索 | 官方 Kimi 搜索已在线验证；其他搜索供应商尚未接入 |
| 金融数据 | SEC、美股历史行情、FRED 和加密/股票类永续工具已注册；具体权限、网络和数据覆盖需用户逐项验证 |
| 展示 | 日夜主题、可调整三栏、公司标识、桌面完整布局与手机基本阅读/对话 |

**尚未完成：** 完整文件/报告管理、自选与提醒调度、复杂图表、多媒体、Word/PDF 管线、批注、分享、正式安装器和升级工具。演示模式中的自选、提醒与示例资料不代表真实后端调度。美股行情当前为历史日/周/月数据，不代表实时行情；加密期权不等于美股个股期权链。

## 数据、凭据与安全

默认用户状态目录：Windows `%LOCALAPPDATA%/Aurora`；macOS 当前用户的 `Library/Application Support/Aurora`；Linux 的 XDG 数据目录下 `aurora`。可用 `AURORA_STATE_DIR` 或 `--state-dir` 更改。程序不读取旧 Antlyst/OpenClaw 的个人配置和会话。

Windows 使用当前用户 DPAPI 保护凭据，其他平台使用受限权限文件；Key 不回显，不写入浏览器持久化。不要上传状态目录、个人研究、日志和备份。仓库、安装包和 CI 均不应携带真实凭据。

本机运行不等于模型在本机推理：配置远程模型后，研究问题、附件和选入上下文的工具结果会发送给所选模型服务。数据工具请求会发给对应供应商。默认只监听回环地址；这是单用户本机应用，不可直接作为公开多租户网站部署。详见 [安全边界](SECURITY.md)。

## 开发、更新与故障排查

- `pnpm dev` 是旧后端兼容开发入口，默认代理到18789；不是独立安装的启动命令。独立应用使用 `pnpm build` / `pnpm start`。
- 更新前停止研究并关闭服务，备份用户状态目录，再拉取源码、安装冻结依赖、重新构建和启动。Alpha 暂不保证跨版本状态迁移；请保留旧版本及对应数据备份。
- 前台运行用 Ctrl+C 结束服务；Windows 后台启动的进程记录位于项目 `.runtime/independent-runtime.json`。结束前核对 PID、创建时间和项目路径，不要批量终止 Node 进程。
- 卸载源码和依赖不会自动删除用户状态。只有确认无需保留时才删除自己的状态目录，避免丢失研究记录和凭据。
- 端口占用：更换端口或关闭确认属于本项目的服务。模型不支持工具调用、供应商限流或网络不可达时，请核对设置中的错误；不要把演示输出视为真实数据。

## 检查

```sh
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

自动测试使用隔离状态及合成凭据，不消耗真实模型额度；真实供应商验收另行记录。检查流程覆盖前后端与浏览器，但扫描通过不代表不存在所有漏洞。

## 来源与许可证

AURORA 采用 [MIT](LICENSE)。它复用 Pi Agent 核心及来自 ANLYST/OpenClaw、financial-agent-tools 的部分实现；第三方版权与许可证保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。公司标识仅用于识别研究对象，不表示赞助或合作。

当前验收记录见 [引擎与数据源验收](docs/engine-byok-acceptance.md)；发布进度见 [发布清单](docs/release-checklist.md)。
