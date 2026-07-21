import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Phase 0 contains generated protocol bindings and an ephemeral Codex home.
    "proofs/capture-agent-phase0/protocol/**",
    "proofs/capture-agent-phase0/protocol-json/**",
    "proofs/capture-agent-phase0/.runtime/**",
  ]),
]);

export default eslintConfig;
