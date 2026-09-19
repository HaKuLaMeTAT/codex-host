import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

import {
  startControllerAttachmentServer,
  type ControllerAttachmentServer,
  type StartControllerAttachmentServerOptions,
} from "./controller-attachment-server.js";
import {
  installRendererCdpControlSession,
  type RendererCdpControlSession,
} from "./renderer-cdp-control-session.js";

export interface DesktopControllerOptions {
  rendererCdpEndpoint: string;
  rendererPath: string;
  hostRuntimePath?: string;
  defaultAgent: "codex" | "pi" | "deepseek-harness" | "opencode";
  attachmentPort: number;
  attachmentNonce: string;
}

export interface DesktopControllerReadiness {
  schemaVersion: 2;
  state: "compatible";
  issues: [];
}

export interface DesktopControllerDependencies {
  readRenderer(filePath: string): Promise<string>;
  install(options: {
    rendererCdpEndpoint: string;
    rendererSource: string;
    enabledAgents: readonly string[];
    timeoutMs: number;
  }): Promise<RendererCdpControlSession>;
  startAttachmentServer(
    options: StartControllerAttachmentServerOptions,
  ): Promise<ControllerAttachmentServer>;
  ready(readiness: DesktopControllerReadiness): void;
  sleep(milliseconds: number): Promise<void>;
  now?(): number;
  monitorIntervalMs: number;
}

const PRODUCTION_INSTALL_TIMEOUT_MS = 90_000;
const RENDERER_CSP_BOOTSTRAP =
  "globalThis.__zod_globalConfig ??= {}; globalThis.__zod_globalConfig.jitless = true;";
const DESKTOP_CONTROLLER_READINESS_MAX_BYTES = 512;
const TRANSIENT_INSTALL_ATTEMPTS = 3;
const TRANSIENT_INSTALL_RETRY_MS = 250;
const RECOVERY_RETRY_INITIAL_MS = 30_000;
const RECOVERY_RETRY_MAX_MS = 300_000;
const startupTraceStartedAt = Date.now();

function startupTrace(stage: string, detail?: unknown): void {
  if (process.env.CODEXHOST_STARTUP_TRACE !== "1") return;
  const suffix =
    detail === undefined ? "" : `: ${detail instanceof Error ? detail.message : String(detail)}`;
  console.error(
    `[codexhost startup +${Date.now() - startupTraceStartedAt}ms] controller: ${stage}${suffix}`,
  );
}

export function serializeDesktopControllerReadiness(readiness: DesktopControllerReadiness): string {
  if (
    readiness.schemaVersion !== 2 ||
    readiness.state !== "compatible" ||
    !Array.isArray(readiness.issues) ||
    readiness.issues.length !== 0 ||
    Object.keys(readiness).length !== 3
  ) {
    throw new Error("Desktop Controller readiness is invalid");
  }
  const line = JSON.stringify(readiness);
  if (Buffer.byteLength(line, "utf8") > DESKTOP_CONTROLLER_READINESS_MAX_BYTES) {
    throw new Error("Desktop Controller readiness exceeds its size limit");
  }
  return line;
}

const defaultDependencies: DesktopControllerDependencies = {
  readRenderer: (filePath) => readFile(filePath, "utf8"),
  install: installRendererCdpControlSession,
  startAttachmentServer: startControllerAttachmentServer,
  ready: (readiness) => {
    process.stdout.write(`${serializeDesktopControllerReadiness(readiness)}\n`);
  },
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  monitorIntervalMs: 500,
};

function rendererCdpEndpoint(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error("--renderer-cdp-endpoint must be a loopback HTTP origin with an explicit port");
  }
  return url.origin;
}

