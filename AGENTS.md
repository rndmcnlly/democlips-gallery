# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project Overview

Cloudflare Worker (Hono) serving a video gallery for UCSC game dev students.
Google OAuth restricted to @ucsc.edu. Videos stored on Cloudflare Stream,
metadata in D1 (SQLite). See `README.md` for full architecture and
deployment docs.

## Commands

```bash
npm run dev              # Local dev server at localhost:8787
npm run deploy           # Deploy to gallery.democlips.dev
npx tsc --noEmit         # Type-check (no build step — wrangler bundles)

# D1 database
npm run db:migrate:local                    # Apply schema.sql to local D1
npm run db:migrate                          # Apply schema.sql to remote D1
npx wrangler d1 execute democlips-gallery --local --command "SELECT ..."
```

There are no tests, no linter, and no CI. Type-checking with `npx tsc --noEmit`
is the only automated validation. Run it before suggesting a deploy.

## Project Structure

```
src/
  index.ts           — App creation, global middleware, route mounting (~30 lines)
  types.ts           — Shared types (Bindings, User, VideoRow, etc.) + isSecure, isModerator
  html.ts            — layout(), esc(), videoCard(), playerScript(), formatting helpers
  auth.ts            — softAuth middleware, requireAuth guard, /auth/* routes
  stream.ts          — streamAPI(), refreshVideoStatus(), initiateStreamUpload()
  api.ts             — /api/* JSON endpoints (TUS upload, delete, star, hide, update, CORS)
  upload-key.ts      — Upload key JWT logic + /api/create-upload-key, /k/:key routes
  pages.ts           — All HTML page routes (home, onboarding, moderation, gallery, upload, 404)

schema.sql           — D1 schema (users, videos, stars tables)
wrangler.jsonc       — Worker config, D1 binding, env vars
.dev.vars.example    — Template for local secrets
.dev.vars            — Actual local secrets (gitignored)
```

### Module Dependency Graph

```
index.ts
  ├── types.ts        (Bindings, Variables)
  ├── auth.ts         (softAuth, authRoutes)
  │     └── types.ts  (Bindings, Variables, User, isSecure)
  ├── api.ts          (apiRoutes)
  │     ├── types.ts  (Bindings, Variables, isModerator)
  │     ├── auth.ts   (requireAuth)
  │     └── stream.ts (streamAPI, initiateStreamUpload)
  ├── upload-key.ts   (uploadKeyRoutes)
  │     ├── types.ts  (Bindings, Variables, UploadKeyClaims)
  │     ├── auth.ts   (requireAuth)
  │     └── stream.ts (streamAPI, initiateStreamUpload)
  └── pages.ts        (pageRoutes)
        ├── types.ts  (Bindings, Variables, VideoRow, isSecure, isModerator)
        ├── html.ts   (layout, esc, fmtDuration, fmtDate, videoCard, playerScript)
        ├── auth.ts   (requireAuth)
        └── stream.ts (refreshVideoStatus)
```

### Where to Put New Code

- **New type**: `src/types.ts`
- **New API route**: `src/api.ts` (or `src/upload-key.ts` if related to upload keys)
- **New page**: `src/pages.ts`
- **New HTML component or CSS**: `src/html.ts`
- **New Stream API interaction**: `src/stream.ts`
- **Auth changes**: `src/auth.ts`
- **New middleware**: `src/index.ts` (global) or the relevant route file (scoped)

Each file has labeled section headers (`// ─── Section Name ───...`).
Follow the existing style when adding new sections.

## Code Style

### TypeScript

- Strict mode enabled. Do not use `@ts-ignore` or weaken strictness.
- Use `type` (not `interface`) for all type definitions.
- Types use PascalCase. Variables and functions use camelCase.
- DB columns use snake_case. Route params use camelCase.
- Use `!` non-null assertion only after an auth guard guarantees the value.
- Type D1 results via generics: `.first<RowType>()`, `.all<RowType>()`.
- Use inline `as` casts for external API JSON responses.

### Formatting

- 2-space indentation, semicolons always, double quotes for strings.
- No formatter is configured — just match existing style.

### Imports

- Named imports from `hono`, `hono/jwt`, `hono/cookie`.
- Relative imports between `src/` modules use `./name` (no extension).
- All shared types come from `./types`. Do not re-declare types locally.
- Cloudflare Workers globals (`D1Database`, `crypto`, `fetch`, `atob`, `btoa`)
  are available without imports via `@cloudflare/workers-types`.

### HTML Rendering

