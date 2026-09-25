import { startRuntime } from "./index.js";

const args = process.argv.slice(2);
function argument(name: string) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
}
try {
  for (let index = 0; index < args.length; index += 2) {
    if (!["--port", "--state-dir"].includes(args[index])) throw new Error("Unknown runtime argument.");
  }
  const runtime = await startRuntime({
    port: argument("--port") === undefined ? 5174 : Number(argument("--port")),
    stateDirectory: argument("--state-dir"),
  });
  console.log(`AURORA local service: ${runtime.origin}`);
  console.log("Local files and application shell ready. Research engine integration is not yet complete.");
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void runtime.close().then(() => process.exit(0));
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === "EADDRINUSE" ? "AURORA port is occupied. Use --port or stop the existing service. No process was stopped."
    : "AURORA could not start. Build the application and check the state directory and arguments. Existing data was not overwritten.");
  process.exitCode = 1;
}
