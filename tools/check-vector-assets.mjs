import { readdir } from "node:fs/promises";
import path from "node:path";

const roots = ["packages", "scripts/release/windows"];
const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const violations = [];

async function walk(relativeRoot) {
  const absoluteRoot = path.resolve(relativeRoot);
  let entries;
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relative = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      await walk(relative);
      continue;
    }
    if (rasterExtensions.has(path.extname(entry.name).toLowerCase())) violations.push(relative);
  }
}

for (const root of roots) await walk(root);
if (violations.length > 0) {
  throw new Error(`Raster assets are forbidden in the product tree:\n${violations.join("\n")}`);
}
console.log("Vector asset check passed.");
