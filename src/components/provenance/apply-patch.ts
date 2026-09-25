/**
 * 把 provenance patch 应用到一段文本上（位置无关）。
 *
 * 与 chat.store::applyProvenancePatch 的 apply 步骤保持完全一致，避免两份维护：
 *   1. 剥离模型可能残留的 <sources>...</sources> 标签（不再追加来源段落）。
 *   2. rewriteMap 把冗余 pid 收敛到规范 pid（[[alias]] → [[canonical]]）。
 *   3. stripTokens 剥离孤儿 / 非法 [[xxx]] 标记（含字面 [[p_xxxx]] 占位符）。
 *
 * 三步全部为幂等替换：重复执行不会损坏文本。
 *
 * 用途：
 *   - chat.store::applyProvenancePatch（live 流）
 *   - chat-event-handler::final case（transcript 写入前清洗 LLM 原始文本）
 *   - history-render（历史会话重放时的二次清洗）
 */

const SOURCES_BLOCK_RE = /<sources>[\s\S]*?<\/sources>/i;

/** 仅合法 bare pid：`[[p_abcd]]`，无 :字段 后缀（用于孤儿剥离时连带删掉带字段的同 pid 引用） */
const BARE_PID_STRIP_RE = /^\[\[(p_[0-9a-f]{4})\]\]$/;

export interface ProvenancePatchInput {
  /** 已废弃，仅保留用于向后兼容旧 transcript；新 patch 不再携带 replacement */
  replacement?: string;
  /** 冗余 pid 收敛表：alias → canonical */
  rewriteMap?: Record<string, string>;
  /** 待剥离的 token 列表（含 [[ ]]，例如 "[[p_a2d6]]"、"[[p_xxxx]]"） */
  stripTokens?: string[];
}

export function applyPatchToText(text: string, patch: ProvenancePatchInput): string {
  if (typeof text !== "string" || text.length === 0) return text;

  let out = text;

  // Step 1: 清除残留的 <sources> 标签（模型可能违约写出）
  const m = SOURCES_BLOCK_RE.exec(out);
  if (m) {
    out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
  }

  // Step 2: rewriteMap 把冗余 pid 替换为规范 pid（含 `[[alias:字段]]` → `[[canonical:字段]]`）
  if (patch.rewriteMap) {
    for (const [alias, canonical] of Object.entries(patch.rewriteMap)) {
      if (alias === canonical) continue;
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\[\\[${esc}(?::([^\\]]*))?\\]\\]`, "g");
      out = out.replace(re, (_m, fields: string | undefined) =>
        fields ? `[[${canonical}:${fields}]]` : `[[${canonical}]]`,
      );
    }
  }

  // Step 3: 剥离孤儿/非法标记
  if (patch.stripTokens) {
    for (const tok of patch.stripTokens) {
      if (!tok) continue;
      const bare = tok.match(BARE_PID_STRIP_RE);
      if (bare) {
        const pid = bare[1]!;
        const re = new RegExp(`\\[\\[${pid}(?::[^\\]]+)?\\]\\]`, "g");
        out = out.replace(re, "");
      } else {
        out = out.replaceAll(tok, "");
      }
    }
  }

  return out;
}
