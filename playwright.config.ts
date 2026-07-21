import { defineConfig } from "@playwright/test";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // These scenarios mutate the same local Supabase stack. Run them serially so
  // one browser cannot exhaust or race the database while another verifies it.
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3101", trace: "retain-on-failure" },
  webServer: { command: "pnpm test:e2e:web", url: "http://127.0.0.1:3101", reuseExistingServer: false, timeout: 120_000 },
});
