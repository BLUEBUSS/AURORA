# 研究引擎来源与边界

AURORA 已完成独立研究主链路提取，当前实现以 runtime/ 为入口。原基线为 fdf117722187597b552b55cd59afce92f60e04df；迁移清单位于 runtime/engine/migration-manifest.json 和 runtime/financial/migration-manifest.json。

| 范围 | 当前实现 |
| --- | --- |
| 前端 | 独立 React 应用，复用研究消息语义和过程展示 |
| HTTP/WS、身份和持久化 | 独立本机会话、用户状态目录和工作区文件边界 |
| Agent | Pi 执行核心，迁入任务计划/进度与研究方法，保留工具及子任务能力 |
| 金融工具 | 适配 financial-agent-tools，来源、许可证和变更记录保留 |
| 模型与数据配置 | 每个用户自己的凭据；禁止作者账户、旧配置兜底 |
| 多渠道与高风险执行 | 不迁入原 OpenClaw 的完整渠道系统，不提供任意 shell 或交易下单 |

现有代码不是原 OpenClaw Gateway 的完整副本，也不承诺已迁入全部 hooks、压缩、多媒体或文件格式处理。公开范围包括工具实现，排除所有个人状态与凭据。

旧兼容开发脚本仍可面向原 Gateway，但不属于独立发行依赖。新用户按 README 使用构建产物启动；干净候选目录验收必须在没有原 ANLYST 配置的情况下运行。
