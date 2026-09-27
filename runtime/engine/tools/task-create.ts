// Adapted from ANLYST/OpenClaw (MIT). See docs/licenses/OpenClaw-MIT.txt.
import { Type } from "typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "../plugin-api.js";
import { optionalStringEnum } from "../schema.js";
import { buildProgressSummary } from "../task-nav.js";
import { taskStore, genPlanId, genGroupId, genStepId, resetSeqCounters } from "../task-store.js";
import type { TaskGroup, TaskStep, TaskPlan, ResearchCategory } from "../task-store.js";

const RESEARCH_CATEGORY_VALUES = ["investment", "industry", "macro", "event"] as const;

export function createTaskCreateTool(
  api: OpenClawPluginApi,
  skillLabels: Record<string, string> = {},
  _registeredDataTools?: Set<string>,
) {
  return (ctx: OpenClawPluginToolContext) => ({
    name: "task_create",
    label: "创建分析任务计划",
    description:
      "创建任务执行计划。所有数据工具调用前必须先通过本工具建立计划（系统已在运行时强制拦截无计划的数据工具调用）。\n" +
      "传入 phases（执行阶段描述）和可选的 matched_skill（匹配技能标识）。返回计划 ID 和阶段列表。\n" +
      "创建后，按已加载的 skill reference 或你自己的 plan 自主执行：直接调用工具或 spawn subagent。",
    parameters: Type.Object({
      matched_skill: Type.Optional(
        Type.String({
          description:
            "【极其重要】判断用户问题是否命中系统内置专业技能。\n" +
            "有专业技能匹配时必填对应的英文标识，无匹配时请严格留空，切勿自己编造技能名！",
        }),
      ),
      research_category: optionalStringEnum(RESEARCH_CATEGORY_VALUES, {
        description:
          "研究类型分类（仅 deep-research等支持研究分流的 skill 使用，其他场景留空）。\n" +
          "取值：investment（标的投资）/ industry（行业主题）/ macro（宏观策略）/ event（事件政策）。\n" +
          "决定下游 phase 文件的路由路径与输出形式（押注 / 景气评级 / 路径分布 / 影响传导链）。",
      }),
      core_question: Type.Optional(
        Type.String({
          description:
            "本次分析要回答的核心投资/研究问题（1句话）。\n" +
            "复杂分析必填，极简查询可省略。好的例子：'恒瑞医药的创新药转型是否已进入业绩兑现期？'",
        }),
      ),
      hypotheses: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "分析视角（0-3条，非必填）。仅在有独立于分析路径的判断角度时填写。\n" +
            "根据场景自适应：单股深研填预期差，事件驱动填影响逻辑，行业分析填关键变量，对比分析通常省略。",
          maxItems: 3,
        }),
      ),
      phases: Type.Array(
        Type.Object({
          description: Type.String({
            description: "阶段目标描述，如：公司研究 — spawn subagent 执行",
          }),
        }),
        {
          description:
            "执行阶段列表。描述每个阶段的目标，不绑定具体工具。\n" +
            "示例：[{description:'公司基本面数据采集'}, {description:'财务数据分析'}, {description:'估值与风险评估'}]",
        },
      ),
    }),
    async execute(
      _toolCallId: string,
      input: {
        matched_skill?: string;
        research_category?: ResearchCategory;
        core_question?: string;
        hypotheses?: string[];
        phases: Array<{ description: string }>;
      },
    ) {
      resetSeqCounters();

      const scope = { agentId: ctx.agentId, sessionKey: ctx.sessionKey };
      const prev = taskStore.getCurrent(scope);

      // Guard: if an active plan already has completed/running steps, reject the
      // duplicate task_create and redirect the model to continue the existing plan.
      if (prev && prev.status !== "done" && prev.status !== "failed") {
        const allSteps = prev.groups.flatMap((g) => g.steps);
        const hasProgress = allSteps.some(
          (s) => s.status === "done" || s.status === "running" || s.status === "failed",
        );
        if (hasProgress) {
          const progress = buildProgressSummary(prev);
          api.logger.warn(`[task_create] rejected duplicate: plan ${prev.id} already has progress`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    system_notice: `⚠️ 已有活跃任务计划 ${prev.id} 且已有执行进度，禁止重复创建！请继续执行当前计划。`,
                    progress,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        // No progress yet — safe to retire and recreate
        taskStore.setPlanStatus(prev.id, "done");
        api.logger.info(
          `[task_create] retired previous plan ${prev.id} (was ${prev.status}, no progress) before creating new plan`,
        );
      }

      // 创建新 plan 前清理上一个 plan 的临时数据文件
      if (prev) {
        taskStore.cleanupDataFiles(prev);
      }

      const planId = genPlanId(ctx.sessionKey);
      const now = new Date().toISOString();

      // Convert phases to groups (one group per phase, single placeholder step)
      // This maintains backward compatibility with the existing task tracking system.
      const groups: TaskGroup[] = (input.phases || []).map((phase, i) => {
        const groupId = genGroupId(planId);
        const step: TaskStep = {
          id: genStepId(planId),
          title: phase.description,
          description: phase.description,
          status: "pending" as const,
          added_by: "initial" as const,
        };
        return {
          id: groupId,
          title: phase.description,
          order: i,
          type: "serial" as const,
          steps: [step],
        };
      });

      const validHypotheses = input.hypotheses
        ?.filter((h) => typeof h === "string" && h.trim())
        .map((h) => h.trim());

      const plan: TaskPlan = {
        id: planId,
        query: input.core_question?.trim() || "",
        matched_skill: input.matched_skill || undefined,
        matched_skill_label: input.matched_skill
          ? skillLabels[input.matched_skill] || input.matched_skill
          : undefined,
        research_category: input.research_category,
        core_question: input.core_question?.trim() || undefined,
        hypotheses: validHypotheses && validHypotheses.length > 0 ? validHypotheses : undefined,
        status: "executing",
        groups,
        phases: input.phases,
        checkpoints: [],
        created_at: now,
        updated_at: now,
        sessionKey: ctx.sessionKey,
      };

      taskStore.create(plan, scope);
      taskStore.clearPhaseOverride(scope);

      const skillTag = input.matched_skill ? `, 匹配技能: ${input.matched_skill}` : "";
      const categoryTag = input.research_category ? `, 研究类型: ${input.research_category}` : "";
      api.logger.info(
        `[task_create] 任务计划已创建: ${planId}, agentId=${ctx.agentId ?? "undefined"}, sessionKey=${ctx.sessionKey ?? "undefined"}, ${groups.length} 个阶段${skillTag}${categoryTag}`,
      );

      const result = {
        system_notice:
          "任务计划已成功创建并展示给用户。请按照已加载的 skill reference 或你的 <plan> 自主执行。" +
          "你可以直接调用工具，也可以 spawn subagent 处理子任务。" +
          "重要：每完成一个阶段后必须调用 task_update(action='complete_phase') 上报进度，包括分析阶段和报告阶段，不要遗漏。",
        plan: {
          id: planId,
          core_question: input.core_question?.trim() || undefined,
          matched_skill: input.matched_skill || undefined,
          research_category: input.research_category,
          status: "executing",
          phases: input.phases,
        },
      };

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
