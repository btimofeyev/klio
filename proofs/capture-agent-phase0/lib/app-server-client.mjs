import { spawn } from "node:child_process";
import readline from "node:readline";

export class AppServerClient {
  constructor({ command = "codex", args, cwd, env }) {
    this.cwd = cwd;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.stderr = "";
    this.process = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    this.process.stderr.on("data", (chunk) => { this.stderr += chunk.toString(); });
    this.process.once("exit", (code, signal) => {
      const error = new Error(`APP_SERVER_EXITED:${code ?? signal}\n${this.stderr.slice(-2000)}`);
      for (const { reject } of this.pending.values()) reject(error);
      this.pending.clear();
    });
    readline.createInterface({ input: this.process.stdout }).on("line", (line) => this.#onLine(line));
  }

  #send(message) {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`APP_SERVER_RPC_ERROR:${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) {
      this.events.push(message);
      this.#send({ id: message.id, error: { code: -32000, message: "Klio proof client denies all server-initiated approval and elicitation requests." } });
      return;
    }
    if (message.method) this.events.push(message);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`APP_SERVER_RPC_TIMEOUT:${method}`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.#send({ method, id, params });
    });
  }

  notify(method, params = {}) {
    this.#send({ method, params });
  }

  async initialize() {
    await this.request("initialize", { clientInfo: { name: "klio_capture_phase0", title: "Klio Capture Agent Phase 0", version: "0.1.0" } });
    this.notify("initialized", {});
  }

  async waitForTurn(turnId, timeoutMs = 120_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const completed = this.events.find((event) => event.method === "turn/completed" && event.params?.turn?.id === turnId);
      if (completed) return completed.params.turn;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`TURN_TIMEOUT:${turnId}\n${this.stderr.slice(-2000)}`);
  }

  async waitForMcpTools(threadId, expected, timeoutMs = 15_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const response = await this.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", limit: 50, threadId });
      const server = response.data?.find((entry) => entry.name === "klio_capture");
      const names = Object.keys(server?.tools ?? {}).sort();
      if (expected.every((name) => names.includes(name))) return names;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`MCP_TOOLS_TIMEOUT:${threadId}`);
  }

  async stop() {
    if (this.process.exitCode !== null) return;
    this.process.kill("SIGTERM");
    await new Promise((resolve) => this.process.once("exit", resolve));
  }
}
