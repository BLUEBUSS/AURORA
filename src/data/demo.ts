import type {
  Company,
  Message,
  Project,
  ResearchFile,
  Session,
  Source,
  WatchItem,
  Reminder,
} from "../types";
export const companies: Company[] = [
  { ticker: "NVDA", name: "NVIDIA", logo: "/logos/nvidia.svg", color: "#76b900" },
  { ticker: "AMD", name: "AMD", logo: "/logos/amd.svg", color: "#c74a4a" },
  { ticker: "TSM", name: "TSMC", color: "#ba4d4d" },
  { ticker: "AVGO", name: "Broadcom", color: "#cf3551" },
  { ticker: "MSFT", name: "Microsoft", color: "#2676b7" },
  { ticker: "MRVL", name: "Marvell", color: "#bd4343" },
  { ticker: "AMZN", name: "Amazon", color: "#b8832c" },
];
export function inferCompany(text: string): Company | undefined {
  const aliases: Record<string, string> = { NVDA: "英伟达", TSM: "台积电" };
  const matched = companies.filter(
    (c) =>
      new RegExp(`\\b${c.ticker}\\b|${c.name}`, "i").test(text) ||
      (aliases[c.ticker] && text.includes(aliases[c.ticker])),
  );
  // A comparison must not inherit the identity of whichever company matched first.
  return matched.length === 1 ? matched[0] : undefined;
}
export const sampleSources: Source[] = [
  {
    id: "nv-ir",
    title: "NVIDIA Investor Relations",
    publisher: "NVIDIA · 官方投资者关系",
    url: "https://investor.nvidia.com/",
    kind: "filing",
  },
  {
    id: "sec",
    title: "公司披露与财务报告",
    publisher: "SEC · EDGAR",
    url: "https://www.sec.gov/edgar/search/",
    kind: "filing",
  },
  {
    id: "tsm-ir",
    title: "TSMC Investor Relations",
    publisher: "TSMC · 官方投资者关系",
    url: "https://investor.tsmc.com/english",
    kind: "web",
  },
];
export const sampleReport = `# 从算力需求，到兑现的利润

**研究框架示例 · 未调用模型或获取实时市场数据。**

## 核心判断

对 AI 产业链的研究，关键在于区分 **需求增长、供给约束与利润兑现**。单纯的资本开支扩张，并不能直接回答某家公司的盈利是否具有持续性。

我们把 NVIDIA 的研究拆成三个可以持续验证的问题，逐一寻找证据与反证。

### 01　需求：谁在为算力付费？

跟踪云服务商资本开支、客户集中度与推理负载变化。将预算、订单、交付和实际收入分开记录，避免把远期意向当作已实现收入。

### 02　供给：瓶颈在哪里转移？

联合观察先进封装、HBM、网络与电力配套。**某个环节的扩产，可能缓解约束，也可能改变产业链的利润分配。**

### 03　定价：什么已经被市场计入？

把收入、利润率、估值倍数拆开建立情景。每一个关键假设都需要对应数据时间、来源和下一次验证节点。

| 研究维度 | 下一步验证 | 可能的反证 |
| --- | --- | --- |
| 需求持续性 | 资本开支与客户收入转化 | 开支增长而利用率走弱 |
| 供给约束 | 交付周期与产能释放 | 库存上升、交期缩短 |
| 利润质量 | 毛利率、现金流与应收 | 增收未带来现金回收 |

## 跟踪清单

- 阅读最新季度披露，并核对数据期间。
- 对照上一次研究记录，标记事实变化和假设变化。
- 为关键观点寻找反证，保留尚未确认的信息。

> 公司股票与交易合约分开研究。合约是表达观点的工具，其价格、资金费率和交易时间并不等于标的股票。

本页为交互演示内容；右侧链接仅作为官方资料入口，未在本轮抓取或验证。`;
const now = Date.now();
export const seedProjects: Project[] = [
  {
    id: "ai-compute",
    name: "AI 算力产业链",
    description: "芯片、存储、先进封装与算力基础设施",
    createdAt: now,
  },
  {
    id: "future-industry",
    name: "未来产业观察",
    description: "跟踪技术变革与产业价值转移",
    createdAt: now - 86400000,
  },
];
const sampleAssistant: Message = {
  id: "sample-answer",
  role: "assistant",
  text: sampleReport,
  time: now - 300000,
  phase: "completed",
  sources: sampleSources,
  fileIds: ["nvda-report"],
  steps: [
    {
      id: "step1",
      title: "整理研究问题",
      detail: "拆分需求、供给与定价三个验证方向。",
      status: "done",
    },
    {
      id: "step2",
      title: "组织参考资料",
      detail: "示例官方资料入口，未进行在线检索。",
      status: "done",
    },
    {
      id: "step3",
      title: "生成研究框架",
      detail: "演示内容用于检查阅读、来源和文件交互。",
      status: "done",
    },
  ],
};
export const seedSessions: Session[] = [
  {
    id: "demo-nvda",
    title: "NVDA 的增长，如何继续兑现？",
    company: companies[0],
    projectId: "ai-compute",
    updatedAt: now,
    origin: "demo",
    pinned: true,
    messages: [
      {
        id: "q1",
        role: "user",
        text: "从需求、供给和市场定价三个角度，梳理 NVIDIA 的研究框架，重点关注哪些假设值得持续验证。",
        time: now - 360000,
      },
      sampleAssistant,
    ],
  },
  {
    id: "demo-amd",
    title: "AMD：竞争格局与产品路线",
    company: companies[1],
    projectId: "ai-compute",
    updatedAt: now - 86400000,
    origin: "demo",
    messages: [
      { id: "q2", role: "user", text: "先建立 AMD 数据中心业务的研究清单。", time: now - 86400000 },
      {
        id: "a2",
        role: "assistant",
        text: "# AMD：从产品竞争走向盈利验证\n\n**研究提纲示例。**\n\n## 需要回答的问题\n\n1. 数据中心业务增长来自哪些客户与产品？\n2. 软件生态、总拥有成本与交付能力如何影响客户选择？\n3. 新产品对毛利率与现金流的贡献何时体现？\n\n后续应从公司最新披露和客户验证出发，逐项补充证据。",
        time: now - 86400000,
        phase: "completed",
        sources: [],
        steps: [],
      },
    ],
  },
  {
    id: "demo-hbm",
    title: "HBM 与先进封装的供给约束",
    projectId: "ai-compute",
    updatedAt: now - 172800000,
    origin: "demo",
    messages: [
      { id: "q3", role: "user", text: "建立 HBM 与先进封装的跟踪框架。", time: now - 172800000 },
      {
        id: "a3",
        role: "assistant",
        text: "# 供给约束的传导路径\n\n**研究提纲示例。**\n\n## 三个观察维度\n\n- **产能与良率：** 区分规划产能和实际可交付产能。\n- **客户认证：** 关注产品代际与认证周期的差异。\n- **价值分配：** 跟踪瓶颈环节的议价能力是否延续。\n\n具体结论需要补充当期公开披露，当前没有实时数据。",
        time: now - 172800000,
        phase: "completed",
        sources: [],
        steps: [],
      },
    ],
  },
];
export const seedFiles: ResearchFile[] = [
  {
    id: "nvda-report",
    name: "NVIDIA · 研究框架.md",
    folder: "AI 算力产业链/研究报告",
    content: sampleReport,
    kind: "markdown",
    report: true,
    projectId: "ai-compute",
    sessionId: "demo-nvda",
    updatedAt: now,
  },
  {
    id: "supply-notes",
    name: "产业链观察笔记.md",
    folder: "AI 算力产业链/研究笔记",
    kind: "markdown",
    content:
      "# 产业链观察\n\n## 研究记录模板\n\n| 日期 | 事实 | 来源 | 对观点的影响 |\n| --- | --- | --- | --- |\n| 待补充 | 待验证 | 待引用 | 待评估 |\n\n## 待验证\n\n- HBM 扩产进度\n- 先进封装交付周期\n- 云服务商资本开支",
    projectId: "ai-compute",
    updatedAt: now - 86400000,
  },
  {
    id: "thesis-note",
    name: "研究方法.md",
    folder: "未来产业观察",
    kind: "markdown",
    content:
      "# 研究方法\n\n## 先写清楚问题\n\n把事实、推断和待验证催化分开。每次更新时，同时检查支持证据和反证。\n\n## 再安排验证\n\n记录来源、数据期间和下一次检查节点。",
    projectId: "future-industry",
    updatedAt: now - 172800000,
  },
];
export const seedWatchlist: WatchItem[] = companies.slice(0, 4).map((company, i) => ({
  id: `watch-${i}`,
  company,
  type: "equity",
  venue: "NASDAQ / NYSE",
  group: i < 2 ? "算力芯片" : "基础设施",
  note: i === 0 ? "跟踪需求、供给与利润兑现" : "",
}));
export const seedReminders: Reminder[] = [
  {
    id: "reminder-demo",
    name: "AI 产业链周度复盘",
    prompt: "梳理本周新增证据、反证与研究观点的变化。",
    schedule: "每周五 18:00",
    enabled: false,
    createdAt: now,
  },
];
