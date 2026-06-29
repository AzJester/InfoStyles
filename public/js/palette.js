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
