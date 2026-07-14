#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="klio-capture-phase0:codex-0.144.1"
docker build --quiet -f "$ROOT/container/Dockerfile" -t "$IMAGE" "$ROOT"
docker run --rm \
  --cap-add NET_ADMIN \
  --security-opt no-new-privileges \
  -e PHASE0_FAST=1 \
  -v "$HOME/.codex/auth.json:/auth-source/auth.json:ro" \
  "$IMAGE"

echo "container filesystem and allowlisted-egress proof passed"
