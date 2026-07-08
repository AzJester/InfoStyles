// Reading skill files in the browser: SKILL.md frontmatter parsing, filename
// titleizing, base64 helpers, and a minimal zip reader. Shared by the admin
// skill editor (skills.js) and the public submit form (submit.js).

// Parse a SKILL.md: optional YAML frontmatter (name, description, version,
// author — description may be a JSON-quoted scalar, which is how this site
// emits it), body becomes the instructions.
export function parseSkillMarkdown(text) {
  const out = { instructions: text.trim(), hasFrontmatter: false };
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return out;
  out.hasFrontmatter = true;
  out.instructions = text.slice(m[0].length).trim();
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description|version|author):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        v = v.replace(/^"+|"+$/g, "");
      }
    }
    out[kv[1]] = v;
  }
  return out;
}

// "ai-fingerprint" / "meeting-notes.skill.zip" -> "Ai Fingerprint" / "Meeting Notes"
export function titleize(s) {
  let out = String(s || "");
  // Strip stacked extensions (e.g. ".skill.zip").
  for (let prev = ""; prev !== out; ) {
    prev = out;
    out = out.replace(/\.(md|markdown|txt|zip|skill|json)$/i, "");
  }
  return out.replace(/[-_]+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

// Minimal zip reader — enough to list entries and extract text files. Uses the
// central directory for names/sizes and DecompressionStream for deflate, so no
// library is needed (CSP allows same-origin scripts only).
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That doesn't look like a valid .zip file.");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const csize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const cmtLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    entries.push({ name, method, csize, lho });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  const readBytes = async (e) => {
    // The local header's own name/extra lengths locate the data (they can
    // differ from the central directory's).
    const lnameLen = dv.getUint16(e.lho + 26, true);
    const lextraLen = dv.getUint16(e.lho + 28, true);
    const start = e.lho + 30 + lnameLen + lextraLen;
    const data = buf.slice(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const ab = await new Response(new Blob([data]).stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error(`Unsupported zip compression (method ${e.method}).`);
  };
  // fatal: true rejects binary files instead of silently mangling them.
  const readText = async (e, fatal = false) => new TextDecoder("utf-8", { fatal }).decode(await readBytes(e));
  return { entries, readText, readBytes };
}
