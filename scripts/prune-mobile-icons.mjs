import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const iconDirectory = path.resolve(scriptDirectory, "../src-tauri/icons");
const mobileDirectories = ["android", "ios"];

await Promise.all(
  mobileDirectories.map((directory) =>
    rm(path.join(iconDirectory, directory), { recursive: true, force: true }),
  ),
);

console.log("Removed generated Android and iOS icon assets (desktop-only project).");
