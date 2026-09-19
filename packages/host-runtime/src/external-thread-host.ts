import type { Readable, Writable } from "node:stream";

import type { HarnessPluginContext } from "@codexhost/harness-adapter/plugin";

import { createExternalThreadProtocol } from "./external-thread-protocol.js";
import type { ExternalThreadStore } from "./external-thread-repository.js";

/**
 * External-only composition boundary. Official runtime options are not part
 * of this public host and are unavailable to callers.
 */
export class ExternalThreadHost {
  readonly #host: ReturnType<typeof createExternalThreadProtocol>;

  constructor(input: {
    environment: NodeJS.ProcessEnv;
    input: Readable;
    output: Writable;
    diagnosticOutput: Writable;
    pluginRoots: readonly string[];
    pluginContext: HarnessPluginContext;
    mappingStore: ExternalThreadStore;
  }) {
    this.#host = createExternalThreadProtocol(input);
  }

  run(): Promise<number> {
    return this.#host.run();
  }

  close(): void {
    this.#host.close();
  }
}
