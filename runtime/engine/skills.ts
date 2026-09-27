import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const allowed = new Set(["deep-research/references/event/01-scope.md","deep-research/references/event/02-scan.md","deep-research/references/event/03-hypothesis.md","deep-research/references/event/04-evidence.md","deep-research/references/event/05-analyze.md","deep-research/references/event/06-challenge.md","deep-research/references/event/07-synthesize.md","deep-research/references/event/paradigms.md","deep-research/references/industry/01-scope.md","deep-research/references/industry/02-scan.md","deep-research/references/industry/03-hypothesis.md","deep-research/references/industry/04-evidence.md","deep-research/references/industry/05-analyze.md","deep-research/references/industry/06-challenge.md","deep-research/references/industry/07-synthesize.md","deep-research/references/industry/paradigms.md","deep-research/references/investment/01-scope.md","deep-research/references/investment/02-scan.md","deep-research/references/investment/03-hypothesis.md","deep-research/references/investment/04-evidence.md","deep-research/references/investment/05-analyze.md","deep-research/references/investment/06-challenge.md","deep-research/references/investment/07-synthesize.md","deep-research/references/investment/paradigms.md","deep-research/references/macro/01-scope.md","deep-research/references/macro/02-scan.md","deep-research/references/macro/03-hypothesis.md","deep-research/references/macro/04-evidence.md","deep-research/references/macro/05-analyze.md","deep-research/references/macro/06-challenge.md","deep-research/references/macro/07-synthesize.md","deep-research/references/macro/paradigms.md","deep-research/references/shared/pdf-design-system.md","deep-research/references/shared/pdf-pipeline.md","deep-research/SKILL.md"]);
const directory = [new URL("../skills/", import.meta.url), new URL("./skills/", import.meta.url)].map((url) => fileURLToPath(url)).find((candidate) => existsSync(path.join(candidate,"deep-research/SKILL.md")));
export function readSkill(name: string): string {
 const relative = name.startsWith("skills/") ? name.slice(7) : "";
 if (!directory || !allowed.has(relative)) throw new Error("Unknown bundled research method.");
 const root=realpathSync(directory), filename=realpathSync(path.join(root,relative));
 if(!filename.startsWith(root+path.sep)) throw new Error("Invalid research method path.");
 return readFileSync(filename,"utf8");
}
export const entrySkill = readSkill("skills/deep-research/SKILL.md");
