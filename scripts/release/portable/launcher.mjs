import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readdir, stat } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.join(packageRoot, "app");
const nodePath = path.join(packageRoot, "runtime", "node.exe");
const hostRuntimePath = path.join(appRoot, "host-runtime.mjs");
const controllerPath = path.join(appRoot, "desktop-controller.mjs");
const rendererPath = path.join(appRoot, "renderer-extension.js");
const logRoot = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), "codexhost-light");
const logPath = path.join(logRoot, "launcher.log");

async function log(message, error) {
  await mkdir(logRoot, { recursive: true });
  const detail = error instanceof Error ? `: ${error.stack ?? error.message}` : error ? `: ${String(error)}` : "";
  await appendFile(logPath, `[${new Date().toISOString()}] ${message}${detail}\n`, "utf8");
}

function showError(message) {
  const escaped = message.replace(/'/gu, "''");
  const command = `$ErrorActionPreference='SilentlyContinue'; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${escaped}','codexhost light') | Out-Null`;
  const child = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command], { windowsHide: true, stdio: "ignore" });
  child.unref();
}

async function fileExists(filePath) {
  try { await stat(filePath); return true; } catch { return false; }
}

function runningCodexProcesses() {
  return new Promise((resolve) => {
    const command = "Get-CimInstance Win32_Process -Filter \"Name = 'ChatGPT.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
    execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command], { windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error || !stdout.trim()) { resolve([]); return; }
      try {
        const value = JSON.parse(stdout);
        resolve(Array.isArray(value) ? value : [value]);
      } catch { resolve([]); }
    });
  });
}

function cdpPortFromCommandLine(commandLine) {
  const match = String(commandLine ?? "").match(/--remote-debugging-port[= ](\d{1,5})/u);
  const port = match ? Number(match[1]) : 0;
  return port > 0 && port <= 65_535 ? port : undefined;
}

async function installationFromExecutable(executable) {
  if (!executable || executable.toLowerCase().includes("\\windowsapps\\")) return undefined;
  const appRootCandidate = path.dirname(executable);
  if (path.basename(appRootCandidate).toLowerCase() !== "app") return undefined;
  if (!(await fileExists(path.join(appRootCandidate, "resources", "app.asar")))) return undefined;
  return { root: path.dirname(appRootCandidate), executable };
}

async function findRunningCodex() {
  for (const process of await runningCodexProcesses()) {
    const installation = await installationFromExecutable(process.ExecutablePath);
    if (installation) return { installation, cdpPort: cdpPortFromCommandLine(process.CommandLine) };
  }
  return undefined;
}

function installationRootCandidates() {
  const roots = new Set();
  const add = (root) => { if (root) roots.add(path.normalize(root)); };
  add(process.env.CODEXHOST_INSTALL_ROOT);
  add(path.dirname(packageRoot));
  add(path.dirname(path.dirname(packageRoot)));
  const localAppData = process.env.LOCALAPPDATA;
  const userProfile = process.env.USERPROFILE;
  for (const base of [localAppData, userProfile && path.join(userProfile, "Downloads"), userProfile && path.join(userProfile, "Desktop")]) {
    add(base);
    if (base) add(path.join(base, "Programs"));
  }
  return [...roots];
}

async function readDirectoryCandidates(root, depth = 0) {
  const candidates = [root];
  if (depth >= 2) return candidates;
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return candidates; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const name = entry.name.toLowerCase();
    if (!name.includes("codex") && !name.includes("openai")) continue;
    candidates.push(...(await readDirectoryCandidates(path.join(root, entry.name), depth + 1)));
  }
  return candidates;
}

async function findCodexInstallation() {
  const candidates = [];
  for (const root of installationRootCandidates()) candidates.push(...(await readDirectoryCandidates(root)));
  for (const root of [...new Set(candidates)]) {
    const appRootCandidate = path.basename(root).toLowerCase() === "app" ? root : path.join(root, "app");
    const executable = path.join(appRootCandidate, "ChatGPT.exe");
    if (await fileExists(executable) && await fileExists(path.join(appRootCandidate, "resources", "app.asar"))) {
      return { root: path.dirname(appRootCandidate), executable };
    }
  }
  throw new Error("找不到解压版 Codex。请设置 CODEXHOST_INSTALL_ROOT 或把 Codex 放到常见目录。");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${label} 启动失败: ${error.message}`)));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForControllerReady(controller) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Desktop Controller 未在 90 秒内就绪")), 90_000);
    controller.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/gu);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const readiness = JSON.parse(line);
          if (readiness.schemaVersion === 2 && readiness.state === "compatible") {
            clearTimeout(timer); resolve(); return;
          }
        } catch { /* diagnostics are intentionally ignored here */ }
      }
    });
    controller.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Desktop Controller 已退出 (${code ?? "unknown"})`)); });
  });
}

async function main() {
  await log("portable launcher started");
  for (const required of [nodePath, hostRuntimePath, controllerPath, rendererPath]) {
    if (!(await fileExists(required))) throw new Error(`便携包缺少文件: ${required}`);
  }
  const running = await findRunningCodex();
  if (running && !running.cdpPort) throw new Error("Codex 已在运行但未开启 CDP，请先退出 Codex，再双击 codexhost light 快捷方式。");
  const installation = running?.installation ?? await findCodexInstallation();
  const rendererPort = running?.cdpPort ?? await freePort();
  const attachmentPort = await freePort();
  const nonce = randomBytes(16).toString("hex");
  await log(`starting Codex from ${installation.executable}`);
  const desktop = running ? undefined : spawn(installation.executable, ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${rendererPort}`], { detached: false, windowsHide: true, stdio: "ignore" });
  const logHandle = await open(logPath, "a");
  const controller = spawn(nodePath, [controllerPath, "--renderer-cdp-endpoint", `http://127.0.0.1:${rendererPort}`, "--renderer", rendererPath, "--host-runtime", hostRuntimePath, "--default-agent", "codex", "--attachment-port", String(attachmentPort), "--attachment-nonce", nonce], { windowsHide: true, stdio: ["ignore", "pipe", logHandle.fd] });
  try {
    await waitForControllerReady(controller);
    await log("Desktop Controller ready");
    const result = await Promise.race([waitForExit(controller, "Desktop Controller"), ...(desktop ? [waitForExit(desktop, "Codex Desktop")] : [])]);
    await log(`managed process exited: ${JSON.stringify(result)}`);
  } finally {
    if (controller.exitCode === null) controller.kill();
    if (desktop && desktop.exitCode === null) desktop.kill();
    await logHandle.close();
  }
}

main().catch(async (error) => {
  await log("portable launcher failed", error);
  showError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
