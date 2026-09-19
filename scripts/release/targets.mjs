export const NODE_VERSION = "24.13.1";
export const NODE_DIST_BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;

export const RELEASE_TARGETS = Object.freeze({
  "windows-x64": Object.freeze({
    id: "windows-x64",
    hostPlatform: "win32",
    rustTarget: "x86_64-pc-windows-msvc",
    installerArchitecture: "x64",
    executableSuffix: ".exe",
    nodeArchive: `node-v${NODE_VERSION}-win-x64.zip`,
    nodeArchiveSha256: "fba577c4bb87df04d54dd87bbdaa5a2272f1f99a2acbf9152e1a91b8b5f0b279",
    nodeArchiveFormat: "zip",
    nodeArchiveRoot: `node-v${NODE_VERSION}-win-x64`,
    nodeExecutable: "node.exe",
  }),
  "windows-arm64": Object.freeze({
    id: "windows-arm64",
    hostPlatform: "win32",
    rustTarget: "aarch64-pc-windows-msvc",
    installerArchitecture: "arm64",
    executableSuffix: ".exe",
    nodeArchive: `node-v${NODE_VERSION}-win-arm64.zip`,
    nodeArchiveSha256: "0cd29eeb64f3c649db2c4c868779ca277f5a4c49e26c69e5928d01fe0ae06da8",
    nodeArchiveFormat: "zip",
    nodeArchiveRoot: `node-v${NODE_VERSION}-win-arm64`,
    nodeExecutable: "node.exe",
  }),
});

export function supportedReleaseTargets() {
  return Object.keys(RELEASE_TARGETS);
}

export function installerReleaseTargets() {
  return supportedReleaseTargets().filter(
    (target) => RELEASE_TARGETS[target].installerArchitecture !== undefined,
  );
}

export function releaseTarget(name) {
  if (!Object.hasOwn(RELEASE_TARGETS, name)) {
    throw new Error(
      `unknown release target '${name}'; expected one of: ${supportedReleaseTargets().join(", ")}`,
    );
  }
  return RELEASE_TARGETS[name];
}

export function releaseTargetForHost(name, hostPlatform = process.platform) {
  const target = releaseTarget(name);
  if (target.hostPlatform !== hostPlatform) {
    throw new Error(
      `release target '${name}' requires host platform '${target.hostPlatform}', current host is '${hostPlatform}'`,
    );
  }
  return target;
}

export function hostReleaseTargetId(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") return "windows-x64";
  if (platform === "win32" && arch === "arm64") return "windows-arm64";
  throw new Error(`unsupported npm release host: ${platform}/${arch}`);
}

export function hostReleaseTarget(platform = process.platform, arch = process.arch) {
  return releaseTarget(hostReleaseTargetId(platform, arch));
}

export function releaseUsage() {
  return [
    "usage: npm run release:package -- --target <target>",
    `targets: ${installerReleaseTargets().join(", ")}`,
  ].join("\n");
}

export function npmReleaseUsage() {
  return [
    "usage: npm run release:npm -- [--target <target>] [--version <semver>] [--pack] [--skip-build]",
    `targets: ${supportedReleaseTargets().join(", ")} (default: current host)`,
  ].join("\n");
}

export function parseReleaseArguments(arguments_, hostPlatform = process.platform) {
  let targetName;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--target") {
      if (targetName !== undefined) throw new Error("--target may only be provided once");
      targetName = arguments_[index + 1];
      if (!targetName) throw new Error("--target requires a value");
      index += 1;
      continue;
    }
    if (argument.startsWith("--target=")) {
      if (targetName !== undefined) throw new Error("--target may only be provided once");
      targetName = argument.slice("--target=".length);
      if (!targetName) throw new Error("--target requires a value");
      continue;
    }
    throw new Error(`unknown release option: ${argument}`);
  }
  if (targetName === undefined) throw new Error("--target is required");
  if (!installerReleaseTargets().includes(targetName)) {
    throw new Error(
      `release target '${targetName}' has no installer; expected one of: ${installerReleaseTargets().join(", ")}`,
    );
  }
  return { help: false, target: releaseTargetForHost(targetName, hostPlatform) };
}
