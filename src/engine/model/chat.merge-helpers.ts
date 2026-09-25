// Derived from ANLYST/OpenClaw fin-core-react. MIT; see engine/LICENSE.
/**
 * Reducer / translator 共享合并 helper（无副作用纯函数）。
 *
 * 设计目的：
 *   - 主 agent reducer (chat.reducer.parts.ts:reduceSegmentAddPhaseMarker) 的合并启发式
 *   - subagent translator (services/translators/live.ts:translateSubagentPhaseMarker) 的合并启发式
 *   两边共用同一套 mergeable 判定 + phaseIndex 合并算法，避免双份维护漂移。
 *
 * 命名空间风格放在 stores/ 下，独立模块，**不依赖** services/translators/ —— 避免 reducer
 * 反向依赖 translator（plan §P1：reducer 是单一决策中心）。
 */

import type { PhaseMarkerSegment } from "../contracts/cards";

/** Mergeable phase-marker action：仅 terminal 类（complete / fail / skip）相邻可合并。
 *  create / add 不合并——前者一 round 仅一次，后者 phase 数量含语义不能 collapse。 */
export function isMergeablePhaseAction(action: PhaseMarkerSegment["action"]): boolean {
  return action === "complete" || action === "fail" || action === "skip";
}

/** mergePhaseIndex 等价：单值合并 / 数组合并去重 / 升序。
 *  mirror 老 segment-builder.ts 内 mergePhaseIndex helper（segment-builder 未导出，复刻一份）。
 *
 *  - prev=undefined → 返回 next（单值）
 *  - prev=number → 跟 next 合并成 [prev, next] 升序（去重）
 *  - prev=array → 把 next 插入并去重升序
 */
export function mergePhaseIndexValues(
  prev: number | number[] | undefined,
  next: number,
): number | number[] {
  if (prev === undefined) return next;
  const prevArr = Array.isArray(prev) ? prev : [prev];
  if (prevArr.includes(next)) return prev;
  return [...prevArr, next].sort((a, b) => a - b);
}