- All HTML is server-rendered via template literals. No JSX, no React.
- Use `layout(title, body, user)` to wrap page content (from `./html`).
- **Always escape user-supplied strings** with `esc()` in templates.
- Client-side JS uses `var` (not const/let) and function declarations.
- External client JS: `tus-js-client@4` loaded from jsDelivr CDN (upload page).
- Inline `<style>` in layout(). Dark theme (bg: #0f0f0f). No CSS framework.

## Hono Patterns

### Route Mounting

Routes are organized as separate Hono apps and mounted in `index.ts`:

```typescript
app.route("/auth", authRoutes);   // auth.ts handles /auth/login, etc.
app.route("/api", apiRoutes);     // api.ts handles /api/tus-upload, etc.
app.route("/", uploadKeyRoutes);  // upload-key.ts handles /k/:key, /api/create-upload-key
app.route("/", pageRoutes);       // pages.ts handles /, /v/:id, /:course/:assignment, etc.
```

Each route module creates its own `new Hono<{ Bindings; Variables }>()`.
The soft auth middleware runs globally in `index.ts`, so `c.var.user`
is always available in every route module.

### Bindings & Environment

```typescript
// Access via c.env.DB, c.env.GOOGLE_CLIENT_ID, etc.
// Per-request state via c.var.user (set by soft auth middleware in index.ts)
```

### Route Definitions

- `app.get(path, handler)` — public pages
- `app.get(path, requireAuth, handler)` — protected pages
- `app.post(path, requireAuth, handler)` — protected API endpoints
- Gallery route (`/:courseId/:assignmentId`) does its own auth check
  to set a `return_to` cookie before redirecting to login.

### Response Patterns

- HTML pages: `return c.html(layout(title, body, user))`
- JSON success: `return c.json({ ... })`
- JSON error: `return c.json({ error: "message" }, 4xx)`
- Redirects: `return c.redirect(url)`
- Raw Response: `new Response(null, { status, headers })` for TUS protocol

## Auth

- Google OAuth 2.0, authorization code flow.
- `hd=ucsc.edu` on the authorize URL is a UI hint only.
- **Server-side `hd` claim check is the real enforcement** — never remove it.
- Session is a HS256 JWT in an HttpOnly cookie, 24h expiry.
- `isSecure(env)` dynamically sets the `secure` cookie flag based on
  whether the redirect URI is HTTPS (production) or HTTP (localhost).

## Database (D1)

- Always use parameterized queries: `.prepare(sql).bind(...).run()`
- Never interpolate user input into SQL strings.
- Schema changes go in `schema.sql` — use `CREATE TABLE IF NOT EXISTS`.
- Run migrations on both local and remote D1 after schema changes.

## Stream Integration

- Videos upload via TUS protocol. The Worker proxies only the initial
  POST to create the upload session; actual file data goes directly
  from the browser to Cloudflare Stream.
- Video duration is lazily backfilled from the Stream API on gallery
  page loads (videos with `duration IS NULL`).
- Stream API accessed via `streamAPI(env, path, method, body)` helper
  in `src/stream.ts`.
- No Stream Worker binding exists — it's all REST API with bearer token.

## Local vs. Production

| Service | Local (`npm run dev`) | Production (`npm run deploy`) |
|---|---|---|
| D1 | Local SQLite in `.wrangler/state/` | Remote D1 on CF edge |
| Stream | Real remote API (costs real money) | Real remote API |
| OAuth | Real Google, redirects to localhost | Real Google, redirects to prod domain |

`.dev.vars` overrides `GOOGLE_REDIRECT_URI` to localhost for local dev.
The value in `wrangler.jsonc` is the production URL — do not change it.

## Commit Messages

- First line: short imperative summary of the change (~50 chars).
- Blank line, then a body explaining **why** the change was made and any
  key design decisions. Use a short paragraph or bullet points. Focus on
  motivation, constraints, and trade-offs — not a line-by-line recap of
  the diff. A reader should understand the intent without opening the code.
- Before writing a commit message, run `git log` to read recent messages
  for style and context. The history is short — use it.

## Common Tasks

**Add a new API route**: Add to `src/api.ts`. Use `requireAuth` middleware.
Return JSON. Check ownership for any mutation.

**Add a new page**: Add to `src/pages.ts`. Use `layout()` for HTML.
Add video player support with `playerScript()` if showing videos.

**Add a new HTML component**: Add to `src/html.ts`. Export the function
and import it where needed.

**Change the DB schema**: Edit `schema.sql`, run both `db:migrate:local`
and `db:migrate` (remote), then update the relevant TypeScript types in
`src/types.ts` and queries in the appropriate route file.
