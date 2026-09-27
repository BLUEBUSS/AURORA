// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import { researchContext } from "../context.js";
import { stringEnum } from "../schema.js";
import { Type } from "typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../plugin-api.js";
import { taskStore, pushTaskUpdateEvent, type TaskPlan } from "../task-store.js";

const ACTIONS = ["complete_phase", "fail_phase", "skip_phase", "add_phases"] as const;
type Action = (typeof ACTIONS)[number];

/**
 * Query the core subagent registry to check if a run has actually ended.
 * Returns true if the run exists and has endedAt set, false if still running,
 * undefined if the run is not found in the registry.
 */
function isSubagentRunEndedInRegistry(runId: string): boolean | undefined {
  const fn = researchContext.getStore()?.childEnded;
  if (typeof fn !== "function") return undefined;
  try {
    return fn(runId);
  } catch {
    return undefined;
  }
}

function getActiveSubagents(plan: TaskPlan) {
  const entries = plan.subagents ?? [];
  return entries.filter((entry) => {
    if (entry.status === "pending") return true;
    if (entry.status !== "running") return false;
    // Cross-validate with the core subagent registry: if the registry reports a
    // subagent as ended, treat it as no longer active (don't block on it).
    // This prevents task_update from blocking on subagents that have actually
    // completed but whose subagent_ended hook hasn't arrived yet.
    const registryEnded = isSubagentRunEndedInRegistry(entry.id);
    return registryEnded !== true;
  });
}

