# 后端适配边界

核对来源：ANLYST main `fdf117722187597b552b55cd59afce92f60e04df` 的 `packages/fin-core-react/src/services/websocket.ts`、`api.ts`、`session.ts`，`src/gateway/protocol/schema/logs-chat.ts` 与 `extensions/fin-core/index.ts`、`http-files.ts`。新项目实现位于 `src/services/`，不运行或导入原前端源码。

## 已实现适配

- `GET /fin-core/api/bootstrap`：读取当前用户和 agent 映射；transport 私有保存 gatewayToken，UI 不获得 token。
- `POST /fin-core/backend/auth/login-password`：username/password；`POST /fin-core/backend/auth/logout`。使用现有同源 Cookie，不持久化密码。
- 固定 WS `/fin-core/ws`，Vite 代理 rewrite 为 `/fin-core`。等待 `connect.challenge`，第一帧为 protocol 3 `connect`，等待 `hello-ok` 后才发送业务请求。
- `sessions.list`、`models.list`、`chat.history`、`sessions.patch`、`chat.send`、`chat.abort`。
- chat 三个方法不注入 agentId。新会话保留既有 key 结构：`agent:<agentId>:webuser:<userId>:antlyst-<unique>`。
- 只接受当前 active run 的 sessionKey/runId 与递增 seq；停止成功 acknowledgement 或终态后不再让迟到事件覆盖该轮。断开时明确标记任务状态尚未确认，不自动重试发送。

## 管理页与文件契约

- workspace RPC：`fin-core.workspace.list/readFile/writeFile`，按后端鉴权传入 agentId/path。真实文件上传还需既有 upload 端点及附件权限核对。
- `GET /fin-core/backend/files?agent=...`；`POST /fin-core/backend/upload` 原始 bytes / X-Filename。真实研究的文本附件上传与模型读取已验证，完整文件管理页仍待接入。工作区另有 `/fin-core/workspace-api/upload`，其文件名边界缺陷列入发布修复清单。
- `fin-core.watchlist.list` 返回 symbols/topics；现有 remove 系列 RPC 可用，未发现通用 add RPC。不能虚构 add API，新建需复用 Agent 工具或另行确认。
- `cron.list/update/remove`：须使用后端真实规则、时区、权限和调度状态，不能把 demo 的 schedule 描述直接当作 cron 表达式提交。

## 验证等级

2026-09-24 已有真实 Gateway/model 回复、任务/工具、附件、停止与刷新恢复证据，见 `backend-acceptance.md`。客户端单测与浏览器 protocol fixture 另行验证流式、停止和恢复边界。2026-09-25 发布审查发现 HTTP 调试认证绕过及 workspace 上传路径问题；独立安装、BYOK、正式身份/Origin、长历史、复杂工具/图表及全量管理页仍须验收，见 `pre-release-audit-2026-09-25.md`。

生产构建需要部署服务器提供同源 HTTP/WS 代理。Vite preview 不承担该代理，也没有新增代理服务或弱化后端安全设置。
