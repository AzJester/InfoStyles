// Palette helpers: export formats and a WCAG-based readable text color.

function rgb(hex) {
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relLuminance(hex) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Black or white, whichever is more readable on the given background.
export function bestTextColor(hex) {
  try {
    return relLuminance(hex) > 0.179 ? "#000000" : "#FFFFFF";
  } catch {
    return "#000000";
  }
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const c = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// A fresh, reasonably harmonious random palette ("roll the dice"). The presets
// give a dark anchor, vivid + accent colors, a light neutral, and mids.
const PALETTE_PRESETS = [
  [0, 32, 16], [0, 68, 52], [180, 60, 55], [38, 16, 94],
  [40, 58, 46], [210, 55, 50], [300, 48, 56], [120, 42, 44],
];
export function randomPalette(count = 5) {
  const base = Math.floor(Math.random() * 360);
  const n = Math.max(3, Math.min(8, count || 5));
  const out = [];
  for (let i = 0; i < n; i++) {
    const [dh, s, l] = PALETTE_PRESETS[i % PALETTE_PRESETS.length];
    out.push(hslToHex((base + dh) % 360, s, l));
  }
  return out;
}

// Copy-ready representations of a palette in common formats.
export function paletteFormats(palette) {
  const list = (palette || []).filter(Boolean);
  return {
    hex: list.join(" "),
    css: ":root {\n" + list.map((h, i) => `  --color-${i + 1}: ${h};`).join("\n") + "\n}",
    scss: list.map((h, i) => `$color-${i + 1}: ${h};`).join("\n"),
    tailwind:
      "colors: {\n" + list.map((h, i) => `  'brand-${i + 1}': '${h}',`).join("\n") + "\n}",
    json: JSON.stringify(list),
  };
}
