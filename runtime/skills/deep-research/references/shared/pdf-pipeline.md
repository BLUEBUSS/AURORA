# PDF 渲染管道参考

本文件记录深度研究报告如何接入 minimax-pdf 设计系统并输出专业 PDF。Claude 在需要执行 Step 5 PDF 输出时读取此文件。

---

## 核心管道

````
研究 markdown 报告（内嵌 ```echarts``` 代码块）+ sources.json
    ↓
scripts/research_to_content_json.py  →  content.json
    ↓
scripts/make.sh run  →  cover.pdf + body.pdf  →  merged.pdf
````

---

## 桥接脚本使用

```bash
python3 scripts/research_to_content_json.py \
  --md research_report.md          # 必填：Phase 7 产出的 markdown 报告
  --sources sources.json           # 可选：补充数据来源字符串数组（如 Wind 数据库等非工具来源）
  --out content.json               # 输出路径（默认 content.json）
```

> `--charts charts_data.json` 入参仍向后兼容（旧 md 走 `<!--chart:-->` marker 路径仍可用），但新报告**不再使用**此入参——图表直接内嵌在 md 里即可，详见下方"图表表达方式"。

### sources.json 格式

```json
["同花顺 iFinD 财务数据库", "Alpha派投研知识库", "公司 2023 年报", "Wind 一致预期数据"]
```

---

## PDF 生成命令（机构研报默认）

```bash
bash scripts/make.sh run \
  --title "宁德时代深度研究报告" \
  --type institutional \
  --author "深度研究 Agent" \
  --date "2024年10月" \
  --subtitle "300750.SZ · 个股深度研究" \
  --abstract "动力电池龙头地位稳固..." \
  --content content.json \
  --out report.pdf
```

### 参数速查

| 参数         | 说明               | 示例                                               |
| ------------ | ------------------ | -------------------------------------------------- |
| `--title`    | 封面主标题（必填） | `"宁德时代深度研究报告"`                           |
| `--type`     | 文档类型           | `institutional`（研报默认）/ `report` / `magazine` |
| `--accent`   | 强调色覆盖         | `#003366`                                          |
| `--author`   | 作者/机构          | `"深度研究 Agent"`                                 |
| `--date`     | 日期               | `"2024年10月"`                                     |
| `--subtitle` | 副标题             | `"300750.SZ · 个股深度研究"`                       |
| `--abstract` | 封面核心观点摘要   | `"核心观点..."`                                    |
| `--content`  | content.json 路径  | `content.json`                                     |
| `--out`      | 输出 PDF 路径      | `report.pdf`                                       |

### 文档类型选择

| 类型            | 封面样式                         | 适用场景             |
| --------------- | -------------------------------- | -------------------- |
| `institutional` | 白色背景 + 机构蓝顶条 + 居中排版 | **金融研报默认推荐** |
| `report`        | 深色背景 + 点阵纹理              | 通用报告             |
| `magazine`      | 温暖亚麻色 + 居中排版            | 年报、正式出版物     |
| `darkroom`      | 深海军蓝 + 灰度图片              | 科技/工程类研究      |

---

## content.json Block 类型速查

| Block          | 用途                         | 关键字段                                      |
| -------------- | ---------------------------- | --------------------------------------------- |
| `h1`           | 一级标题（自动编号 `1.`）    | `text`                                        |
| `h2`           | 二级标题（自动编号 `1.1`）   | `text`                                        |
| `h3`           | 三级标题（自动编号 `1.1.1`） | `text`                                        |
| `body`         | 正文段落                     | `text`（支持 `<b>` `<i>`）                    |
| `bullet`       | 无序列表                     | `text`                                        |
| `numbered`     | 有序列表                     | `text`                                        |
| `callout`      | 高亮洞察框                   | `text`, `severity?`                           |
| `table`        | 数据表格                     | `headers`, `rows`, `col_widths?`, `caption?`  |
| `image`        | 内嵌图片                     | `path`/`src`, `caption`                       |
| `figure`       | 带编号图片                   | `path`/`src`, `caption`                       |
| `code`         | 代码块                       | `text`, `language`                            |
| `chart`        | 图表（bar/line/pie）         | `chart_type`, `labels`, `datasets`, `caption` |
| `flowchart`    | 流程图                       | `nodes`, `edges`, `caption`                   |
| `bibliography` | 参考文献                     | `items` [{id, text}], `title`                 |
| `footnote`     | 脚注（B级标注）              | `text`, `id?`                                 |
| `math`         | 数学公式                     | `text`, `label`                               |
| `divider`      | 分隔线                       | —                                             |
| `pagebreak`    | 强制分页                     | —                                             |
| `spacer`       | 垂直留白                     | `pt`                                          |

