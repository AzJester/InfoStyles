// Public "drop in your own" submissions: a visitor-built skill (SKILL.md /
// package upload or a filled-in form) or a style design. Nothing goes live —
// everything lands in the admin's private review queue (see queue.js) and is
// published only after the admin approves it.
import * as api from "./api.js";
import { escapeHtml, toast, openModal, wireModalDismiss } from "./ui.js";
import { parseSkillMarkdown, titleize, readZip, bytesToBase64 } from "./skillfile.js";
import { toNotebookLMPrompt } from "./imagePrompt.js";
import { parsePalette } from "./creator.js";

// Client-side caps on bundled package files, mirroring lib/submission.js —
// big packages should arrive as a source link instead.
const MAX_RESOURCES = 8;
const MAX_RESOURCE_CHARS = 150000; // total across all captured files
const MAX_BINARY_BYTES = 40000; // per binary file (icons etc.)

export function initSubmit() {
  const el = (id) => document.getElementById(id);
  const skill = {
    modal: el("subSkillModal"),
    work: el("subSkillWork"),
    done: el("subSkillDone"),
    drop: el("subSkillDrop"),
    file: el("subSkillFile"),
    filesNote: el("subSkillFilesNote"),
    name: el("subSkillName"),
    platform: el("subSkillPlatform"),
    category: el("subSkillCategory"),
    tags: el("subSkillTags"),
    description: el("subSkillDescription"),
    instructions: el("subSkillInstructions"),
    link: el("subSkillLink"),
    credit: el("subSkillCredit"),
    website: el("subSkillWebsite"),
    status: el("subSkillStatus"),
    send: el("subSkillSend"),
    ref: el("subSkillRef"),
    again: el("subSkillAgain"),
  };
  const style = {
    modal: el("subStyleModal"),
    work: el("subStyleWork"),
    done: el("subStyleDone"),
    name: el("subStyleName"),
    category: el("subStyleCategory"),
    palette: el("subStylePalette"),
    palettePreview: el("subStylePalettePreview"),
    type: el("subStyleType"),
    icons: el("subStyleIcons"),
    layout: el("subStyleLayout"),
    charts: el("subStyleCharts"),
    background: el("subStyleBackground"),
    avoid: el("subStyleAvoid"),
    notebook: el("subStyleNotebook"),
    credit: el("subStyleCredit"),
    website: el("subStyleWebsite"),
    status: el("subStyleStatus"),
    send: el("subStyleSend"),
    ref: el("subStyleRef"),
    again: el("subStyleAgain"),
    openBtn: el("styleSubmitBtn"),
  };

  // Metadata a SKILL.md declared but the lean public form doesn't show
  // (version, author) rides along with the submission; the captured package
  // files and their names do too.
  let skillMeta = {};
  let skillResources = [];
  let skillFiles = [];

  const SKILL_HELP = "Submissions go to the site owner's private review queue — nothing appears in the hub until they approve it.";
  const STYLE_HELP = "Submissions go to the site owner's private review queue — nothing appears in the library until they approve it.";

  function setSkillStatus(m, isErr = false) {
    skill.status.textContent = m;
    skill.status.classList.toggle("error", isErr);
  }
  function setStyleStatus(m, isErr = false) {
    style.status.textContent = m;
    style.status.classList.toggle("error", isErr);
  }

  function resetSkillForm() {
    for (const k of ["name", "category", "tags", "description", "instructions", "link", "credit", "website"]) skill[k].value = "";
    skill.platform.value = "Claude";
    skillMeta = {};
    skillResources = [];
    skillFiles = [];
    skill.filesNote.textContent = "";
    skill.file.value = "";
    skill.work.hidden = false;
    skill.done.hidden = true;
    skill.send.disabled = false;
    setSkillStatus(SKILL_HELP);
  }

  function resetStyleForm() {
    for (const k of ["name", "category", "palette", "type", "icons", "layout", "charts", "background", "avoid", "notebook", "credit", "website"])
      style[k].value = "";
    style.palettePreview.innerHTML = "";
    style.work.hidden = false;
    style.done.hidden = true;
    style.send.disabled = false;
    setStyleStatus(STYLE_HELP);
  }

  // ---------- skill upload (SKILL.md / .zip / .skill) ----------
  async function importFile(file) {
    const ext = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
    setSkillStatus(`Reading ${file.name}…`);
    skillMeta = {};
    skillResources = [];
    skillFiles = [];
    skill.filesNote.textContent = "";
    try {
      let parsed;
      if (ext === "zip" || ext === "skill") {
        const { entries, readText, readBytes } = await readZip(file);
        const files = entries.filter((e) => !e.name.endsWith("/")).map((e) => e.name);
        const md = entries.find((e) => /(^|\/)skill\.md$/i.test(e.name));
        if (!md) throw new Error("No SKILL.md found inside the archive.");
        parsed = parseSkillMarkdown(await readText(md));
        skillFiles = files;
        // Capture the package's other files so the reviewer sees the whole
        // skill — smaller caps than admin uploads; oversized files are only
        // listed by name.
        let total = 0;
        let skipped = 0;
        for (const e of entries) {
          if (e === md || e.name.endsWith("/")) continue;
          if (skillResources.length >= MAX_RESOURCES || total >= MAX_RESOURCE_CHARS) {
            skipped++;
            continue;
          }
          try {
            const text = (await readText(e, true)).slice(0, MAX_RESOURCE_CHARS - total);
            skillResources.push({ path: e.name, text });
            total += text.length;
          } catch {
            try {
              const bytes = await readBytes(e);
              if (bytes.length > MAX_BINARY_BYTES) throw new Error("too large");
              const b64 = bytesToBase64(bytes);
              skillResources.push({ path: e.name, text: b64, encoding: "base64" });
              total += b64.length;
            } catch {
              skipped++;
            }
          }
        }
        skill.filesNote.textContent =
          `Captured ${skillResources.length} package file${skillResources.length === 1 ? "" : "s"}` +
          (skipped ? ` (${skipped} oversized — listed by name only; add a source link so nothing is lost)` : "") +
          ".";
      } else {
        // .md / .markdown / .txt
        parsed = parseSkillMarkdown(await file.text());
      }
      skill.name.value = titleize(parsed.name) || titleize(file.name) || skill.name.value;
      if (parsed.description) skill.description.value = parsed.description;
      skill.instructions.value = parsed.instructions || "";
      if (parsed.hasFrontmatter) skill.platform.value = "Claude";
      skillMeta = { version: parsed.version || "", author: parsed.author || "" };
      setSkillStatus("File read — check the fields below, then submit.");
    } catch (e) {
      setSkillStatus(`Import failed: ${e.message}`, true);
    }
    skill.file.value = "";
  }

  async function sendSkill() {
    const record = {
      name: skill.name.value.trim(),
      platform: skill.platform.value,
      category: skill.category.value.trim(),
      description: skill.description.value.trim(),
      instructions: skill.instructions.value.trim(),
      link: skill.link.value.trim(),
      tags: skill.tags.value,
      ...skillMeta,
      files: skillFiles,
      resources: skillResources,
    };
    if (!record.name) return setSkillStatus("Give the skill a name.", true);
    if (record.instructions.length < 40 && !record.link) {
      return setSkillStatus("Include the skill's instructions (at least a few sentences), or a source link.", true);
    }
    skill.send.disabled = true;
    setSkillStatus("Submitting…");
    try {
      const out = await api.submitToQueue({
        kind: "skill",
        skill: record,
        credit: skill.credit.value.trim() || undefined,
        website: skill.website.value, // honeypot
      });
      skill.work.hidden = true;
      skill.done.hidden = false;
      skill.ref.textContent = `Reference: ${out.id || ""}`;
      if (out.duplicate) toast(`Heads up: the hub already has “${out.duplicate.name}”`);
    } catch (e) {
      setSkillStatus(e.message, true);
      skill.send.disabled = false;
    }
  }

  // ---------- style form ----------
  function renderPalettePreview() {
    style.palettePreview.innerHTML = parsePalette(style.palette.value)
      .map((h) => `<span class="swatch sm" style="background:${escapeHtml(h)}" title="${escapeHtml(h)}"></span>`)
      .join("");
  }

  async function sendStyle() {
    const record = {
      style: style.name.value.trim(),
      category: style.category.value.trim(),
      palette: parsePalette(style.palette.value),
      type: style.type.value.trim(),
      icons: style.icons.value.trim(),
      layout: style.layout.value.trim(),
      charts: style.charts.value.trim(),
      background: style.background.value.trim(),
      avoid: style.avoid.value.trim(),
      notebookLMPrompt: style.notebook.value.trim(),
    };
    if (!record.style) return setStyleStatus("Give the style a name.", true);
    const detail = [record.type, record.icons, record.layout, record.charts, record.background, record.avoid, record.notebookLMPrompt]
      .join(" ")
      .trim();
    if (record.palette.length < 2 && detail.length < 40) {
      return setStyleStatus("Describe the style a bit more — add a palette or fill in a few of the fields.", true);
    }
    // Guarantee a NotebookLM prompt, same as the admin editor does.
    if (!record.notebookLMPrompt) record.notebookLMPrompt = toNotebookLMPrompt(record);
    style.send.disabled = true;
    setStyleStatus("Submitting…");
    try {
      const out = await api.submitToQueue({
        kind: "style",
        style: record,
        credit: style.credit.value.trim() || undefined,
        website: style.website.value, // honeypot
      });
      style.work.hidden = true;
      style.done.hidden = false;
      style.ref.textContent = `Reference: ${out.id || ""}`;
      if (out.duplicate) toast(`Heads up: the library already has “${out.duplicate.name}”`);
    } catch (e) {
      setStyleStatus(e.message, true);
      style.send.disabled = false;
    }
  }

  // ---------- wiring ----------
  wireModalDismiss(skill.modal);
  wireModalDismiss(style.modal);

  skill.drop.addEventListener("click", () => skill.file.click());
  skill.drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      skill.file.click();
    }
  });
  skill.file.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) importFile(f);
  });
  for (const ev of ["dragover", "dragenter"]) {
    skill.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      skill.drop.classList.add("dragover");
    });
  }
  for (const ev of ["dragleave", "drop"]) {
    skill.drop.addEventListener(ev, (e) => {
      e.preventDefault();
      skill.drop.classList.remove("dragover");
    });
  }
  skill.drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) importFile(f);
  });
  skill.send.addEventListener("click", sendSkill);
  skill.again.addEventListener("click", resetSkillForm);

  style.palette.addEventListener("input", renderPalettePreview);
  style.send.addEventListener("click", sendStyle);
  style.again.addEventListener("click", resetStyleForm);
  style.openBtn?.addEventListener("click", () => {
    resetStyleForm();
    openModal(style.modal);
  });

  return {
    // The Skills Hub renders its own Submit button (the hub is re-rendered
    // client-side), so it takes this opener via initSkills.
    openSkillSubmit: () => {
      resetSkillForm();
      openModal(skill.modal);
    },
  };
}