export function parseDesktopControllerArguments(
  arguments_: readonly string[],
): DesktopControllerOptions {
  let endpoint: string | undefined;
  let rendererPath: string | undefined;
  let hostRuntimePath: string | undefined;
  let defaultAgent: "codex" | "pi" | "deepseek-harness" | "opencode" | undefined;
  let attachmentPort: number | undefined;
  let attachmentNonce: string | undefined;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const value = arguments_[index + 1];
    if (argument === "--renderer-cdp-endpoint") {
      if (endpoint !== undefined) {
        throw new Error("--renderer-cdp-endpoint may only be provided once");
      }
      if (!value) throw new Error("--renderer-cdp-endpoint requires a value");
      endpoint = rendererCdpEndpoint(value);
      index += 1;
      continue;
    }
    if (argument === "--renderer") {
      if (rendererPath !== undefined) throw new Error("--renderer may only be provided once");
      if (!value) throw new Error("--renderer requires a value");
      if (!path.isAbsolute(value)) throw new Error("--renderer must be an absolute path");
      rendererPath = path.normalize(value);
      index += 1;
      continue;
    }
    if (argument === "--host-runtime") {
      if (hostRuntimePath !== undefined) throw new Error("--host-runtime may only be provided once");
      if (!value || !path.isAbsolute(value)) throw new Error("--host-runtime must be an absolute path");
      hostRuntimePath = path.normalize(value);
      index += 1;
      continue;
    }
    if (argument === "--default-agent") {
      if (defaultAgent !== undefined) throw new Error("--default-agent may only be provided once");
      if (value !== "codex" && value !== "pi" && value !== "deepseek-harness" && value !== "opencode") {
        throw new Error("--default-agent must be 'codex', 'pi', 'deepseek-harness', or 'opencode'");
      }
      defaultAgent = value;
      index += 1;
      continue;
    }
    if (argument === "--attachment-port") {
      if (attachmentPort !== undefined) {
        throw new Error("--attachment-port may only be provided once");
      }
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error("--attachment-port must be a valid TCP port");
      }
      attachmentPort = port;
      index += 1;
      continue;
    }
    if (argument === "--attachment-nonce") {
      if (attachmentNonce !== undefined) {
        throw new Error("--attachment-nonce may only be provided once");
      }
      if (value === undefined || !/^[0-9a-f]{32}$/.test(value)) {
        throw new Error("--attachment-nonce must be 32 lowercase hexadecimal characters");
      }
      attachmentNonce = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown Desktop Controller option: ${argument}`);
  }
  if (endpoint === undefined) throw new Error("--renderer-cdp-endpoint is required");
  if (rendererPath === undefined) throw new Error("--renderer is required");
  if (defaultAgent === undefined) throw new Error("--default-agent is required");
  if (attachmentPort === undefined) throw new Error("--attachment-port is required");
  if (attachmentNonce === undefined) throw new Error("--attachment-nonce is required");
  return {
    rendererCdpEndpoint: endpoint,
    rendererPath,
    defaultAgent,
    attachmentPort,
    attachmentNonce,
    ...(hostRuntimePath ? { hostRuntimePath } : {}),
  };
}

function isTransientRendererInstallError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (
      message.includes("Execution context was destroyed") ||
      message.includes("Promise was collected")
    ) {
      return true;
    }
    current = current instanceof Error ? current.cause : undefined;
    if (current === undefined) break;
  }
  return false;
}

async function installProductionSession(
  options: Parameters<DesktopControllerDependencies["install"]>[0],
  dependencies: DesktopControllerDependencies,
): Promise<RendererCdpControlSession> {
  for (let attempt = 1; attempt <= TRANSIENT_INSTALL_ATTEMPTS; attempt += 1) {
    try {
      return await dependencies.install(options);
    } catch (error) {
      if (attempt === TRANSIENT_INSTALL_ATTEMPTS || !isTransientRendererInstallError(error)) {
        throw error;
      }
      await dependencies.sleep(TRANSIENT_INSTALL_RETRY_MS);
    }
  }
  throw new Error("Desktop Controller exhausted Renderer installation attempts");
}

export async function runDesktopController(
  options: DesktopControllerOptions,
  signal: AbortSignal,
  dependencies: DesktopControllerDependencies = defaultDependencies,
): Promise<void> {
  const now = dependencies.now ?? Date.now;
  let session: RendererCdpControlSession | undefined;
  let externalHost: ChildProcess | undefined;
  let externalHostEndpoint: string | undefined;
  const externalHostToken = randomBytes(32).toString("hex");
  const startExternalHost = async (): Promise<void> => {
    if (!options.hostRuntimePath) throw new Error("External Host runtime path is unavailable");
    const child = spawn(process.execPath, [options.hostRuntimePath, "--codexhost-external-host"], {
      env: { ...process.env, CODEXHOST_EXTERNAL_HOST_TOKEN: externalHostToken },
      stdio: ["ignore", "ignore", "pipe"],
    });
    externalHost = child;
    if (!child.stderr) throw new Error("External Host diagnostic stream is unavailable");
    const lines = createInterface({ input: child.stderr });
    externalHostEndpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("External Host did not become ready")), 30_000);
      lines.on("line", (line) => {
        const match = line.match(/listening at (http:\/\/127\.0\.0\.1:\d+\/rpc)$/u);
        if (!match) return;
        clearTimeout(timer);
        const endpoint = match[1];
        if (endpoint) resolve(endpoint);
      });
      child.once("exit", (code) => reject(new Error(`External Host exited (${code ?? "unknown"})`)));
    });
  };
  const stopExternalHost = (): void => {
    if (externalHost && externalHost.exitCode === null) externalHost.kill();
    externalHost = undefined;
  };
  if (options.hostRuntimePath) await startExternalHost();
  const externalConfig = externalHostEndpoint
    ? `, externalHostEndpoint: ${JSON.stringify(externalHostEndpoint)}, externalHostToken: ${JSON.stringify(externalHostToken)}`
    : "";
  const configuration = `Object.defineProperty(window, "__codexhostProductionConfigV1", { configurable: true, value: { defaultAgent: ${JSON.stringify(options.defaultAgent)}${externalConfig} } });`;
  let nextRecoveryAt = 0;
  let recoveryDelayMs = RECOVERY_RETRY_INITIAL_MS;
  const recordRecoveryFailure = (): void => {
    nextRecoveryAt = now() + recoveryDelayMs;
    recoveryDelayMs = Math.min(recoveryDelayMs * 2, RECOVERY_RETRY_MAX_MS);
  };
  const recordRecoverySuccess = (): void => {
    nextRecoveryAt = 0;
    recoveryDelayMs = RECOVERY_RETRY_INITIAL_MS;
  };
  const createSession = async (): Promise<RendererCdpControlSession> => {
    startupTrace("reading Renderer bundle");
    const rendererSource = await dependencies.readRenderer(options.rendererPath);
    if (rendererSource.trim().length === 0) throw new Error("production Renderer Bundle is empty");
    startupTrace("installing Renderer Session");
    const installed = await installProductionSession(
      {
        rendererCdpEndpoint: options.rendererCdpEndpoint,
        rendererSource: `${RENDERER_CSP_BOOTSTRAP}\n${configuration}\n${rendererSource}`,
        enabledAgents: [
          "codex",
          "deepseek-harness",
          "opencode",
        ],
        timeoutMs: PRODUCTION_INSTALL_TIMEOUT_MS,
      },
      dependencies,
    );
    startupTrace("Renderer Session installed");
    return installed;
  };
  startupTrace("initialization started");
  try {
    session = await createSession();
    recordRecoverySuccess();
  } catch (error) {
    startupTrace("initial Renderer Session unavailable", error);
    session = undefined;
    recordRecoveryFailure();
  }

  let operation = Promise.resolve<unknown>(undefined);
  const useSession = <T>(callback: () => Promise<T>): Promise<T> => {
    const next = operation.then(callback, callback);
    operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  const resetSession = (): void => {
    session?.close();
    session = undefined;
  };
  const ensureSession = async (): Promise<RendererCdpControlSession> => {
    if (!session) session = await createSession();
    else await session.ensureInstalled();
    return session;
  };
  const recoverSession = async (): Promise<RendererCdpControlSession> => {
    try {
      const current = await ensureSession();
      recordRecoverySuccess();
      return current;
    } catch (error) {
      resetSession();
      recordRecoveryFailure();
      throw error;
    }
  };

  let attachmentServer: ControllerAttachmentServer | undefined;
  try {
    startupTrace("starting attachment server");
    attachmentServer = await dependencies.startAttachmentServer({
      port: options.attachmentPort,
      nonce: options.attachmentNonce,
      attach: () =>
        useSession(async () => {
          const current = await recoverSession();
          await current.activateDesktop();
        }),
    });
    startupTrace("attachment server ready");
    startupTrace("publishing readiness");
    dependencies.ready({
      schemaVersion: 2,
      state: "compatible",
      issues: [],
    });
    while (!signal.aborted) {
      await dependencies.sleep(dependencies.monitorIntervalMs);
      if (signal.aborted) continue;
      await useSession(async () => {
        if (!session && now() < nextRecoveryAt) return;
        try {
          await recoverSession();
        } catch {
          // Renderer integration remains unavailable until a later bounded retry succeeds.
        }
      });
    }
  } finally {
    await attachmentServer?.close();
    await operation;
    resetSession();
    stopExternalHost();
  }
}
