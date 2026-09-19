import { retainRendererHostResponses } from "./renderer-host-response-ownership.js";

export interface RendererDebugger {
  isAttached(): boolean;
  attach(version: string): void;
  detach(): void;
  sendCommand(method: string, parameters?: Record<string, unknown>): Promise<unknown>;
}

export interface RendererWebContents {
  isDestroyed(): boolean;
  getType(): string;
  debugger: RendererDebugger;
}

export interface DraftPrewarmPolicyTarget {
  [key: string]: unknown;
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
  dispatchEvent?: (event: Event) => boolean;
  removeEventListener?: (type: string, listener: (event: Event) => void) => void;
}

export interface RendererHostRequestBridge {
  sendRequest(method: string, parameters: unknown, options?: unknown): unknown;
  prewarmThreadStart(parameters: unknown, options?: unknown): unknown;
  enqueueRequest(
    method: string,
    parameters: unknown,
    options?: unknown,
    dispatch?: (request: Record<string, unknown>) => void,
  ): unknown;
  onResult(id: unknown, result: unknown, metrics?: unknown): void;
  onError(id: unknown, error: unknown, metrics?: unknown): void;
}

export interface RendererHostRequestManager {
  onNotification(method: string, parameters: unknown): void;
  onRequest(request: Record<string, unknown>): void;
  dispatchAppServerResponse(method: string, response: Record<string, unknown>): unknown;
}

export interface RendererPrewarmedThreadManager {
  discardAllPrewarmedThreads(): void;
}

export function installDraftPrewarmPolicyBridge(
  manager: RendererHostRequestManager,
  bridge: RendererHostRequestBridge,
  hostId: string,
  target: DraftPrewarmPolicyTarget,
  prewarmedThreadManager: RendererPrewarmedThreadManager,
  isCurrentManager?: () => boolean,
  retainResponses: typeof retainRendererHostResponses = retainRendererHostResponses,
): { state: "ready"; reason: "owned-request-bridge" } {
  const existing = target.__codexhostDraftPrewarmPolicyV1 as { dispose?: () => void } | undefined;
  existing?.dispose?.();
  const originalSend = bridge.sendRequest;
  const originalPrewarm = bridge.prewarmThreadStart;
  const originalOnNotification = manager.onNotification;
  let selectedModel: string | null = null;
  const route = (parameters: unknown): unknown =>
    selectedModel === null || typeof parameters !== "object" || parameters === null
      ? parameters
      : { ...(parameters as Record<string, unknown>), model: selectedModel };
  bridge.sendRequest = (method, parameters, options) =>
    method === "thread/start" && typeof parameters === "object" && parameters !== null && (parameters as Record<string, unknown>).ephemeral !== true
      ? options === undefined ? originalSend.call(bridge, method, route(parameters)) : originalSend.call(bridge, method, route(parameters), options)
      : options === undefined ? originalSend.call(bridge, method, parameters) : originalSend.call(bridge, method, parameters, options);
  bridge.prewarmThreadStart = (parameters, options) =>
    options === undefined ? originalPrewarm.call(bridge, route(parameters)) : originalPrewarm.call(bridge, route(parameters), options);
  const policy = {
    owns: (candidateManager: unknown, candidate: unknown, candidateHostId: string) => candidateManager === manager && candidate === bridge && candidateHostId === hostId,
    requestTarget: () => {
      if (isCurrentManager && !isCurrentManager()) throw new Error("Renderer request manager is retired");
      return manager;
    },
    select: (model: string | null) => {
      if (model !== null && !model.startsWith("codexhost/")) throw new Error("Draft route Model must be a codexhost transport carrier");
      const changed = selectedModel !== model; selectedModel = model; return changed;
    },
    clear: () => { prewarmedThreadManager.discardAllPrewarmedThreads(); return Promise.resolve(); },
    dispose: () => {
      retainResponses(bridge, hostId, target);
      if (bridge.sendRequest !== originalSend) bridge.sendRequest = originalSend;
      if (bridge.prewarmThreadStart !== originalPrewarm) bridge.prewarmThreadStart = originalPrewarm;
      if (manager.onNotification !== originalOnNotification) manager.onNotification = originalOnNotification;
      selectedModel = null;
    },
  };
  Object.defineProperty(target, "__codexhostDraftPrewarmPolicyV1", { configurable: true, value: policy });
  return { state: "ready", reason: "owned-request-bridge" };
}

export async function installDraftPrewarmPolicyInRenderer(
  contents: RendererWebContents | null,
  findRequestManagerExpression: string,
  installRendererPolicyFunction: string,
): Promise<unknown> {
  if (contents === null || contents.isDestroyed() || contents.getType() !== "window") {
    throw new Error("Owned Renderer is unavailable for draft prewarm policy");
  }

  let attachedHere = false;
  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach("1.3");
      attachedHere = true;
    }
    await contents.debugger.sendCommand("Runtime.enable");
    const managerResult = (await contents.debugger.sendCommand("Runtime.evaluate", {
      expression: findRequestManagerExpression,
    })) as { result?: { objectId?: unknown } };
    const managerResultId = managerResult.result?.objectId;
    if (typeof managerResultId !== "string") {
      throw new Error("Renderer request manager inspection failed");
    }
    const managerProperties = (await contents.debugger.sendCommand("Runtime.getProperties", {
      objectId: managerResultId,
      ownProperties: true,
    })) as {
      result?: Array<{
        name?: unknown;
        value?: { objectId?: unknown; value?: unknown };
      }>;
    };
    const candidateCount = managerProperties.result?.find(
      (property) => property.name === "candidateCount",
    )?.value?.value;
    const hostId = managerProperties.result?.find((property) => property.name === "hostId")?.value
      ?.value;
    const manager = managerProperties.result?.find(
      (property) => property.name === "manager",
    )?.value;
    const requestClient = managerProperties.result?.find(
      (property) => property.name === "requestClient",
    )?.value;
    const prewarmedThreadManager = managerProperties.result?.find(
      (property) => property.name === "prewarmedThreadManager",
    )?.value;
    if (
      candidateCount !== 1 ||
      typeof hostId !== "string" ||
      hostId.length === 0 ||
      typeof manager?.objectId !== "string" ||
      typeof requestClient?.objectId !== "string"
    ) {
      throw new Error("Renderer request manager is ambiguous");
    }
    if (typeof prewarmedThreadManager?.objectId !== "string") {
      throw new Error("Renderer prewarmed Thread manager is unavailable");
    }

    const installed = (await contents.debugger.sendCommand("Runtime.callFunctionOn", {
      objectId: manager.objectId,
      functionDeclaration: installRendererPolicyFunction,
      arguments: [
        { objectId: requestClient.objectId },
        { value: hostId },
        { objectId: prewarmedThreadManager.objectId },
      ],
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return installed.result?.value;
  } finally {
    if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
  }
}
