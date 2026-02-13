# DemoClips Gallery

A video gallery for UCSC students to share short screen recordings of their
game projects, organized by course and assignment.

**Live at**: <https://gallery.democlips.dev>

## For Collaborators: Getting Started

Everything is already provisioned. You just need to clone the repo and get
local dev running.

### Prerequisites

- Node.js 18+
- Access to the `democlips.dev` Cloudflare account (you should already be an
  admin — check <https://dash.cloudflare.com>)

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens a browser to authorize your CF account. You need this for deploying
and for running remote D1 commands.

### 3. Create your `.dev.vars` file

```bash
cp .dev.vars.example .dev.vars
```

Then fill in the values. Ask Adam (<amsmith@ucsc.edu>) for the Google OAuth and Cloudflare
credentials — he'll share them directly (never committed to the repo).

| Variable | Where to get it |
|---|---|
| `GOOGLE_CLIENT_ID` | Ask Adam |
| `GOOGLE_CLIENT_SECRET` | Ask Adam |
| `JWT_SECRET` | Generate your own: `openssl rand -hex 32` |
| `CLOUDFLARE_API_TOKEN` | Ask Adam, or create your own at dash.cloudflare.com/profile/api-tokens (needs Stream:Edit permission) |
| `CLOUDFLARE_ACCOUNT_ID` | From any CF dashboard URL: `dash.cloudflare.com/ACCOUNT_ID/...` |
| `GOOGLE_REDIRECT_URI` | Already set to `http://localhost:8787/auth/callback` — leave it |

The same production secrets are already stored in the deployed Worker via
`wrangler secret`, so you never need to set those up — they're there.

> **Note on Google OAuth**: Only Adam can modify the Google Cloud OAuth client
> (adding redirect URIs, changing consent screen, etc.). If you need a new
> redirect URI added (e.g. a different port), ask Adam.

### 4. Initialize local D1

```bash
npx wrangler d1 execute democlips-gallery --local --file=schema.sql
```

### 5. Run the dev server

```bash
npm run dev
```

Open <http://localhost:8787>. Sign in with your @ucsc.edu Google account.

A test video (`test-clip.mp4` — 5-second ffmpeg test pattern) is included in
the repo for quick upload testing. Navigate to any gallery URL (e.g.
`localhost:8787/12345/1`), click "Upload a clip", and use this file.

---

## Local vs. Production: What Talks to What

This is the important bit:

| Service | Local dev (`npm run dev`) | Production (`npx wrangler deploy`) |
|---|---|---|
| **D1 database** | Local SQLite file in `.wrangler/state/` — isolated, disposable | Remote D1 on Cloudflare edge |
| **Cloudflare Stream** | Real remote Stream API — same account, same billing | Real remote Stream API |
| **Google OAuth** | Real Google, redirects to `localhost:8787` | Real Google, redirects to `gallery.democlips.dev` |

**Key implications**:

- Videos you upload locally go to the **real** Stream account (and cost real
  money, though pennies). They just won't show up on the production site
  because the D1 record is only in your local database.
- Your local D1 is empty when you first set it up. You won't see any of the
  production videos. This is fine — use it for testing uploads and UI changes.
- If you need to inspect or fix production data, use:

  ```bash
  npx wrangler d1 execute democlips-gallery --remote --command "SELECT * FROM videos LIMIT 10"
  ```

---

## Deploying

```bash
npx wrangler deploy
```

That's it. The Worker deploys to `gallery.democlips.dev` (custom domain is
configured in `wrangler.jsonc`). The D1 database, Stream integration, and all
secrets are already wired up.

If you change `schema.sql`, run the migration on remote D1 first:

```bash
npx wrangler d1 execute democlips-gallery --remote --file=schema.sql
```

> **Important**: `wrangler.jsonc` has `GOOGLE_REDIRECT_URI` set to the
> production URL (`https://gallery.democlips.dev/auth/callback`). Your
> `.dev.vars` overrides this to `http://localhost:8787/auth/callback` for
> local dev. Don't change the one in `wrangler.jsonc`.

---

## How It Works

### URL Structure

| URL | What it is |
|---|---|
| `/{courseId}/{assignmentId}` | Gallery for an assignment (e.g. `/12345/1`) |
| `/{courseId}/{assignmentId}/upload` | Upload form |
| `/auth/login`, `/auth/callback`, `/auth/logout` | Google OAuth flow |
| `/api/tus-upload` | TUS resumable upload initiation (called by client JS) |
| `/api/delete-video` | Delete a video (owner only) |
| `/api/star` | Toggle a star on a video (no self-starring) |
| `/api/hide-video` | Toggle hide/unhide on a video (moderators only) |
| `/api/create-upload-key` | Generate a 24h upload key JWT (authenticated) |
| `/k/{jwt}` | TUS upload via upload key (no session needed) |
| `/k/{jwt}/upload` | Plain POST upload via upload key (for scripts) |

