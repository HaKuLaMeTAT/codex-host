import { describe, expect, it } from "vitest";
import type { JsonRpcRequest } from "@codexhost/protocol-core";

import { packageMetadata } from "../src/index.js";
import { classifyCreateRequestRoute } from "../src/app-server-host.js";

describe("host-runtime package", () => {
  it("declares the composition-root dependencies", () => {
    expect(packageMetadata.dependencies).toHaveLength(6);
    expect(
      packageMetadata.dependencies.some((name) => name.startsWith("@codexhost/adapter-")),
    ).toBe(false);
    expect(packageMetadata.dependencies).toContain("@codexhost/protocol-core");
    expect(packageMetadata.dependencies).toContain("@codexhost/harness-adapter");
    expect(packageMetadata.dependencies).toContain("@codexhost/shared-contracts");
    expect(packageMetadata.dependencies).toContain("@codexhost/update-manager");
  });

  it("classifies create routes without exposing Model values or request IDs", () => {
    const request = (model: string): JsonRpcRequest => ({
      id: 42,
      method: "thread/start",
      params: { model },
    });

    expect(classifyCreateRequestRoute(request("official/model"), "codex")).toEqual({
      requestMethod: "thread/start",
      modelCarrier: "official-model",
      selectedHarness: "codex",
      selectionSource: "official-model",
    });
    expect(classifyCreateRequestRoute(request("codexhost/opencode-native"), "codex")).toEqual({
      requestMethod: "thread/start",
      modelCarrier: "opencode-transport",
      selectedHarness: "opencode",
      selectionSource: "transport-model",
    });
    expect(
      classifyCreateRequestRoute(request("codexhost/deepseek-harness-native"), "codex"),
    ).toEqual({
      requestMethod: "thread/start",
      modelCarrier: "deepseek-harness-transport",
      selectedHarness: "deepseek-harness",
      selectionSource: "transport-model",
    });
    expect(
      classifyCreateRequestRoute({ id: 43, method: "thread/read", params: {} }, "codex"),
    ).toBeNull();
  });
});
