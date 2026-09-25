# ANLYST 交互复用路线

2026-09-23 用户反馈后的路线纠正：保留 AURORA 独立项目、黑金/日间主题与已确认布局，优先提取现有 ANLYST 前端交互代码。当前 demo 简化了大量原版能力，不能把缺失都归因于后端未连接。

## 当前差距（已读代码核实）

当前 `src/state/demo-runner.ts` 以定时截取预设文本演示输出；`src/state/research.ts` 只消费基础 chat 和工具事件；`Message` 只有正文、步骤与阶段。原版包含 thinking、assistant、lifecycle、task_update、轮次/分段、子 Agent 和历史重放，单纯更换动画或连接 API 不能补齐这些行为。

源目录：ANLYST 的 `packages/fin-core-react/src`，基线 main `fdf117722187597b552b55cd59afce92f60e04df`。原工作区只读。

## 下一检查点：恢复一个完整研究流程

### 1. 提取原版消息与事件处理

一起迁入 `stores/chat.types.ts`、`chat.reducer.ts`、reducer.parts/task-reducer/ops/selectors，以及 `services/translators/live.ts` 和 `history.ts` 的依赖闭包。实时与历史必须使用一致的结构，不能只迁一条路径。保留原来的累计文本、重发去重、独立 block 合并和轮次隔离。

优先复用原有 reducer、实时/历史文字一致性、工具幂等、会话归属测试。超过 700 行的旧文件按纯职责拆分后进入独立项目，不保留跨仓库运行时引用。

### 2. 迁入原版研究展示组件，再换主题

- `TypingIndicator` 与配套动画：发出首个事件前的等待状态。
- `ThinkingCard` / `ReasonHeader` / `ShimmerText`：思考进行、完成折叠和失败。
- `RoundBlock`：计划前思考、任务、报告思考、结论的编排规则。
- `TaskPanel` / `RightTimelinePanel` 与 segments：阶段、工具批次、展开详情与子 Agent。
- `MarkdownRenderer`：沿用流式防抖/maxWait、未闭合图表占位、引用交互；K 线契约在独立项目本地化。

CheckpointBlock 依赖旧全局发送处理器，需改为回调适配。原 translator 未完整包含 provenance patch/usage，必须单独核对。避免直接复制旧的 2000 行事件处理器和大 store，导致两套状态机制并存。

### 3. 同一链路接真实后端验收

按顺序验证：发起研究 → 首事件等待 → 思考/工具/任务更新 → 流式正文 → 停止或完成 → 刷新恢复 → 来源/生成文件。继续保留 AURORA 的运行中草稿、圆形停止键和面板宽度行为。

演示也改为向同一事件处理链重放已脱敏的测试事件；演示与真实连接只替换数据来源，避免继续维护一套功能缩水的独立模拟界面。

## 后续范围

上述完整研究流程通过用户检查后，再沿用原版 workspace/报告导出/批注/分享、自选和提醒的服务与交互，逐页替换视觉。图表与文件预览既有功能优先迁移。此轮不新增交易下单、行情接入或后端业务。

## 本次已落实的界面修订

1. 五类工作区管理入口统一进入左下角快捷菜单，设置另设分类面板；侧栏按项目和独立聊天分层。
2. 新建研究展示 6 个可编辑的案例问题，覆盖公司深研、竞争格局、产业链、财报、估值、股票与合约。每次展示 3 个，不自动滚动；已有草稿替换前确认。
3. 统一 AURORA 字标为本地打包的衬线排版，正文字体保持已确认规范。

下一步优先实施上面的完整研究流程迁移，不继续扩充当前 demo 的独立聊天实现。