### Callout Severity 语义

```json
{ "type": "callout", "text": "关键洞察...", "severity": "buy" }
```

| severity           | 语义                     |
| ------------------ | ------------------------ |
| `buy` / `bullish`  | 买入/增持/看涨（红边框） |
| `neutral`          | 中性/持有（橙边框）      |
| `sell` / `bearish` | 减持/卖出/看跌（绿边框） |
| `risk`             | 风险提示（深橙边框）     |
| `highlight`        | 数据高亮（浅黄背景）     |
| 省略               | 一般洞察（机构蓝边框）   |

---

## 图表表达方式

### 默认：md 内嵌 ` ```echarts ``` ` 代码块

把 ECharts option 直接以 fenced code 的形式写在 md 报告对应章节里：

````markdown
## 4.2 三情景估值矩阵

```echarts
{
  "title": {"text": "三情景估值对比"},
  "xAxis": {"data": ["乐观", "基准", "悲观"]},
  "yAxis": [{"name": "元/股"}],
  "series": [
    {"name": "目标价", "type": "bar", "data": [320, 265, 210]}
  ]
}
```
````

桥接脚本会就地把代码块转换成 PDF chart 块（matplotlib 渲染，机构标准6色序列）。**位置 = md 里代码块出现位置**——内嵌写法把"图表数据 + 标题 + 位置"全部固化在 md 里，不存在错位风险。

支持的 ECharts series.type：`bar` | `line` | `pie`（matplotlib 兜底渲染）；mixed bar+line 自动以 bar 为主、line 为副。其它复杂类型（热力图/桑基图/K 线组合等）走下方 PNG 兜底。

图表颜色在 `institutional` 类型下自动使用机构标准6色序列：
`#003366` → `#4472C4` → `#ED7D31` → `#A5A5A5` → `#FFC000` → `#5B9BD5`

### 兜底：ECharts 导出 PNG，md 里 `![caption](path)` 引用

matplotlib 渲染不了的复杂图表（热力图、桑基图、K 线组合等），研究阶段用 ECharts 在浏览器导出 PNG，md 里这样引用：

```markdown
![营收趋势图](images/revenue_chart.png)
```

桥接脚本自动识别 `![caption](path)` 并转为 `figure` 块（带编号图注）。

---

## 环境依赖

首次使用前运行：

```bash
bash scripts/make.sh check   # 检查依赖
bash scripts/make.sh fix     # 自动安装缺失依赖
bash scripts/make.sh demo    # 生成示例 PDF 验证环境
```

| 依赖                  | 用途                 | 安装方式                                                       |
| --------------------- | -------------------- | -------------------------------------------------------------- |
| Python 3.9+           | 所有 .py 脚本        | 系统自带                                                       |
| reportlab             | 正文 PDF 渲染        | `pip install reportlab`                                        |
| pypdf                 | 合并/填充            | `pip install pypdf`                                            |
| matplotlib            | chart/math/flowchart | `pip install matplotlib`                                       |
| Node.js 18+           | 封面渲染             | 系统自带                                                       |
| Playwright + Chromium | 封面 HTML→PDF        | `npm install -g playwright && npx playwright install chromium` |

---

## 快速验证命令

```bash
# 仅生成 content.json（不渲染 PDF）
python3 scripts/research_to_content_json.py --md report.md --out content.json

# 使用已有 content.json 直接生成 PDF
bash scripts/make.sh run --content content.json --title "Test" --out test.pdf

# 将任意 markdown 转为 PDF（不经过桥接，适合简单文档）
bash scripts/make.sh reformat --input doc.md --title "Doc" --out doc.pdf
```
