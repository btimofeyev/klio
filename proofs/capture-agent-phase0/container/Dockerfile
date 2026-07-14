FROM node:24-bookworm-slim

ARG CODEX_VERSION=0.144.1
RUN apt-get update \
  && apt-get install -y --no-install-recommends bubblewrap ca-certificates iproute2 iptables libcap2-bin \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "@openai/codex@${CODEX_VERSION}"

WORKDIR /proof
COPY --chown=node:node . /proof
COPY container/entrypoint.sh /usr/local/bin/klio-phase0-entrypoint
RUN chmod 0755 /usr/local/bin/klio-phase0-entrypoint

ENV HOME=/home/node
ENTRYPOINT ["/usr/local/bin/klio-phase0-entrypoint"]
CMD ["node", "run-live-proof.mjs"]
