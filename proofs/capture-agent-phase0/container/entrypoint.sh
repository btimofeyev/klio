#!/usr/bin/env bash
set -euo pipefail

ALLOWED_IPS=()
for host in chatgpt.com auth.openai.com api.openai.com; do
  address="$(getent ahostsv4 "$host" | awk 'NR == 1 { print $1 }')"
  if [[ -n "$address" ]]; then
    ALLOWED_IPS+=("$address")
    printf '%s %s\n' "$address" "$host" >> /etc/hosts
  fi
done

if [[ ${#ALLOWED_IPS[@]} -eq 0 ]]; then
  echo "no allowlisted OpenAI addresses resolved" >&2
  exit 1
fi

iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
for address in "${ALLOWED_IPS[@]}"; do
  iptables -A OUTPUT -p tcp -d "$address" --dport 443 -j ACCEPT
done

if timeout 4 bash -c '</dev/tcp/example.com/443' 2>/dev/null; then
  echo "direct arbitrary egress unexpectedly succeeded" >&2
  exit 1
fi

mkdir -p /home/node/.codex
cp /auth-source/auth.json /home/node/.codex/auth.json
chown -R node:node /home/node/.codex /proof
chmod 0600 /home/node/.codex/auth.json

exec setpriv \
  --reuid=1000 --regid=1000 --init-groups \
  --bounding-set=-net_admin --inh-caps=-all --ambient-caps=-all \
  -- "$@"