export function createTaskUpdateTool(api: OpenClawPluginApi) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "task_update",
    label: "更新任务阶段状态",
    description:
      "更新任务阶段（phase）的执行状态。在一个阶段的所有工具调用完成后调用此工具上报进度。\n" +
      "\n" +
      "action 类型：\n" +
      "- complete_phase：标记指定阶段完成，附 summary（一句话概括该阶段成果）\n" +
      "- fail_phase：标记阶段失败，附 reason\n" +
      "- skip_phase：跳过阶段，附 reason\n" +
      "- add_phases：追加新阶段到计划中\n" +
      "\n" +
      "如果当前计划还有运行中的 sub-agent，不要用 complete_phase 抢先完成阶段；等待 sub-agent 自动回报。\n" +
      "\n" +
      "返回值包含 guidance（下一步建议），请参照执行。",
    parameters: Type.Object({
      action: stringEnum(
        ACTIONS,
        {
          description:
            "操作类型: complete_phase=阶段完成, fail_phase=阶段失败, " +
            "skip_phase=跳过阶段, add_phases=追加新阶段",
        },
      ),
      phase_index: Type.Optional(
        Type.Number({
          description: "阶段索引（0-based），complete_phase/fail_phase/skip_phase 时必填",
        }),
      ),
      summary: Type.Optional(
        Type.String({
          description: "阶段总结（complete_phase 时填写），一句话概括该阶段成果和关键发现",
        }),
      ),
      reason: Type.Optional(
        Type.String({
          description: "失败或跳过原因（fail_phase/skip_phase 时填写）",
        }),
      ),
      new_phases: Type.Optional(
        Type.Array(
          Type.Object({
            description: Type.String({ description: "阶段目标描述" }),
          }),
          { description: "新阶段列表（add_phases 时必填）" },
        ),
      ),
    }),
    async execute(
      _toolCallId: string,
      input: {
        action: Action;
        phase_index?: number;
        summary?: string;
        reason?: string;
        new_phases?: Array<{ description: string }>;
      },
    ) {
      const scope = { agentId: ctx.agentId, sessionKey: ctx.sessionKey };
      const plan = taskStore.getCurrent(scope);
      if (!plan) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "无活跃任务计划" }) }],
        };
      }

      const { action } = input;

      if (action === "complete_phase") {
        const activeSubagents = getActiveSubagents(plan);
        if (activeSubagents.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  status: "blocked",
                  reason: "active_subagents",
                  active_subagents: activeSubagents.map((entry) => ({
                    id: entry.id,
                    label: entry.label,
                    status: entry.status,
                  })),
                  guidance:
                    "当前阶段仍有子 agent 正在执行。不要把“已派发子任务”当作“阶段完成”；等待子 agent 自动回报后再继续。",
                }),
              },
            ],
          };
        }
      }

      if (action === "add_phases") {
        if (!input.new_phases || input.new_phases.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "add_phases 需要 new_phases" }),
              },
            ],
          };
        }
        taskStore.addPhases(plan.id, input.new_phases);
        api.logger.info(`[task_update] add_phases: 追加 ${input.new_phases.length} 个阶段`);
        pushTaskUpdateEvent(plan.id, api.logger, "add_phases");

        const allPhases = (plan.phases ?? []).map((p, i) => {
          const group = plan.groups[i];
          const initialStep = group?.steps.find((s) => s.added_by === "initial");
          return {
            description: p.description,
            status: initialStep?.status ?? "pending",
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                guidance: buildGuidance(plan.id),
                phases: allPhases,
              }),
            },
          ],
        };
      } else {
        if (input.phase_index === undefined || input.phase_index === null) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `${action} 需要 phase_index` }),
              },
            ],
          };
        }

        const statusMap: Record<string, string> = {
          complete_phase: "done",
          fail_phase: "failed",
          skip_phase: "skipped",
        };

        const ok = taskStore.updatePhase(plan.id, input.phase_index, {
          status: statusMap[action] as "done" | "failed" | "skipped",
          output_summary: action === "complete_phase" ? input.summary : input.reason,
        });

        if (!ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: `阶段 ${input.phase_index} 未找到` }),
              },
            ],
          };
        }
        api.logger.info(`[task_update] phase ${input.phase_index} → ${statusMap[action]}`);
        pushTaskUpdateEvent(plan.id, api.logger, "phase_update");
      }

      const pendingCount = taskStore.getPendingPhaseCount(plan.id);

      // All phases done → minimal response; report should be next turn as pure text
      if (pendingCount === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                plan_id: plan.id,
                status: "all_phases_done",
                guidance:
                  "所有阶段已完成。下一轮直接输出完整报告（纯文本，不要包含任何 tool_call）。" +
                  "**报告中每个引用工具数据的关键句末须挂 `[[p_....]]` 角标**（从 toolResult **最顶部独立一行**的 `[[p_....]]` 整段复制；引用子 agent 内容时**必须保留**它已嵌好的 `[[p_....]]`；详见 <data-provenance>）。",
              }),
            },
          ],
        };
      }

      const guidance = buildGuidance(plan.id);

      const result: Record<string, unknown> = { guidance };

      if (pendingCount === 1) {
        result.exec_hint =
          "衍生指标（PE/PB/CAGR/ROE等）必须通过 exec 执行 Python 计算。" +
          "数据文件必须通过 exec 中 python json.load() 读取并筛选，禁止使用 read 工具加载数据文件。";
        result.report_instruction =
          "完成本阶段所有数据准备后，调用 task_update 标记最后一个阶段完成。" +
          "收到确认后，下一轮直接输出完整报告（纯文本，不要包含任何 tool_call）。";
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  });
}

function buildGuidance(planId: string): string {
  const next = taskStore.getNextPendingPhase(planId);
  if (next) {
    return `继续执行下一阶段: ${next.description}`;
  }

  const plan = taskStore.toJSON(planId);
  if (!plan) return "";

  const hasFailed = plan.groups.some((g) =>
    g.steps.some((s) => s.added_by === "initial" && s.status === "failed"),
  );

  if (hasFailed) {
    return "任务完成（部分阶段失败）。请进入报告阶段，在报告中说明失败原因和数据缺失情况。衍生指标必须通过 exec Python 计算。";
  }

  return "所有阶段已完成，请进入报告阶段。衍生指标（PE/PB/CAGR/ROE等）必须通过 exec 执行 Python 代码精确计算，禁止心算。";
}
