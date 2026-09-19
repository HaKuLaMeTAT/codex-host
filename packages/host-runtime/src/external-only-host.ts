import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";

import { createProductionExternalThreadStore } from "./external-thread-repository.js";
import { installedHarnessPluginOptions } from "./installed-harness-plugins.js";
import { ExternalThreadHost } from "./external-thread-host.js";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export const EXTERNAL_HOST_PORT_ENV = "CODEXHOST_EXTERNAL_HOST_PORT";
export const EXTERNAL_HOST_TOKEN_ENV = "CODEXHOST_EXTERNAL_HOST_TOKEN";

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error("External Host request is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export interface ExternalOnlyHostServer {
  endpoint: string;
  close(): Promise<void>;
}

export async function startExternalOnlyHostServer(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ExternalOnlyHostServer> {
  const token = environment[EXTERNAL_HOST_TOKEN_ENV];
  if (!token || !/^[0-9a-f]{64}$/u.test(token)) {
    throw new Error(`${EXTERNAL_HOST_TOKEN_ENV} must be 64 lowercase hexadecimal characters`);
  }
  const input = new PassThrough();
  const output = new PassThrough();
  const pending = new Map<
    string | number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const eventClients = new Set<WebSocket>();
  let outputBuffer = "";
  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    outputBuffer += chunk;
    for (;;) {
      const newline = outputBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = outputBuffer.slice(0, newline);
      outputBuffer = outputBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      const value = JSON.parse(line) as { id?: string | number };
      if (value.id !== undefined) pending.get(value.id)?.resolve(value);
      else {
        const encoded = JSON.stringify(value);
        for (const client of eventClients) if (client.readyState === 1) client.send(encoded);
      }
    }
  });

  const pluginOptions = installedHarnessPluginOptions(environment, false);
  const host = new ExternalThreadHost({
    environment,
    input,
    output,
    diagnosticOutput: process.stderr,
    pluginRoots: pluginOptions.pluginRoots,
    pluginContext: pluginOptions.pluginContext,
    mappingStore: createProductionExternalThreadStore(environment),
  });
  void host.run().catch((error) => {
    process.stderr.write(`codexhost external host stopped: ${String(error)}\n`);
  });

  const server: Server = createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/rpc") {
        writeJson(response, 404, { error: "Not found" });
        return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        writeJson(response, 401, { error: "Invalid external Host token" });
        return;
      }
      const value = await readBody(request);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        writeJson(response, 400, { error: "JSON-RPC request must be an object" });
        return;
      }
      const id = "id" in value && (typeof value.id === "string" || typeof value.id === "number")
        ? value.id
        : undefined;
      if (id === undefined) {
        writeJson(response, 400, { error: "JSON-RPC request requires an id" });
        return;
      }
      const result = new Promise<unknown>((resolve, reject) =>
        pending.set(id, { resolve, reject }),
      );
      input.write(`${JSON.stringify(value)}\n`);
      writeJson(response, 200, await result);
      pending.delete(id);
    })().catch((error) => writeJson(response, 400, { error: String(error) }));
  });
  const events = new WebSocketServer({ noServer: true });
  events.on("connection", (socket) => {
    eventClients.add(socket);
    socket.once("close", () => eventClients.delete(socket));
  });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/events" || url.searchParams.get("token") !== token) {
      socket.destroy();
      return;
    }
    events.handleUpgrade(request, socket, head, (client) => events.emit("connection", client, request));
  });
  const requestedPort = Number(environment[EXTERNAL_HOST_PORT_ENV] ?? 0);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number.isInteger(requestedPort) ? requestedPort : 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("External Host address unavailable");
  return {
    endpoint: `http://127.0.0.1:${address.port}/rpc`,
    close: async () => {
      host.close();
      input.end();
      output.destroy();
      for (const client of eventClients) client.close();
      events.close();
      for (const { reject } of pending.values()) reject(new Error("External Host closed"));
      pending.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
