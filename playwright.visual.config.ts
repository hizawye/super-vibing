import { defineConfig } from "@playwright/test";

const VISUAL_BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: VISUAL_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  },
  webServer: {
    command:
      "pnpm --filter @supervibing/desktop build && pnpm --filter @supervibing/desktop preview --host 127.0.0.1 --port 4173 --strictPort",
    env: {
      VITE_E2E: "1",
    },
    url: VISUAL_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
