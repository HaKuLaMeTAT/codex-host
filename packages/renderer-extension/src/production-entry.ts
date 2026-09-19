import { DEFAULT_RENDERER_AGENTS, type RendererAgent } from "./agent-selection-state.js";
import { installRendererBinding } from "./install-renderer-binding.js";

declare global {
  interface Window {
    __codexhostProductionConfigV1?: {
      defaultAgent: RendererAgent;
      externalHostEndpoint?: string;
      externalHostToken?: string;
    };
  }
}

const configuration = window.__codexhostProductionConfigV1;
delete window.__codexhostProductionConfigV1;

if (configuration?.externalHostEndpoint && configuration.externalHostToken) {
  window.__codexhostExternalHostV1 = {
    endpoint: configuration.externalHostEndpoint,
    token: configuration.externalHostToken,
  };
}

const install = (): void => {
  installRendererBinding(DEFAULT_RENDERER_AGENTS, configuration?.defaultAgent ?? "codex");
};

if (document.documentElement && document.body) {
  install();
} else {
  window.addEventListener("DOMContentLoaded", install, { once: true });
}
