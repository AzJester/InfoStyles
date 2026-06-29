# InfoStyles

A clean, shareable web app for **1,530 infographic & slide styles** across 62 categories. Anyone can browse, search, and copy a ready-to-use prompt for **NotebookLM** or **OpenAI image generation**. A password-protected **admin** can create, edit, and AI-generate styles, with the API key kept on the server, never in the browser.

Hosted on **Render**: one small Node/Express service that serves the static front end in `public/` and the `/api` routes. The keys live as Render environment variables, so sharing the public URL never exposes them.

## What visitors can do (no login)

- Browse, search, and filter by category (grouped, with counts), by **color**, or by **favorites** (saved in their browser).
- Switch between **grid and list** views (defaults to list; remembered per browser).
- Open any style for a detail view: full fields, a large palette (click swatches or "copy all hex" / "copy as CSS vars"), any example images (click to view full size), and both prompts.
- Copy the **NotebookLM** prompt or the generated **OpenAI image** prompt.
- Light/dark theme toggle, keyboard shortcuts (`/` to search, `Esc` to close).

## What the admin can do (after login)

- **AI-create** a style from a description (Claude), with a **category picker** (choose an existing one or add a new one).
- **Edit any existing style** (built-in or custom) and **delete** styles. Changes save to the shared store and are visible to everyone.
- **Remix** a style with AI ("make this darker, for finance").
- **Upload example images** to a style (drag-and-drop or click; multiple per style). Stored on the Render persistent disk and served from `/uploads`, shown as thumbnails that open full size, visible to everyone.
- Bulk **import** styles from JSON.

The AI features and the keys are gated server-side. Hiding the admin UI is only cosmetic; the real boundary is that `/api/generate-*` and `/api/styles` reject any request without a valid admin session.

## Deploy to Render

You can use the included `render.yaml` Blueprint, or wire it up by hand:

1. **Web Service** → New → from this GitHub repo. Runtime **Node**, **Build Command** `npm install`, **Start Command** `node server.js`. (No Python needed at build; the data JSON is committed.)
2. Add a **Disk** to that web service: mount path `/var/data`, ~1 GB. This holds uploaded sample images (requires a paid instance).
3. **Key Value** (Redis) → New. This is the store for admin edits.
4. On the web service, add **Environment Variables**:

   | Variable | Purpose |
   | --- | --- |
   | `ADMIN_PASSWORD` | The password you type to sign in as admin. |
   | `AUTH_SECRET` | A long random string used to sign session cookies (e.g. `openssl rand -hex 32`). |
   | `REDIS_URL` | The Key Value instance's **Internal** connection string (admin edits store). |
   | `UPLOAD_DIR` | `/var/data` — the disk mount path. Enables sample-image uploads. |
   | `ANTHROPIC_API_KEY` | Server-side key for AI style generation (Claude). |

5. Deploy. Pushes to `main` auto-deploy. Render sites are public by default. Open the app, click the **🔑** button, sign in, and the AI/edit/upload features unlock.

> A paid web service stays warm (no cold starts) and supports the disk. `ANTHROPIC_API_KEY` is only read on the server and never reaches the browser. Uploaded images live on the disk and are served from `/uploads`.

## Run locally

```bash
# (Re)generate the data from the CSV — only if the CSV changed:
python build_styles.py

# Install deps and run the full app (API + admin):
npm install
ADMIN_PASSWORD=dev AUTH_SECRET=dev-secret-please-change node server.js
# open http://localhost:3000

# Edits/persistence need a Redis: set REDIS_URL to a local or hosted instance.
# AI style generation needs ANTHROPIC_API_KEY.
```

Without `REDIS_URL` the app still runs; admin edits just report that persistence isn't configured. Without the API keys, the AI buttons return a clear "not configured" error.

## Tests & CI

```bash
node --test       # unit tests: image-prompt transform, auth tokens, style sanitize
```

`.github/workflows/ci.yml` runs the data build and the unit tests on every push/PR. Deployment is Render's job, not the workflow's.

## Project layout

```
server.js                       # Express: serves public/ + mounts /api routes
render.yaml                     # Render Blueprint (web service + Key Value)
build_styles.py                 # CSV -> public/data/{styles,categories}.json
Infographic & Slide Styles-...csv   # source of truth (1,530 styles)
public/                         # static site (served at /)
  index.html  styles.css
  js/  main.js, catalog.js, card.js, creator.js, admin.js, api.js, ui.js, imagePrompt.js, storage.js
  data/                         # generated JSON (committed)
api/                            # request handlers (reused by server.js)
  login.js logout.js session.js catalog.js
  generate-style.js styles.js upload-image.js
lib/                            # shared server code: auth.js, store.js (Redis), style.js
test/                           # node:test unit tests
```

## Updating the base styles

Edit the CSV, run `python build_styles.py`, commit the regenerated `public/data/*.json`. Admin edits made in the app live in the Key Value store and layer on top of the CSV styles, so they survive a rebuild.
