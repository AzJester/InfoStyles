// Read-only seed skills for the Skills tab, committed as
// public/data/skills.json. Loaded once per process; a missing or corrupt file
// degrades to an empty seed list rather than breaking /api/skills.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "data",
  "skills.json"
);

let cache;
export function seedSkills() {
  if (!cache) {
    try {
      const parsed = JSON.parse(readFileSync(DATA_PATH, "utf8"));
      cache = Array.isArray(parsed) ? parsed : [];
    } catch {
      cache = [];
    }
  }
  return cache;
}
