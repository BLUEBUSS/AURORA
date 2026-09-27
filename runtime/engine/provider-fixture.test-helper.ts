import { createServer } from "node:http";
export async function startProviderFixture() {
  let modelCalls = 0;
  const authorizations: string[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()) as { messages: Array<{ role: string; content?: string | Array<{ text?: string }>; tool_calls?: Array<{ function: { name: string } }> }> };
    authorizations.push(req.headers.authorization || "");
    if (req.headers.authorization !== "Bearer fixture-own-key") { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "Rejected credential " + req.headers.authorization } })); return; }
    const content = [...body.messages].reverse().find((message) => message.role === "user")?.content || "";
    const query = typeof content === "string" ? content : content.map((part) => part.text || "").join("");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const delta = (value: object, reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`);
    const text = (value: string) => { delta({ role: "assistant", content: value }); delta({}, "stop"); res.end("data: [DONE]\n\n"); };
    if (query === "Reply only OK.") { text("OK"); return; }
    modelCalls++;
    if (query.includes("STOP_CASE")) { delta({ role: "assistant", content: "partial response" }); return; }
    if (query === "child-fixture") { text("CHILD_OK"); return; }
    const previous = [...body.messages].reverse().find((message) => message.role === "assistant")?.tool_calls?.[0]?.function.name;
    const tool = (name: string, args: object) => { delta({ role: "assistant", tool_calls: [{ index: 0, id: `call-${name}-${modelCalls}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] }); delta({}, "tool_calls"); res.end("data: [DONE]\n\n"); };
    if (query === "DATA_SOURCE_CASE") {
      if (!previous) tool("macro_indicator_data", { indicator: "cpi_headline", limit: 1 });
      else text("DATA_SOURCE_OK");
      return;
    }
    if (!previous) { tool("task_create", { core_question: "fixture research", phases: [{ description: "Read and verify evidence" }] }); return; }
    if (previous === "task_create") { tool("read", { path: query.split("ATTACHMENT:")[1]?.trim() || "missing.txt" }); return; }
    if (previous === "read") { tool("sessions_spawn", { task: "child-fixture", label: "Independent check" }); return; }
    if (previous === "sessions_spawn") { tool("task_update", { action: "complete_phase", phase_index: 0, summary: "Evidence verified" }); return; }
    if (previous === "task_update") { tool("write_report", { name: "Fixture report.md", content: "# Verified report\n\nFILE_EVIDENCE and CHILD_OK" }); return; }
    text("MARKER_OK — research and child tools finished.");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address missing");
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, stats: () => ({ modelCalls, authorizations }), close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}
