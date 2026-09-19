import { sendExternalHostRequest } from "./renderer-model-client.js";

const EXTERNAL_MODEL_PREFIXES = [
  "codexhost/deepseek-harness-native",
  "codexhost/opencode-native",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExternalModel(value: unknown): boolean {
  return typeof value === "string" && EXTERNAL_MODEL_PREFIXES.some((prefix) => value.startsWith(`${prefix}@`) || value === prefix);
}

export function installRendererExternalChannel(target: unknown): (() => void) | null {
  if (!isRecord(target) || typeof target.sendRequest !== "function") return null;
  const manager = target as { sendRequest: (...args: unknown[]) => unknown };
  const original = manager.sendRequest;
  const externalThreads = new Set<string>();
  const callbacks = new Map<string, Set<(value: unknown) => void>>();
  const originalAddNotificationCallback = (target as { addNotificationCallback?: unknown }).addNotificationCallback;
  if (typeof originalAddNotificationCallback === "function") {
    (target as { addNotificationCallback: (...args: unknown[]) => unknown }).addNotificationCallback = function (methods: unknown, callback: unknown) {
      const names = Array.isArray(methods) ? methods : [methods];
      if (typeof callback === "function") {
        for (const name of names) {
          if (typeof name !== "string") continue;
          const set = callbacks.get(name) ?? new Set<(value: unknown) => void>();
          set.add(callback as (value: unknown) => void);
          callbacks.set(name, set);
        }
      }
      const unsubscribe = (originalAddNotificationCallback as (...args: unknown[]) => unknown).apply(target, [methods, callback]);
      return () => {
        if (typeof unsubscribe === "function") unsubscribe();
        for (const name of names) {
          const set = callbacks.get(name);
          set?.delete(callback as (value: unknown) => void);
          if (set?.size === 0) callbacks.delete(name);
        }
      };
    };
  }
  const configuration = (window as Window & { __codexhostExternalHostV1?: { endpoint: string; token: string } }).__codexhostExternalHostV1;
  const events = configuration ? new WebSocket(configuration.endpoint.replace(/\/rpc$/u, `/events?token=${configuration.token}`)) : null;
  events?.addEventListener("error", () => undefined);
  events?.addEventListener("message", (event) => {
    try {
      const value = JSON.parse(String(event.data));
      if (!isRecord(value) || typeof value.method !== "string") return;
      for (const callback of callbacks.get(value.method) ?? []) callback(value);
    } catch {
      // Ignore malformed event frames; request errors remain visible through RPC responses.
    }
  });
  manager.sendRequest = function (...args: unknown[]) {
    const [method, params, ...rest] = args;
    if (typeof method !== "string") return original.apply(manager, args);
    const record = isRecord(params) ? params : null;
    const threadId = record && typeof record.threadId === "string" ? record.threadId : null;
    const route = method.startsWith("codexhost/") ||
      (method === "thread/start" && record && isExternalModel(record.model)) ||
      (threadId !== null && externalThreads.has(threadId));
    if (!route) return original.call(manager, method, params, ...rest);
    return Promise.resolve(sendExternalHostRequest(method, params)).then((value) => {
      if (method === "thread/start" && isRecord(value)) {
        const thread = isRecord(value.thread) ? value.thread : null;
        if (thread && typeof thread.id === "string") {
          externalThreads.add(thread.id);
          if (externalThreads.size > 4096) {
            const oldest = externalThreads.values().next().value;
            if (typeof oldest === "string") externalThreads.delete(oldest);
          }
        }
      }
      if (method === "thread/delete" && threadId) externalThreads.delete(threadId);
      return value;
    });
  };
  return () => {
    manager.sendRequest = original;
    if (typeof originalAddNotificationCallback === "function") {
      (target as { addNotificationCallback: unknown }).addNotificationCallback = originalAddNotificationCallback;
    }
    events?.close();
    externalThreads.clear();
  };
}
