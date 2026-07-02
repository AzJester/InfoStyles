#!/usr/bin/env python3
"""Convert the infographic styles CSV into JSON consumed by the static web app.

Reads "Infographic & Slide Styles-Grid view.csv" (UTF-8 with BOM) and writes:
  - app/data/styles.json      list of style records
  - app/data/categories.json  [{name, count}] for the filter UI

Re-run this whenever the CSV changes. Output is committed so the app works
without a build step; the GitHub Pages workflow also runs it before deploy.
"""

import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "Infographic & Slide Styles-Grid view.csv"
OUT_DIR = ROOT / "public" / "data"

HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b")
SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(*parts: str) -> str:
    joined = "-".join(p for p in parts if p)
    return SLUG_RE.sub("-", joined.lower()).strip("-")


def parse_palette(raw: str) -> list[str]:
    """Extract hex colors from the palette cell (space-separated, sometimes noisy)."""
    if not raw:
        return []
    found = HEX_RE.findall(raw)
    seen, out = set(), []
    for hexcode in found:
        norm = hexcode.upper()
        if norm not in seen:
            seen.add(norm)
            out.append(norm)
    return out


def fix_mojibake(s: str) -> str:
    """Repair UTF-8 text that was decoded as cp1252 somewhere upstream
    (e.g. 'â€“' instead of '–'). Only rows that look damaged are touched, and
    only when the round-trip decodes cleanly."""
    if "â" not in s and "Ã" not in s:
        return s
    try:
        return s.encode("cp1252").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def clean(value: str | None) -> str:
    return fix_mojibake((value or "").strip())


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found: {CSV_PATH}")

    styles: list[dict] = []
    used_ids: set[str] = set()

    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            category = clean(row.get("Category"))
            name = clean(row.get("Style"))
            if not category and not name:
                continue  # skip blank lines

            base_id = slugify(category, name) or f"style-{i}"
            style_id = base_id
            n = 2
            while style_id in used_ids:
                style_id = f"{base_id}-{n}"
                n += 1
            used_ids.add(style_id)

            styles.append(
                {
                    "id": style_id,
                    "category": category,
                    "style": name,
                    "palette": parse_palette(clean(row.get("Palette"))),
                    "type": clean(row.get("Type")),
                    "icons": clean(row.get("Icons")),
                    "layout": clean(row.get("Layout")),
                    "charts": clean(row.get("Charts")),
                    "background": clean(row.get("Background")),
                    "avoid": clean(row.get("Avoid")),
                    "notebookLMPrompt": clean(row.get("Pasteable prompt")),
                }
            )

    counts = Counter(s["category"] for s in styles if s["category"])
    categories = [
        {"name": name, "count": count}
        for name, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0].lower()))
    ]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "styles.json").write_text(
        json.dumps(styles, ensure_ascii=False, indent=0), encoding="utf-8"
    )
    (OUT_DIR / "categories.json").write_text(
        json.dumps(categories, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    empty_prompt = sum(1 for s in styles if not s["notebookLMPrompt"])
    no_palette = sum(1 for s in styles if not s["palette"])
    print(f"Wrote {len(styles)} styles across {len(categories)} categories.")
    print(f"  styles with no NotebookLM prompt: {empty_prompt}")
    print(f"  styles with no palette parsed:    {no_palette}")
    print(f"  -> {OUT_DIR / 'styles.json'}")
    print(f"  -> {OUT_DIR / 'categories.json'}")


if __name__ == "__main__":
    main()
