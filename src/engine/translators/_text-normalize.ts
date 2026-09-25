// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Translator 共享文本 normalize 工具集。
 *
 * 入口：
 *   - stripReasoningFormat：剥 `Reasoning:` 包装 + `_italic_` 标记 + 压缩空行（thinking 流必跑）
 *   - sanitizeNarrationText：剥 provenance token + 推理标签字面字符串 + 折叠空白（narration 流必跑）
 *
 * S4.5-T 起 subagent 内部翻译入口同时调用两者，顺序固定为 `sanitizeNarrationText(stripReasoningFormat(raw))`：
 *   1. strip 先去 wrapper，让 sanitize 看到的是裸 content
 *   2. 两步均 idempotent，调用顺序对最终 output 无影响（保留固定顺序便于日后回溯）
 */

/**
 * Backend thinking text normalize：剥离 `Reasoning:` 包装 + 整段 italic wrapper + 压缩空行。
 *
 * **关键不变性**（plan v1.5 §20.14 实施备忘）：
 *
 * mergeFullText 的 prefix-aware 合并依赖 raw fullText 是单调累积。但 backend stream:thinking
 * 推送 `Reasoning:\n_<content>_` wrapper —— closing `_` 位置跟着 content 长度浮动。
 * 未 strip 时：
 *   prev = "Reasoning:\n_Let _"       (closing _ at pos 15)
 *   next = "Reasoning:\n_Let me first_" (closing _ at pos 24)
 * 比较时 prev[15]="_" vs next[15]="e" → startsWith 双向失败 → 误判独立 block → append → 指数堆叠。
 *
 * strip 后：
 *   prev = "Let"
 *   next = "Let me first"
 *   next.startsWith(prev) ✓ → rule 1 cumulative growth → 正常 set 覆盖。
 *
 * **2026-05 修订（含 `_` 字符内容场景）**：
 * 老实现用 `_(.+?)_/g` non-greedy 替换——在 thinking 内容含 `task_create` / `fin_data` 等
 * 带 `_` 工具名时**乱吞下划线**：
 *   raw = "Reasoning:\n_This is mode. No need for task_create. Let me query the data._"
 *   non-greedy match #1: `_This is mode. No need for task_` → 替换成 `This is mode. No need for task`
 *   剩余 `create. Let me query the data._` 单尾 `_` 不成对 → 不替换
 *   结果：`This is mode. No need for taskcreate. Let me query the data._`（task_create 变 taskcreate
 *         + 末尾残留 `_`）
 * 流式期间各帧 strip 输出"残留 `_` 位置浮动" → mergeFullText prefix 失配 → rule 5 误判独立
 * block → 每帧都 append → thinking 卡指数堆叠（用户实测：`...taskcreate_` / `...taskcreate. Let_`
 * / `...taskcreate. Let me_` ... 全部堆叠显示）。
 *
 * 修法：识别**整段 wrapper** —— 仅当 trim 后首尾各一个 `_` 时剥两侧；流式中间帧 closing `_`
 * 还没推出来时仅剥首部 `_`；内容里的 `_` 全部保留。
 *
 * 函数原型在功能上跟老 chat-event-handler.ts:363-370 等价，但修复了含 `_` 内容场景下的
 * non-greedy 误吞 bug。老路径在 dev 实测同款 bug，修订后两边对齐。
 */
export function stripReasoningFormat(text: string): string {
  if (!text) return "";
  let out = text.replace(/^Reasoning:\s*\n?/i, "");
  // 整段 italic wrapper：trim 后首尾各一个 `_` → 剥两侧（保留内容里的 `_`）
  // backend 把整段 reasoning 用 `_..._` 包裹（不嵌内部 italic block），仅 strip 边界即可
  const trimmed = out.trimEnd();
  if (trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length > 2) {
    // 剥两侧 `_`，保留 trimEnd 之前的尾部 whitespace
    const tail = out.slice(trimmed.length);
    out = trimmed.slice(1, -1) + tail;
  } else if (out.startsWith("_")) {
    // 流式中间帧：closing `_` 还没推出来 → 仅剥首部 `_`
    out = out.slice(1);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// 共享 narration sanitize 已在 chat-event-helpers.ts 实现（被 segment-builder / history-segments 共用）。
// translator 路径在此 re-export 为 sanitizeNarrationText，让 subagent / 主 agent 翻译都从同一入口取。
export { sanitizeNarrationCommon as sanitizeNarrationText } from "../pure/text";
