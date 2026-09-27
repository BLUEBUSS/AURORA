import { cp, mkdir } from "node:fs/promises";
await mkdir(new URL("../dist-runtime/skills/", import.meta.url), { recursive: true });
await cp(new URL("../runtime/skills/", import.meta.url), new URL("../dist-runtime/skills/", import.meta.url), { recursive: true });
