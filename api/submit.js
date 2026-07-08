import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { kvAvailable, upsertSubmission, getSkills, getDeletedSkillIds, getCatalog } from "../lib/store.js";
import { mergeSkills } from "../lib/skill.js";
import { seedSkills } from "../lib/skillSeeds.js";
import {
  buildSkillSubmission,
  buildStyleSubmission,
  submissionSize,
  findDuplicateName,
  MAX_SUBMISSION_CHARS,
} from "../lib/submission.js";
import { clientKey } from "../lib/ratelimit.js";

// Public submissions: a visitor drops a finished skill or style design into
// the admin's private review queue (the same queue Prompt Studio feeds).
// Nothing is public until the admin approves it. There's no AI call here, so
// the guards are a per-IP hourly limit, a size cap, a honeypot, and the
// queue's own item cap. SUBMIT_DISABLED=1 turns the feature off.
const IP_HOURLY = Math.max(1, Number(process.env.SUBMIT_IP_HOURLY) || 5);

const hits = new Map(); // ip -> { count, first }
function withinIpLimit(key) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now - rec.first > 60 * 60 * 1000) {
    hits.set(key, { count: 1, first: now });
    return true;
  }
  rec.count++;
  return rec.count <= IP_HOURLY;
}

// A short deterministic id per submission (no Math.random: hash of content+time).
function subId(text) {
  let h = 0;
  const s = text + Date.now();
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `sub-${Math.abs(h).toString(36).toUpperCase().slice(0, 6)}`;
}

// Seed style names, loaded once (for the duplicate hint on style submissions).
let styleSeedNames;
function seedStyleNames() {
  if (!styleSeedNames) {
    try {
      const dir = path.dirname(fileURLToPath(import.meta.url));
      const seeds = JSON.parse(readFileSync(path.join(dir, "..", "public", "data", "styles.json"), "utf8"));
      styleSeedNames = seeds.map((s) => s.style);
    } catch {
      styleSeedNames = [];
    }
  }
  return styleSeedNames;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.SUBMIT_DISABLED === "1") return res.status(503).json({ error: "Submissions are currently turned off." });
  if (!kvAvailable()) return res.status(503).json({ error: "Submissions aren't available right now." });

  const { kind, skill, style, credit, website } = req.body || {};

  // Honeypot: real users never fill this hidden field.
  if (website) return res.status(200).json({ ok: true });

  if (!withinIpLimit(clientKey(req))) {
    return res.status(429).json({ error: "You've hit the hourly submission limit — try again in a while." });
  }

  try {
    let record;
    let name;
    let duplicateOf = null;

    if (kind === "skill") {
      const built = buildSkillSubmission(skill || {});
      if (built.error) return res.status(400).json({ error: built.error });
      name = built.skill.name;
      const [saved, deleted] = await Promise.all([getSkills(), getDeletedSkillIds()]);
      duplicateOf = findDuplicateName(name, mergeSkills(seedSkills(), saved, deleted).map((s) => s.name));
      record = { kind: "skill", skill: built.skill };
    } else if (kind === "style") {
      const built = buildStyleSubmission(style || {});
      if (built.error) return res.status(400).json({ error: built.error });
      name = built.style.style;
      const custom = (await getCatalog()).custom.map((s) => s.style);
      duplicateOf = findDuplicateName(name, [...custom, ...seedStyleNames()]);
      record = { kind: "style", style: built.style };
    } else {
      return res.status(400).json({ error: `Unknown submission kind "${kind}".` });
    }

    if (submissionSize(record) > MAX_SUBMISSION_CHARS) {
      return res.status(400).json({ error: "That submission is too large — trim the bundled files and share a source link instead." });
    }

    const id = subId(String(name) + kind);
    await upsertSubmission({
      id,
      ...record,
      ...(credit ? { credit: String(credit).slice(0, 80) } : {}),
      ...(duplicateOf ? { verdict: { duplicateOf } } : {}),
      source: "public",
      at: new Date().toISOString(),
    });
    return res.status(200).json({ ok: true, id, ...(duplicateOf ? { duplicate: { name: duplicateOf } } : {}) });
  } catch (err) {
    if (/queue is full/i.test(err?.message || "")) {
      return res.status(503).json({ error: "The review queue is full — please try again later." });
    }
    console.error("submit error:", err);
    return res.status(500).json({ error: "Something went wrong — try again in a moment." });
  }
}
