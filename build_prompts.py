#!/usr/bin/env python3
"""Convert the Airtable prompt-library CSV into JSON seed data for the Prompts tab.

Reads "Prompt Database-All Prompts.csv" (Airtable export, UTF-8 with BOM) and
writes public/data/prompts.json: the read-only seed layer served by
GET /api/prompts. Admin edits/deletes made in the app live in Redis and are
layered on top of these seeds (see lib/prompt.js mergePrompts), so re-running
this build never clobbers them. Caveat: seed ids derive from category + title,
so renaming a prompt in Airtable gives it a new id and orphans any admin edit
or delete of the old one.

Field mapping (Airtable column -> prompt record):
  Prompt Name             -> title      (rows with an empty Prompt Text are skipped)
  Prompt Text             -> body
  Category                -> category (first value); extra comma-separated values -> tags
  Tags                    -> tags
  AI Platform Created On  -> models
  Use Case / Rating / Last Used / Notes -> notes (composed, in that order)
  Image                   -> dropped (expiring Airtable attachment URLs)
  Linked Records          -> dropped (empty in the export)

Rows that normalize to identical content (Airtable duplicates) are emitted once.

Caps and trimming mirror sanitizePrompt in lib/prompt.js. JS slice counts
UTF-16 code units and JS trim strips a different whitespace set than Python's
str.strip (no U+0085/U+001C-1F, but including U+FEFF), hence the js_trim /
utf16_slice helpers; every value is re-trimmed after slicing so it is a fixed
point of sanitizePrompt. The promptSeeds unit test round-trips every generated
record through sanitizePrompt to keep the two implementations in sync.
"""

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CSV_PATH = ROOT / "Prompt Database-All Prompts.csv"
OUT_PATH = ROOT / "public" / "data" / "prompts.json"

SLUG_RE = re.compile(r"[^a-z0-9]+")

# Field caps from lib/prompt.js sanitizePrompt.
TITLE_MAX = 200
CATEGORY_MAX = 120
BODY_MAX = 20000
NOTES_MAX = 4000
MODELS_CAP, MODELS_LEN = 8, 40
TAGS_CAP, TAGS_LEN = 16, 40

# The exact whitespace set of JS String.prototype.trim (ECMA-262 WhiteSpace +
# LineTerminator): differs from Python str.strip(), which also removes
# U+001C-U+001F and U+0085 but not U+FEFF.
JS_WHITESPACE = (
    "\t\n\v\f\r \u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def js_trim(s: str) -> str:
    return s.strip(JS_WHITESPACE)


def slugify(*parts: str) -> str:
    joined = "-".join(p for p in parts if p)
    return SLUG_RE.sub("-", joined.lower()).strip("-")


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def utf16_slice(s: str, n: int) -> str:
    """Match JS String.prototype.slice(0, n), which counts UTF-16 code units."""
    if utf16_len(s) <= n:
        return s
    # A cut mid-surrogate-pair drops the dangling half (JSON can't carry it anyway).
    return s.encode("utf-16-le")[: n * 2].decode("utf-16-le", errors="ignore")


def clean(value: str | None, cap: int) -> str:
    # Re-trim after the cut so the value is a fixed point of sanitizePrompt
    # (trim-then-slice can leave trailing whitespace when the cut lands on it).
    return js_trim(utf16_slice(js_trim(value or ""), cap))


def str_array(values: list[str], cap: int, length: int) -> list[str]:
    """Mirror strArray in lib/prompt.js: trim, cap length, dedupe case-insensitively."""
    seen: set[str] = set()
    out: list[str] = []
    for item in values:
        s = clean(item, length)
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out[:cap]


def compose_notes(row: dict) -> tuple[str, bool]:
    """Returns (notes, truncated)."""
    parts = []
    use_case = js_trim(row.get("Use Case") or "")
    if use_case:
        parts.append(f"Use case: {use_case}")
    meta = []
    rating = js_trim(row.get("Rating") or "")
    if rating:
        meta.append(f"Rating: {rating}/5")
    last_used = js_trim(row.get("Last Used") or "")
    if last_used:
        meta.append(f"Last used: {last_used}")
    if meta:
        parts.append(" · ".join(meta))
    notes = js_trim(row.get("Notes") or "")
    if notes:
        parts.append(notes)
    joined = "\n\n".join(parts)
    return clean(joined, NOTES_MAX), utf16_len(joined) > NOTES_MAX


def main() -> None:
    if not CSV_PATH.exists():
        raise SystemExit(f"CSV not found: {CSV_PATH}")

    prompts: list[dict] = []
    used_ids: set[str] = set()
    seen_content: set[str] = set()
    skipped_empty = 0
    skipped_duplicate = 0
    truncated: list[str] = []

    with CSV_PATH.open(encoding="utf-8-sig", newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            title = clean(row.get("Prompt Name"), TITLE_MAX)
            raw_body = js_trim(row.get("Prompt Text") or "")
            body = clean(row.get("Prompt Text"), BODY_MAX)
            if not body:
                # A title-only stub isn't usable as a prompt.
                skipped_empty += 1
                continue

            # First Airtable category is the app category; extras become tags
            # (the app's category filter is single-valued).
            cat_parts = [js_trim(c) for c in (row.get("Category") or "").split(",")]
            cat_parts = [c for c in cat_parts if c]
            category = clean(cat_parts[0], CATEGORY_MAX) if cat_parts else "General"
            tag_parts = [js_trim(t) for t in (row.get("Tags") or "").split(",")]
            tags = str_array([t for t in tag_parts if t] + cat_parts[1:], TAGS_CAP, TAGS_LEN)
            models = str_array(
                [js_trim(m) for m in (row.get("AI Platform Created On") or "").split(",") if js_trim(m)],
                MODELS_CAP,
                MODELS_LEN,
            )
            notes, notes_truncated = compose_notes(row)
            if notes_truncated:
                truncated.append(f"notes of {title!r}")
            if utf16_len(raw_body) > BODY_MAX:
                truncated.append(f"body of {title!r}")

            record = {
                "title": title or "Untitled prompt",
                "category": category,
                "body": body,
                "notes": notes,
                "models": models,
                "tags": tags,
                "results": [],
            }

            # Airtable exports can contain duplicate rows; ship each prompt once.
            content_key = json.dumps(record, sort_keys=True, ensure_ascii=False)
            if content_key in seen_content:
                skipped_duplicate += 1
                continue
            seen_content.add(content_key)

            base_id = f"prompt-{slugify(category, title) or i}"
            prompt_id = base_id
            n = 2
            while prompt_id in used_ids:
                prompt_id = f"{base_id}-{n}"
                n += 1
            used_ids.add(prompt_id)

            prompts.append({"id": prompt_id, **record})

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(prompts, ensure_ascii=False, indent=0), encoding="utf-8")

    categories = sorted({p["category"] for p in prompts})
    print(f"Wrote {len(prompts)} prompts across {len(categories)} categories.")
    print(f"  rows skipped (no prompt text):    {skipped_empty}")
    print(f"  rows skipped (duplicate content): {skipped_duplicate}")
    if truncated:
        print(f"  fields truncated to fit the app's caps: {len(truncated)}")
        for t in truncated:
            print(f"    - {t}")
    print(f"  -> {OUT_PATH}")


if __name__ == "__main__":
    main()
