# 数据源配置与验收

本清单按当前独立 runtime 注册情况核对，不将源文件存在、已注册、已配置和在线验证混为一谈。首批 SEC、EODHD、Alpha Vantage、FRED 的设置入口、私有存储、连接测试和研究注入已实现。真实付费数据与 SEC 在线验收仍需要用户自行提供凭据。

## 当前工具

| 工具 | 当前接入情况 |
| --- | --- |
| web_search | 官方 Kimi 地址可复用当前用户模型 Key；已在线验证搜索、Agent 调用与来源引用 |
| us_equity_filings / us_equity_fundamentals | SEC 公告及 XBRL 财务；已有联系标识入口，当前用户尚未填写 |
| us_equity_market_data | EODHD / Alpha Vantage 适配器已实现，支持日/周/月 OHLCV；设置与运行时注入已接通，等待用户配置并在线验收；不代表实时美股行情 |
| macro_indicator_data | FRED 适配器已实现，含 CPI、就业、GDP、利率等 12 类指标；设置与 Key 注入已接通，等待用户配置并在线验收 |
| tradfi_perpetual_data | Binance 股票等 TradFi 永续的品种识别、行情、衍生指标和微观结构；使用公开接口，尚未逐项在线验收，且不执行交易 |
| crypto_market_data / crypto_derivatives_data | Binance、Bybit、Deribit 等公开行情与衍生指标路由；Coinalyze 增强源需用户 Key，尚无配置入口 |
| crypto_options_data | Deribit 加密期权适配；不是美股个股期权链 |
| crypto_defi_data | DefiLlama DeFi 数据适配 |
| crypto_asset_data / crypto_sentiment_data | CoinPaprika、Alternative.me、DEX Screener 等公开数据；CoinGecko 增强源需用户 Key |

其中 11 个金融工具已注册，web_search 满足官方 Kimi 配置时另行注册。除注明的搜索实测，不能将其余公开工具统一标为在线验收通过。DEX 与链上工具虽有底层代码，目前不在独立 Agent 注册列表；美股个股期权和清算热力图也不应宣称已支持。

## 已实现的首批流程

1. 新增「设置 → 数据源」，与模型配置分开。首批接入 SEC、EODHD、Alpha Vantage、FRED；把已有 SEC 配置兼容迁入，不能丢失原值。保留 Kimi 搜索随模型凭据使用的明确说明。
2. 每个数据源提供官方申请链接、所支持的工具、凭据输入、显式保存与连接测试、停用/移除。未配置、已配置待验证、最近验证成功、权限不足、限流、网络失败分别呈现；成功状态带时间，不能保证以后每次调用可用。
3. 后端新增独立数据源凭据存储，复用本地秘密保护和路径边界。GET 只返回是否已配置等元数据；留空保留、显式移除。配置修改与研究执行互斥，防止一轮研究中途更换凭据。
4. 将用户设置转换为白名单配置传入现有 provider 工厂；禁止继承开发者全部 process.env。EODHD / Alpha Vantage 回退仅限用户同时配置的服务，并保留来源切换说明。
5. data_capability_status 改为逐项从实际注册工具和用户配置产生。向模型传递能力状态，不传密钥。公开来源保持可用，无需人为增加注册门槛。
6. 测试空白安装、有效/错误 Key、供应商权限、限流、撤销、重启恢复、跨供应商凭据隔离、日志与响应脱敏。上线前做真实数据验收；额度和实时性由用户账户授权决定。

第二批再接 CoinGecko、Coinalyze，以及用户可配置的网络代理和更多搜索供应商。行情与宏观首批完成前，不扩展大量低优先级数据源。

## 官方资料

- SEC 数据 API：https://www.sec.gov/search-filings/edgar-application-programming-interfaces
- SEC 自动访问规范：https://www.sec.gov/about/developer-resources
- FRED 用户自带 API Key：https://fred.stlouisfed.org/docs/api/api_key.html
- EODHD API：https://eodhd.com/financial-apis/
- Alpha Vantage 申请入口：https://www.alphavantage.co/support/#api-key
- Kimi 搜索接口：https://platform.kimi.com/docs/api/tools-search
