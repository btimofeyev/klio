import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "192.168.50.96"],
  distDir: process.env.KLIO_NEXT_DIST_DIR || ".next",
  outputFileTracingIncludes: {
    "/api/internal/agent-worker": [
      "node_modules/.pnpm/@openai+codex@*-linux-x64/node_modules/@openai/codex/package.json",
      "node_modules/.pnpm/@openai+codex@*-linux-x64/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/bin/codex",
      "node_modules/.pnpm/@openai+codex@*-linux-x64/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex-package.json",
      "node_modules/.pnpm/@openai+codex@*-linux-x64/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex-path/rg",
    ],
  },
};

export default nextConfig;
