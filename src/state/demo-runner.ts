import { sampleReport, sampleSources } from "../data/demo";
import type { TaskPlan, TaskStep } from "../engine";
import type { Session } from "../types";
import { applyCoreEvent, completeCore, getCore, restoreCore, startCoreRound } from "./research-core";
import { useWorkspace } from "./workspace";

const FRAME_MS = 120;
const REPORT_START_FRAME = 6;
const FINAL_FRAME = 34; // 4.08 seconds, independent of which preset report is selected.
const phaseTitles = ["整理研究问题（示例）", "展示参考入口（示例）", "准备预设报告（示例）"];
type DemoRun = { timer: ReturnType<typeof setInterval>; roundId: string; runId: string; seq: number };
const runs = new Map<string, DemoRun>();

function reportFor(session: Session): string {
  if (session.company?.ticker === "NVDA") return sampleReport;
  return `# ${session.company?.name || "研究问题"} · 验证框架\n\n**交互演示 · 以下为预设研究框架，未调用 AI 或检索实时数据。**\n\n## 先明确需要验证的判断\n\n将本轮问题拆解成 **业务变化、盈利传导与市场定价** 三个层面，分别记录支持证据与可能的反证。\n\n### 01　业务发生了什么变化？\n\n从公司的正式披露出发，核对数据期间、业务口径与增长来源。区分已实现结果和管理层的未来指引。\n\n### 02　变化能否转化为现金流？\n\n结合利润率、资本投入和回款情况，检查增长质量。**需求增长不自动等于股东回报改善。**\n\n### 03　有哪些关键反证？\n\n列出观点失效的条件，并为每一个假设指定下一次验证节点。\n\n| 观察方向 | 证据需求 | 当前状态 |\n| --- | --- | --- |\n| 需求变化 | 最新披露和客户数据 | 待验证 |\n| 供给约束 | 产能、交期与库存 | 待验证 |\n| 盈利兑现 | 利润率和现金流 | 待验证 |\n\n## 下一步\n\n将官方报告带入研究，补充来源与数据期间，再形成具体判断。\n\n> 本地演示仅用于验证产品交互，不产生投资结论。`;
}

function emit(sessionId: string, run: DemoRun, event: "agent" | "chat", payload: Record<string, unknown>) {
  applyCoreEvent(sessionId, event, {
    ...payload, sessionKey: sessionId, runId: run.runId, seq: ++run.seq, source: "demo", synthetic: true,
  });
}

function agent(sessionId: string, run: DemoRun, stream: string, data: Record<string, unknown>) {
  emit(sessionId, run, "agent", { stream, data });
}

function planFor(run: DemoRun, activePhase: number): TaskPlan {
  return {
    id: `${run.runId}:plan`, title: "研究框架回放 · 交互演示",
    phases: phaseTitles.map((description) => ({ description })),
    groups: [{
      id: "demo-phases", title: "预设交互步骤", type: "serial",
      steps: phaseTitles.map((title, index): TaskStep => ({
        id: `phase-${index + 1}`, title,
        status: index < activePhase ? "done" : index === activePhase ? "running" : "pending",
      })),
    }],
  };
}

function completePhase(sessionId: string, run: DemoRun, phaseIndex: number, summary: string) {
  const toolCallId = `${run.runId}:phase-${phaseIndex}`;
  agent(sessionId, run, "tool", { name: "task_update", toolCallId, phase: "start",
    args: { action: "complete_phase", phase_index: phaseIndex, summary } });
  agent(sessionId, run, "tool", { name: "task_update", toolCallId, phase: "result",
    result: { demo: true, content: [{ type: "text", text: summary }] } });
  // Use the normal snapshot event as well: report classification reads the updated plan.
  agent(sessionId, run, "task_update", { plan: planFor(run, phaseIndex + 1) });
}

function clearRun(sessionId: string): DemoRun | undefined {
  const run = runs.get(sessionId);
  if (run) { clearInterval(run.timer); runs.delete(sessionId); }
  return run;
}

