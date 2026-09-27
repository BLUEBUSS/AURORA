import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["runtime/**/*.test.ts"], maxWorkers: 2, testTimeout: 30000 },
});
