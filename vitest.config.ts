import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Keep local Supabase integration tests below the service's stable
    // concurrent-connection envelope while retaining parallel unit tests.
    maxWorkers: 4,
    testTimeout: 20_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
