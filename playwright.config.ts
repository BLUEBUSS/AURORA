import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "artifacts/playwright-report" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    headless: true,
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://127.0.0.1:5174",
          localStorage: [{ name: "aurora-data-mode", value: '"demo"' }],
        },
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "artifacts/test-results",
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
