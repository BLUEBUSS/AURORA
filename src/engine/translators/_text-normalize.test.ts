// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * stripReasoningFormat 单测：覆盖整段 italic wrapper + 流式中间帧 + 含 `_` 内容场景。
 *
 * 实证背景：jsonl 452ee18d 的 #11 thinking 含 `task_create` / `fin_data` 等带 `_` 工具名
 * 旧实现 `_(.+?)_/g` non-greedy 在含 `_` 内容上**乱吞下划线**，每帧 strip 输出残留 `_`
 * 位置浮动 → mergeFullText prefix 失配 → rule 5 误判独立 block → thinking 卡指数堆叠。
 */

import { describe, expect, it } from "vitest";
import { stripReasoningFormat } from "./_text-normalize";

describe("stripReasoningFormat - 整段 wrapper", () => {
  it("无 wrapper 纯文本不动", () => {
    expect(stripReasoningFormat("hello world")).toBe("hello world");
  });

  it("仅 Reasoning: 前缀剥（旧形态）", () => {
    expect(stripReasoningFormat("Reasoning:\nhello world")).toBe("hello world");
  });

  it("整段 italic wrapper（首尾 `_`）→ 剥两侧", () => {
    expect(stripReasoningFormat("Reasoning:\n_Let me think_")).toBe("Let me think");
  });

  it("**含 `_` 内容**整段 wrapper → 内部 `_` 保留（修 Bug 2 root cause）", () => {
    // 实证 jsonl 形态：thinking 含 task_create / fin_data 等带 `_` 工具名
    const raw =
      "Reasoning:\n_This is a 快速回答 mode. No need for task_create. Let me query fin_data._";
    const expected = "This is a 快速回答 mode. No need for task_create. Let me query fin_data.";
    expect(stripReasoningFormat(raw)).toBe(expected);
  });

  it("流式中间帧无 closing `_` → 仅剥首部 `_`（保留尾部不变）", () => {
    // backend 流式期间 closing `_` 还没推出来，content 持续生长
    const frame1 = "Reasoning:\n_This is a mode. taskcreate";
    const frame2 = "Reasoning:\n_This is a mode. taskcreate. Let me query";
    const out1 = stripReasoningFormat(frame1);
    const out2 = stripReasoningFormat(frame2);
    expect(out1).toBe("This is a mode. taskcreate");
    expect(out2).toBe("This is a mode. taskcreate. Let me query");
    // 关键验证：mergeFullText prefix 命中
    expect(out2.startsWith(out1)).toBe(true);
  });

  it("流式连续帧（中间无 closing _，最终有）→ 全部命中 prefix 关系", () => {
    // 模拟流式：前 N-1 帧 closing `_` 还没推出来，最终帧有
    const frame1 = "Reasoning:\n_AAAA task_create";
    const frame2 = "Reasoning:\n_AAAA task_create. Let me query";
    const frame3 = "Reasoning:\n_AAAA task_create. Let me query the data._";
    const out1 = stripReasoningFormat(frame1);
    const out2 = stripReasoningFormat(frame2);
    const out3 = stripReasoningFormat(frame3);
    expect(out1).toBe("AAAA task_create");
    expect(out2).toBe("AAAA task_create. Let me query");
    expect(out3).toBe("AAAA task_create. Let me query the data.");
    // 关键不变性：mergeFullText prefix 命中（每帧 strip 后单调累积）
    expect(out2.startsWith(out1)).toBe(true);
    expect(out3.startsWith(out2)).toBe(true);
  });

  it("空字符串返回空", () => {
    expect(stripReasoningFormat("")).toBe("");
  });

  it("多余空行压缩 \\n\\n（保留语义分段）", () => {
    expect(stripReasoningFormat("hello\n\n\n\nworld")).toBe("hello\n\nworld");
  });
});
