// Read-only seed prompts for the Prompts tab, baked from the Airtable export
// by build_prompts.py into public/data/prompts.json. Loaded once per process;
// a missing or corrupt file degrades to an empty seed list rather than
// breaking /api/prompts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "data",
  "prompts.json"
);

let cache;
export function seedPrompts() {
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
