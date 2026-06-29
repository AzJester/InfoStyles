# InfoStyles

A clean, shareable web app for **1,530 infographic & slide styles** across 62 categories. Anyone can browse, search, and copy a ready-to-use prompt for **NotebookLM** or **OpenAI image generation**. A password-protected **admin** can create, edit, and AI-generate styles (and render preview images) — with the API keys kept on the server, never in the browser.

Hosted on **Vercel**: a static front end plus a small serverless `/api`. The keys live as Vercel environment secrets, so sharing the public URL never exposes them.

## What visitors can do (no login)

- Browse, search, and filter by category (grouped, with counts), by **color**, or by **favorites** (saved in their browser).
- Open any style for a detail view: full fields, a large palette (click swatches or "copy all hex" / "copy as CSS vars"), and both prompts.
- Copy the **NotebookLM** prompt or the generated **OpenAI image** prompt.
- Light/dark theme toggle, keyboard shortcuts (`/` to search, `Esc` to close).

## What the admin can do (after login)

- **AI-create** a style from a description (Claude), with a **category picker** (choose an existing one or add a new one).
- **Edit any existing style** (built-in or custom) and **delete** styles. Changes save to the shared store and are visible to everyone.
- **Remix** a style with AI ("make this darker, for finance").
- **Generate a preview image** (OpenAI) inline and download it.
- Bulk **import** styles from JSON.

The AI features and the keys are gated server-side. Hiding the admin UI is only cosmetic; the real boundary is that `/api/generate-*` and `/api/styles` reject any request without a valid admin session.

## Deploy to Vercel

1. Import the GitHub repo into Vercel (no framework / "Other"; no build command needed — the data JSON is committed). Vercel serves `public/` and runs `api/`.
2. Add a **KV** store: Vercel dashboard → Storage → create KV → connect to the project. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically.
3. Set **Environment Variables** (Project → Settings → Environment Variables):

   | Variable | Purpose |
   | --- | --- |
   | `ADMIN_PASSWORD` | The password you type to sign in as admin. |
   | `AUTH_SECRET` | A long random string used to sign session cookies. |
   | `ANTHROPIC_API_KEY` | Server-side key for AI style generation (Claude). |
   | `OPENAI_API_KEY` | Server-side key for image generation. Optional — image button only appears if set. |

4. Deploy. Pushes to `main` auto-deploy. Open the app, click **Admin**, sign in, and the AI/edit features unlock.

> The `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are only ever read inside the serverless functions. They are never sent to the browser and never appear in client code.

## Run locally

```bash
# Regenerate the data from the CSV (only if the CSV changed):
python build_styles.py

# Public, static-only preview (no API / no admin features):
cd public && python -m http.server 8000   # http://localhost:8000

# Full app incl. the API + admin (needs the Vercel CLI and the env vars above):
npm install
npx vercel dev
```

The static preview works without the API: AI/admin features simply stay hidden because `/api/session` is unavailable.

## Tests & CI

```bash
node --test       # unit tests for the image-prompt transform and the auth tokens
```

`.github/workflows/ci.yml` runs the data build and the unit tests on every push/PR. Deployment is Vercel's job, not the workflow's.

## Project layout

```
build_styles.py                 # CSV -> public/data/{styles,categories}.json
Infographic & Slide Styles-...csv   # source of truth (1,530 styles)
public/                         # static site (served at /)
  index.html  styles.css
  js/  main.js, catalog.js, card.js, creator.js, admin.js, api.js, ui.js, imagePrompt.js, storage.js
  data/                         # generated JSON (committed)
api/                            # serverless functions
  login.js logout.js session.js catalog.js
  generate-style.js generate-image.js styles.js
lib/                            # shared server code: auth.js, store.js (KV), style.js
test/                           # node:test unit tests
vercel.json                     # security headers
```

## Updating the base styles

Edit the CSV, run `python build_styles.py`, commit the regenerated `public/data/*.json`. Admin edits made in the app live in KV and layer on top of the CSV styles, so they survive a rebuild.
