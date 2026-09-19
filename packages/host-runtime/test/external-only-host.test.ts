import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import { startExternalOnlyHostServer } from "../src/external-only-host.js";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("External-only Host", () => {
  it("serves an isolated JSON-RPC initialize endpoint with token authentication", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "codexhost-external-only-"));
    const token = randomBytes(32).toString("hex");
    const server = await startExternalOnlyHostServer({
      ...process.env,
      CODEXHOST_DATA_DIR: dataDirectory,
      CODEXHOST_EXTERNAL_HOST_TOKEN: token,
      CODEX_HOME: path.join(dataDirectory, "codex-home"),
    });
    servers.push(server);

    const unauthorized = await fetch(server.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await fetch(server.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: 2,
      result: { serverInfo: { name: "codexhost-external" } },
    });
  });

  it("rejects official Codex requests instead of forwarding them", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "codexhost-external-only-"));
    const token = randomBytes(32).toString("hex");
    const server = await startExternalOnlyHostServer({
      ...process.env,
      CODEXHOST_DATA_DIR: dataDirectory,
      CODEXHOST_EXTERNAL_HOST_TOKEN: token,
      CODEX_HOME: path.join(dataDirectory, "codex-home"),
    });
    servers.push(server);
    const response = await fetch(server.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "thread/list", params: {} }),
    });
    expect(await response.json()).toMatchObject({ id: 3, error: { code: expect.any(Number) } });
  });

  it("keeps the event channel token-bound", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "codexhost-external-only-"));
    const token = randomBytes(32).toString("hex");
    const server = await startExternalOnlyHostServer({
      ...process.env,
      CODEXHOST_DATA_DIR: dataDirectory,
      CODEXHOST_EXTERNAL_HOST_TOKEN: token,
      CODEX_HOME: path.join(dataDirectory, "codex-home"),
    });
    servers.push(server);
    const endpoint = new URL(server.endpoint);
    const unauthorized = new WebSocket(
      `ws://127.0.0.1:${endpoint.port}/events?token=${"0".repeat(64)}`,
    );
    await expect(
      new Promise<void>((resolve, reject) => {
        unauthorized.once("error", () => resolve());
        unauthorized.once("open", () => reject(new Error("unauthorized event socket opened")));
      }),
    ).resolves.toBeUndefined();
  });
});