export function runDemo(sessionId: string, messageId: string) {
  const session = useWorkspace.getState().sessions.find((item) => item.id === sessionId);
  const userIndex = session?.messages.findLastIndex((message) => message.role === "user") ?? -1;
  const user = session?.messages[userIndex];
  if (!session || session.origin !== "demo" || !user) return;
  stopDemo(sessionId);

  // Persisted demo/seed messages predate the in-memory engine; retain those rounds.
  if (!getCore(sessionId).rounds.length && userIndex > 0) {
    restoreCore(sessionId, session.messages.slice(0, userIndex).map((message) => ({
      id: message.id, role: message.role, content: message.text, timestamp: message.time,
    })));
  }
  const roundId = startCoreRound(sessionId, user);
  const full = reportFor(session);
  const sources = sampleSources.slice(0, session.company?.ticker === "NVDA" ? 3 : 2);
  const referenceText = "**预设示例参考入口 · 本轮没有联网、读取网页或验证资料。**\n\n"
    + sources.map((source) => `- [${source.title}](${source.url})`).join("\n");
  let frame = 0;
  const run: DemoRun = {
    roundId, runId: `demo-${messageId}`, seq: 0,
    timer: setInterval(() => {
      if (runs.get(sessionId) !== run) { clearInterval(run.timer); return; }
      const currentSession = useWorkspace.getState().sessions.find((item) => item.id === sessionId);
      const round = getCore(sessionId).rounds.find((item) => item.id === roundId);
      if (currentSession?.origin !== "demo"
        || round?.status !== "streaming" || getCore(sessionId).activeRoundId !== roundId) {
        clearRun(sessionId);
        return;
      }
      frame++;
      if (frame === 1) {
        agent(sessionId, run, "assistant", { phase: "message_start" });
        agent(sessionId, run, "thinking", {
          text: "**示例思考 · 预设回放**\n\n先把研究问题拆成需求、供给和利润兑现，再列出需要验证的事实与反证。此处展示交互流程，未调用模型。",
        });
      } else if (frame === 2) {
        const plan = planFor(run, 0);
        const toolCallId = `${run.runId}:plan`;
        agent(sessionId, run, "tool", { name: "task_create", toolCallId, phase: "start", args: plan });
        agent(sessionId, run, "tool", { name: "task_create", toolCallId, phase: "result", result: { plan, demo: true } });
      } else if (frame === 3) {
        completePhase(sessionId, run, 0, "演示：研究问题已整理成预设验证框架。");
        agent(sessionId, run, "assistant", { phase: "message_start" });
        agent(sessionId, run, "assistant", { text: "演示：展示内置参考入口；没有发起在线检索。" });
        agent(sessionId, run, "tool", { name: "示例参考入口", toolCallId: `${run.runId}:references`,
          phase: "start", args: { demo: true, source: "内置示例", networkRequest: false } });
      } else if (frame === 4) {
        agent(sessionId, run, "tool", { name: "示例参考入口", toolCallId: `${run.runId}:references`,
          phase: "result", result: { demo: true, content: [{ type: "text", text: referenceText }] } });
        completePhase(sessionId, run, 1, "演示：已展示官方资料入口，尚未读取或核验。");
      } else if (frame === 5) {
        completePhase(sessionId, run, 2, "演示：预设报告已准备好，将展示流式阅读与文件交互。");
      } else if (frame === REPORT_START_FRAME) {
        // Start only after all plan phases finish so deltas project as report text.
        agent(sessionId, run, "assistant", { phase: "message_start" });
      }
      if (frame >= REPORT_START_FRAME) {
        const progress = Math.ceil(full.length * (frame - REPORT_START_FRAME + 1) / (FINAL_FRAME - REPORT_START_FRAME + 1));
        const done = frame >= FINAL_FRAME;
        emit(sessionId, run, "chat", { state: done ? "final" : "delta", message: { content: full.slice(0, progress) } });
        if (done) {
          clearRun(sessionId);
          const current = useWorkspace.getState();
          const answer = current.sessions.find((item) => item.id === sessionId)?.messages.find((item) => item.engineRoundId === roundId);
          const fileId = `report-${messageId}`;
          current.saveFile({ id: fileId, name: `${session.company?.ticker || "研究"} · 验证框架.md`,
            folder: "研究报告", content: full, kind: "markdown", report: true, sessionId,
            projectId: session.projectId, updatedAt: Date.now() });
          // Files and example source metadata are UI attachments; text/status came from the engine.
          if (answer) current.updateMessage(sessionId, answer.id, { fileIds: [fileId], sources });
        }
      }
    }, FRAME_MS),
  };
  runs.set(sessionId, run);
}

function endDemo(sessionId: string, status: "aborted" | "failed", reason?: string) {
  const run = clearRun(sessionId);
  if (run && getCore(sessionId).activeRoundId === run.roundId) completeCore(sessionId, status, reason);
}

export function stopDemo(sessionId: string) { endDemo(sessionId, "aborted"); }
export function failDemo(sessionId: string) {
  endDemo(sessionId, "failed", "演示中断：资料服务暂时不可用。已有内容和下一条草稿已保留。");
}
export function stopAllDemo() { for (const id of runs.keys()) stopDemo(id); }
