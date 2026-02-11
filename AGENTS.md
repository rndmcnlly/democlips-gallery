# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project Overview

Single-file Cloudflare Worker (Hono) serving a video gallery for UCSC game
dev students. Google OAuth restricted to @ucsc.edu. Videos stored on
Cloudflare Stream, metadata in D1 (SQLite). See `README.md` for full
architecture and deployment docs.

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
src/index.ts         — THE ENTIRE APP (single file, ~850 lines)
schema.sql           — D1 schema (users + videos tables)
wrangler.jsonc       — Worker config, D1 binding, env vars
.dev.vars.example    — Template for local secrets
.dev.vars            — Actual local secrets (gitignored)
```

**This is intentionally a single-file app.** Do not split it into multiple
modules unless explicitly asked. The file is organized in labeled sections:

1. Types
2. HTML Helpers (layout, esc, videoCard, playerScript)
3. Auth Middleware (soft global + hard requireAuth guard)
4. Auth Routes (/auth/login, /auth/callback, /auth/logout, /auth/me)
5. Stream API Helpers
6. API Routes (/api/tus-upload, /api/delete-video)
7. Page Routes (/, /:courseId/:assignmentId, .../upload)
8. 404
9. Export

When adding features, place code in the appropriate section. Follow the
existing section header style: `// ─── Section Name ───────────────...`

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

- Named imports from `hono`, `hono/jwt`, `hono/cookie` only.
- No relative imports (single file). No `import type`.
- Cloudflare Workers globals (`D1Database`, `crypto`, `fetch`, `atob`, `btoa`)
  are available without imports via `@cloudflare/workers-types`.

### HTML Rendering

- All HTML is server-rendered via template literals. No JSX, no React.
- Use `layout(title, body, user)` to wrap page content.
- **Always escape user-supplied strings** with `esc()` in templates.
- Client-side JS uses `var` (not const/let) and function declarations.
- External client JS: `tus-js-client@4` loaded from jsDelivr CDN (upload page).
- Inline `<style>` in layout(). Dark theme (bg: #0f0f0f). No CSS framework.

## Hono Patterns

### Bindings & Environment

```typescript
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
// Access via c.env.DB, c.env.GOOGLE_CLIENT_ID, etc.
// Per-request state via c.var.user (set by soft auth middleware)
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
- Stream API accessed via `streamAPI(env, path, method, body)` helper.
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

**Add a new API route**: Add to the "API Routes" section. Use `requireAuth`
middleware. Return JSON. Check ownership for any mutation.

**Add a new page**: Add to the "Page Routes" section. Use `layout()` for
HTML. Add video player support with `playerScript()` if showing videos.

**Change the DB schema**: Edit `schema.sql`, run both `db:migrate:local`
and `db:migrate` (remote), then update the relevant TypeScript types and
queries in `src/index.ts`.
