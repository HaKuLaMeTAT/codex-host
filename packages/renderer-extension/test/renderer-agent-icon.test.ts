import { describe, expect, it } from "vitest";

import { createRendererAgentIcon } from "../src/renderer-agent-icon.js";

describe("Renderer Agent icons", () => {
  it("renders vector icons for the current external agents", () => {
    const ownerDocument = {
      createElementNS(_namespace: string, tagName: string) {
        return {
          tagName,
          setAttribute() {},
          append() {},
          style: {},
        };
      },
    } as unknown as Document;
    expect(createRendererAgentIcon("opencode", 16, ownerDocument)).toBeTruthy();
    expect(createRendererAgentIcon("deepseek-harness", 16, ownerDocument)).toBeTruthy();
  });

  it.each(["antigravity", "kiro-cli", "codebuddy", "workbuddy", "cursor-cli", "qoder", "qoder-cn"] as const)(
    "renders %s as inline vector fallback",
    (agent) => {
      const svg = {
        tagName: "svg",
        setAttribute() {},
        append() {},
        style: {},
      };
      const ownerDocument = {
        createElementNS(_namespace: string, tagName: string) {
          if (tagName === "svg") return svg;
          return { setAttribute() {} };
        },
      } as unknown as Document;
      expect(createRendererAgentIcon(agent, 16, ownerDocument)).toBe(svg);
    },
  );
});
