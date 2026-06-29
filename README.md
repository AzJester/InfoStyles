# InfoStyles

A clean, minimalist web app for **1,530 infographic & slide styles** across 62 categories. Browse and search every style, copy a ready-to-use prompt for either **NotebookLM** or **OpenAI image generation**, and **create brand-new styles from a plain-language description** using Claude.

It's a static site — no backend, no build step required. It runs straight out of this repo (GitHub Pages or locally).

## What it does

- **Browse & search** all styles by name, category, or any field (type, icons, layout, colors, …).
- **Two prompts per style:**
  - *NotebookLM prompt* — the original pasteable prompt from the source data.
  - *OpenAI image prompt* — generated on the fly from each style's palette, layout, icons, charts, background, and "avoid" notes, formatted for image generation.
- **Palette swatches** — click any color chip to copy its hex.
- **Create a new style** — describe what you want (e.g. *"a retro 1980s synthwave style for a marketing deck"*) and Claude returns a full style with both prompts. Save it to your collection (stored in your browser), or export it as a CSV row / JSON.

## Run locally

```bash
# 1. (Re)generate the data from the CSV — only needed if the CSV changed.
python build_styles.py

# 2. Serve the app folder with any static server.
cd app
python -m http.server 8000
# open http://localhost:8000
```

> Use a local server rather than opening `index.html` directly — the app fetches JSON, which browsers block over `file://`.

## Deploy to GitHub Pages

A workflow at `.github/workflows/deploy-pages.yml` builds the data and publishes the `app/` folder automatically.

1. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or the working branch). The action runs `build_styles.py` and deploys.
3. The live URL appears in the workflow's deploy step and under **Settings → Pages**.

## Using the AI style creator

The "create a new style" feature calls the **Anthropic (Claude) API directly from your browser**, so you bring your own key:

1. Click the ⚙ (Settings) icon.
2. Paste your Anthropic API key and pick a model.
3. Click **+ New style**, describe the style, and **Generate**.

**About the key:** it's stored only in your browser's `localStorage` — never uploaded, committed, or sent anywhere except to Anthropic for your own requests. The browser call uses Anthropic's `anthropic-dangerous-direct-browser-access` header. For a shared/public deployment, treat the key as exposed to whoever uses your browser; for team use you'd want a small backend proxy instead.

## Project layout

```
build_styles.py                     # CSV -> app/data/{styles,categories}.json
Infographic & Slide Styles-...csv   # source of truth (1,530 styles)
app/
  index.html                        # single-page shell
  styles.css                        # minimalist design system (light/dark)
  js/
    main.js                         # gallery, search/filter, incremental render
    imagePrompt.js                  # shared style -> OpenAI image prompt transform
    creator.js                      # NL description -> Claude -> new style
    settings.js                     # API key + model settings modal
    storage.js                      # localStorage: key, model, custom styles
  data/                             # generated JSON (committed)
.github/workflows/deploy-pages.yml
```

## Updating the styles

Edit the CSV, run `python build_styles.py`, and commit the regenerated `app/data/*.json`. The schema is one row per style with columns: `Category, Style, Palette, Type, Icons, Layout, Charts, Background, Avoid, Pasteable prompt`.
