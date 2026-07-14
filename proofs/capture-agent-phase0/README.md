# Klio Capture Agent Phase 0

> Current verdict: **PASSED** on `codex-cli 0.144.1` with host preflight and snapshot-bound writes. See `phase0-result.json`.

This throwaway proof tests whether the pinned Codex app-server can be constrained to the five Klio Capture Agent tools before Klio adopts any production migrations or runtime abstraction.

It uses synthetic family data only. The runtime gets a clean `CODEX_HOME`, an empty workspace, no Klio application credentials, disabled shell implementations, disabled web search, and a host-supplied signed MCP bearer capability. The model-visible MCP schemas contain no family or authorization fields. The container image contains the proof harness but no Klio checkout, so app-server's host-side filesystem methods cannot reach application or family data.

## Run

```sh
node --test proofs/capture-agent-phase0/test/*.test.mjs
node proofs/capture-agent-phase0/run-live-proof.mjs
./proofs/capture-agent-phase0/run-container-proof.sh
```

The live proof requires an existing local Codex sign-in or `OPENAI_API_KEY`. It copies only Codex authentication into the ignored temporary runtime directory and deletes that copy when finished.

Regenerate the protocol bindings for the pinned local CLI with:

```sh
rm -rf proofs/capture-agent-phase0/protocol
codex app-server generate-ts --out proofs/capture-agent-phase0/protocol
codex app-server generate-json-schema --out proofs/capture-agent-phase0/protocol-json
```

`live-proof-report.json` records the full local behavioral and adversarial run. `phase0-result.json` combines that result with the hardened container proof.

The container proof builds an image containing only the proof harness. Before app-server starts, its entrypoint resolves the required OpenAI/ChatGPT hosts, installs a default-deny egress firewall that permits only those resolved addresses on port 443, proves an arbitrary destination is blocked, and permanently drops `NET_ADMIN`. No Klio checkout or application credential is mounted.

## Host preflight

Before each turn, the host authorizes the family and capture, builds a bounded immutable snapshot, and injects it as turn input. The capability binds the turn to that snapshot version. Terminal output is schema-constrained and committed only through the gateway; a stale snapshot fails before mutation. `read_capture` and `read_family_context` remain available for optional deeper work but are not preconditions the model must remember to initiate.