Instructors share a direct link like `https://gallery.democlips.dev/12345/1`
with students. There's no course/assignment creation step — the URL structure
is open-ended and convention-based (e.g. `/{canvasCourseId}/{assignmentNumber}`).

**Access model**: Gallery URLs are semi-secret. Any authenticated `@ucsc.edu`
user who knows a course/assignment URL can view and upload to it, but URLs
are not listed or discoverable from within the app. In practice, only students
and staff in a course will have the link (shared by the instructor via Canvas
or similar). This is a deliberate "unlisted" model — simple, no enrollment
database needed — not a hard access control boundary.

Each course is a separate space; the homepage doesn't show cross-course content.

### Upload Flow

```
Browser                     Worker                        Cloudflare Stream
  |                            |                                |
  |-- POST /api/tus-upload --->|                                |
  |   (TUS headers + metadata) |-- POST /stream?direct_user=true|
  |                            |<-- Location: upload URL -------|
  |<-- 201 + Location          |                                |
  |                            |                                |
  |-- TUS PATCH chunks --------|--- (bypasses Worker) --------->|
  |   directly to Stream       |                                |
  |                            |                                |
```

Video files go directly from the browser to Stream via the TUS resumable
upload protocol (50MB chunks, auto-retry). They never pass through the Worker,
so there's no size limit issue. We allow up to 500MB / 10 min per clip.

### Upload Keys (external tool uploads)

Students can generate a temporary upload link from the upload page and paste
it into an external tool (OBS, a Unity script, curl, etc.). The link is a
stateless JWT signed with the same `JWT_SECRET`, encoding the user's identity
and the target course/assignment. No extra database table required.

Two endpoints per key:

| Endpoint | Use case |
|---|---|
| `POST /k/<jwt>` | TUS-compatible upload initiation (for TUS clients) |
| `POST /k/<jwt>/upload` | Plain file POST (for simple scripts) |

Example with curl:

```bash
curl -X POST -H "Content-Type: video/mp4" \
     --data-binary @clip.mp4 \
     https://gallery.democlips.dev/k/<jwt>/upload
```

Keys expire after 24 hours. Each upload replaces the student's existing clip
for that assignment (same one-clip-per-student constraint).

### Auth

Google OAuth restricted to `@ucsc.edu` accounts:

- `hd=ucsc.edu` parameter hints Google to show only UCSC accounts
- Server-side check on `hd` claim after token exchange (the actual enforcement)
- JWT session stored in an HttpOnly cookie, 24h expiry

---

## Project Structure

```
src/index.ts      — the entire app (single-file Hono)
schema.sql        — D1 database schema (users + videos tables)
wrangler.jsonc    — Cloudflare Worker config (D1 binding, domain, env vars)
.dev.vars.example — template for local dev secrets
.dev.vars         — your actual local secrets (gitignored)
package.json
tsconfig.json
```

It's a single-file Hono app. All HTML is server-rendered with inline CSS.
The only client-side JS is for the video player lightbox, the TUS upload
progress bar, and the delete button.

---

## Secrets Reference

These are already set on the deployed Worker. You should never need to
re-set them unless rotating credentials.

| Secret | What it is | Who controls it |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client ID | Adam (Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Adam (Google Cloud Console) |
| `JWT_SECRET` | Random key for signing session cookies | Auto-generated |
| `CLOUDFLARE_API_TOKEN` | CF API token with Stream:Edit permission | CF account admins |
| `CLOUDFLARE_ACCOUNT_ID` | CF account identifier | CF account admins |
| `MODERATOR_EMAILS` | Comma-separated list of moderator emails (e.g. `a@ucsc.edu,b@ucsc.edu`) | CF env vars (not in source) |

To rotate a secret:

```bash
npx wrangler secret put SECRET_NAME
# paste the new value, hit enter, then Ctrl-D
```

---

## Cost Estimate (per class of ~30 students)

| Service | Cost |
|---|---|
| Workers | Free tier (100k requests/day) |
| D1 | Free tier (5M reads/day) |
| Stream | ~$5/month (600 min stored at $1/1000 min + delivery) |
| Domain | Already registered |

Roughly **$5-10/month** for a class-sized deployment.
