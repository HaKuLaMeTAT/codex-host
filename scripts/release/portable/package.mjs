import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
const outputRoot = path.join(root, "build", "portable", `codexhost-light-${version}`);
const zipPath = `${outputRoot}.zip`;
const appRoot = path.join(outputRoot, "app");
const runtimeRoot = path.join(outputRoot, "runtime");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await rm(outputRoot, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(appRoot, { recursive: true });
await mkdir(runtimeRoot, { recursive: true });

await run(process.execPath, ["scripts/release/harness-plugins.mjs", "--output", path.join(appRoot, "plugins")]);
await run(process.execPath, ["packages/host-runtime/scripts/build-release.mjs", "--output", path.join(appRoot, "host-runtime.mjs")]);
await run(process.execPath, ["packages/desktop-control/scripts/build-release.mjs", "--output", path.join(appRoot, "desktop-controller.mjs")]);
await run(process.execPath, ["packages/renderer-extension/scripts/build.mjs"]);

await copyFile(path.join(root, "packages/renderer-extension/dist/production.js"), path.join(appRoot, "renderer-extension.js"));
await copyFile(path.join(root, "scripts/release/portable/launcher.mjs"), path.join(appRoot, "portable-launcher.mjs"));
await copyFile(path.join(root, "scripts/release/portable/start.cmd"), path.join(outputRoot, "start.cmd"));
await copyFile(path.join(root, "scripts/release/portable/start.vbs"), path.join(outputRoot, "start.vbs"));
await copyFile(path.join(root, "scripts/release/portable/create-shortcut.ps1"), path.join(outputRoot, "create-shortcut.ps1"));
await copyFile(process.execPath, path.join(runtimeRoot, "node.exe"));
await writeFile(path.join(outputRoot, "README.txt"), "双击 start.vbs 启动 codexhost light；首次使用可运行 create-shortcut.ps1 创建桌面快捷方式。\r\n", "utf8");

if (process.platform === "win32") {
  await run("tar.exe", ["-a", "-c", "-f", zipPath, "-C", outputRoot, "."]);
}
console.log(`portable=${outputRoot}`);
if (process.platform === "win32") console.log(`zip=${zipPath}`);
