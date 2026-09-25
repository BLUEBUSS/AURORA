// Adapted from ANLYST WelcomeScreen's tag/title/description/meta/text card model.
// These are editable research questions, not completed reports or verified market claims.
export const researchExamples = [
  {
    id: "nvda",
    category: "公司深研",
    ticker: "NVDA",
    company: "NVIDIA",
    title: "算力增长，如何兑现为利润？",
    description: "拆开需求、供给和市场预期，找出值得持续验证的核心假设。",
    tags: ["增长质量", "核心假设", "反证清单"],
    prompt:
      "对 NVIDIA（NVDA）做一份公司研究：以最新公开披露为起点，拆解数据中心需求、产品组合、供给约束与利润兑现。把已验证事实、研究推断和待验证事项分开，列出核心假设及其反证，并说明当前市场预期可能计入了什么。给出资料来源与数据期间；获取不到的数据明确标注，不用估计值冒充事实。",
  },
  {
    id: "custom-compute",
    category: "竞争格局",
    ticker: "AVGO · MRVL",
    company: "Broadcom / Marvell",
    title: "定制芯片，价值落在哪一环？",
    description: "对照客户、产品和盈利模式，梳理 ASIC 与互联业务的差异。",
    tags: ["客户结构", "价值分配", "同业比较"],
    prompt:
      "比较 Broadcom（AVGO）与 Marvell（MRVL）在 AI 定制芯片和互联业务中的定位。以正式披露为依据，区分已确认客户、市场推测和未来指引；对比产品组合、收入确认、客户集中度与盈利模式。输出同口径比较表、关键分歧及后续需要核验的证据。不要将 ASIC 与 GPU 简化为互相替代。",
  },
  {
    id: "supply-chain",
    category: "产业链",
    ticker: "AI INFRA",
    company: "算力基础设施",
    title: "下一处瓶颈，会在哪里？",
    description: "沿着 HBM、先进封装、网络与电力，追踪供给约束与利润传导。",
    tags: ["供给约束", "产能验证", "利润传导"],
    prompt:
      "建立 AI 算力基础设施的瓶颈研究框架，覆盖 HBM、先进封装、网络、散热与电力配套。区分名义产能、实际交付能力与客户认证；梳理各环节约束如何影响下游交付、价格与利润。列出美股可研究公司、证据等级、潜在反证和下次验证节点。尚未取得的实时数据保留为待核验项。",
  },
  {
    id: "capex",
    category: "财报研究",
    ticker: "MSFT · AMZN",
    company: "云服务与资本开支",
    title: "资本开支，何时变成回报？",
    description: "把投入、利用率、增长与现金流连起来，检验投资回收逻辑。",
    tags: ["资本开支", "现金流", "回报周期"],
    prompt:
      "围绕 Microsoft（MSFT）和 Amazon（AMZN）的 AI 基础设施投入，对照最新财报研究资本开支、折旧、云业务增长与自由现金流。统一数据期间与可比口径，区分管理层指引和已实现结果。列出投资回收逻辑、尚未披露的数据、市场分歧，以及会推翻现有判断的迹象。",
  },
  {
    id: "valuation",
    category: "估值情景",
    ticker: "NVDA · AMD",
    company: "算力芯片",
    title: "好公司，对应怎样的预期？",
    description: "分开收入、利润率和估值假设，建立可追溯的情景比较。",
    tags: ["情景分析", "敏感性", "预期差"],
    prompt:
      "为 NVIDIA（NVDA）与 AMD 建立可比较的估值研究框架。将收入增长、利润率、资本投入和估值倍数拆开，区分数据事实与主观假设；用审慎、中性、乐观三种情景展示敏感性。若没有可靠的当前行情或一致预期，不计算伪精确的上行空间，而列出需要补齐的数据与来源。",
  },
  {
    id: "equity-contract",
    category: "研究到交易",
    ticker: "EQUITY / PERP",
    company: "公司与交易工具",
    title: "公司判断，如何映射到合约？",
    description: "将股票研究与合约机制分开，核对价格、资金费率和交易时段。",
    tags: ["公司逻辑", "合约机制", "事件窗口"],
    prompt:
      "以我指定的一家美股公司为研究对象，先整理公司基本面、核心催化与观点失效条件，再单独梳理对应股票挂钩合约的标的映射、交易时间、报价机制、资金费率和流动性风险。明确公司股票价格不等于合约报价；未指定或未核验的合约不要假定存在。输出需要逐项确认的清单，不执行交易。",
  },
];
