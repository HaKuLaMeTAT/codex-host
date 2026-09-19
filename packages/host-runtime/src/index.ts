import { packageMetadata as desktopControl } from "@codexhost/desktop-control";
import { packageMetadata as harnessAdapter } from "@codexhost/harness-adapter";
import { packageMetadata as mappingStore } from "@codexhost/mapping-store";
import { packageMetadata as protocolCore } from "@codexhost/protocol-core";
import { packageMetadata as sharedContracts } from "@codexhost/shared-contracts";
import { packageMetadata as updateManager } from "@codexhost/update-manager";

export { loadHarnessPlugins } from "./harness-plugin-loader.js";
export type {
  LoadHarnessPluginsOptions,
  HarnessPluginDiagnostic,
} from "./harness-plugin-loader.js";
export { HarnessPluginRegistry } from "./harness-plugin-registry.js";
export { installedHarnessPluginOptions } from "./installed-harness-plugins.js";
export {
  startExternalOnlyHostServer,
  EXTERNAL_HOST_PORT_ENV,
  EXTERNAL_HOST_TOKEN_ENV,
} from "./external-only-host.js";
export { ExternalThreadHost } from "./external-thread-host.js";
export const packageMetadata = {
  name: "@codexhost/host-runtime",
  dependencies: [
    protocolCore.name,
    desktopControl.name,
    harnessAdapter.name,
    mappingStore.name,
    sharedContracts.name,
    updateManager.name,
  ],
} as const;
