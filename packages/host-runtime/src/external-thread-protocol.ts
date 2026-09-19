import type { Readable, Writable } from "node:stream";

import type { HarnessPluginContext } from "@codexhost/harness-adapter/plugin";

import type { ExternalThreadStore } from "./external-thread-repository.js";

/**
 * External protocol composition boundary.
 *
 * The boundary owns the legacy JSON-RPC projection implementation while the
 * public ExternalThreadHost no longer knows about official runtime options.
 * `externalOnly` is mandatory here so a future projector cannot accidentally
 * create an official Codex backend.
 */
export function createExternalThreadProtocol(input: {
  environment: NodeJS.ProcessEnv;
  input: Readable;
  output: Writable;
  diagnosticOutput: Writable;
  pluginRoots: readonly string[];
  pluginContext: HarnessPluginContext;
  mappingStore: ExternalThreadStore;
}): { run(): Promise<number>; close(): void } {
  let host: { run(): Promise<number>; close(): void } | undefined;
  let closing = false;
  const load = async (): Promise<typeof host> => {
    if (host) return host;
    const { AppServerHost } = await import("./app-server-host.js");
    host = new AppServerHost({
      stockCodexPath: "",
      arguments: [],
      defaultAgent: "codex",
      environment: input.environment,
      desktopInput: input.input,
      desktopOutput: input.output,
      diagnosticOutput: input.diagnosticOutput,
      externalOnly: true,
      pluginRoots: input.pluginRoots,
      pluginContext: input.pluginContext,
      mappingStore: input.mappingStore,
    });
    if (closing) host.close();
    return host;
  };
  return {
    run: async () => (await load())?.run() ?? 0,
    close: () => {
      closing = true;
      if (host) host.close();
    },
  };
}
