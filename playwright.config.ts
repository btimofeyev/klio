import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 4,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: { command: "pnpm dev", url: "http://127.0.0.1:3100", reuseExistingServer: true, timeout: 120_000 },
});
