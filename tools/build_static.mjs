import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

async function copyFile(source, destination = source) {
  const target = path.join(dist, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(root, source), target);
}

await rm(dist, { force: true, recursive: true });
await mkdir(dist);

for (const file of ["index.html", "styles.css", "app.js", "_routes.json"]) {
  await copyFile(file);
}

await cp(path.join(root, "data"), path.join(dist, "data"), { recursive: true });
console.log(`Built ${dist}`);
