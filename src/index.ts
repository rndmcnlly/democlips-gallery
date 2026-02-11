/**
 * DemoClips Gallery — Cloudflare Worker
 *
 * A single-file Hono app for UCSC students to share short video clips
 * of their game engine projects, organized by Canvas course/assignment.
 *
 * Stack: Hono + D1 (SQLite) + Cloudflare Stream + Google OAuth
 */

import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

// ─── Types ──────────────────────────────────────────────────────

type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  JWT_SECRET: string;
  ALLOWED_DOMAIN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  STREAM_CUSTOMER_SUBDOMAIN: string;
};

type User = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd: string;
};

type Variables = {
  user: User | null;
};

type VideoRow = {
  id: string;
  user_id: string;
  course_id: string;
  assignment_id: string;
  title: string;
  description: string;
  duration: number | null;
  thumbnail_pct: number;
  created_at: string;
  user_name: string;
  user_picture: string;
  user_email: string;
  star_count: number;
  user_starred: number;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/** True in production (HTTPS), false on localhost (HTTP). */
function isSecure(env: Bindings): boolean {
  return env.GOOGLE_REDIRECT_URI.startsWith("https://");
}

// ─── HTML Helpers ───────────────────────────────────────────────

const SITE_NAME = "DemoClips";

function layout(title: string, body: string, user: User | null = null): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — ${SITE_NAME}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    background: #0f0f0f; color: #e0e0e0;
    margin: 0; padding: 0; line-height: 1.5;
  }
  a { color: #6cb4ee; text-decoration: none; }
  a:hover { text-decoration: underline; }
  header {
    background: #1a1a2e; border-bottom: 1px solid #2a2a4a;
    padding: 0.75rem 1.5rem; display: flex; align-items: center;
    justify-content: space-between; gap: 1rem;
  }
  header .logo { font-size: 1.25rem; font-weight: 700; color: #fff; }
  header .logo span { color: #f7931a; }
  header nav { display: flex; align-items: center; gap: 1rem; font-size: 0.9rem; }
  header nav img { width: 28px; height: 28px; border-radius: 50%; }
  main { max-width: 960px; margin: 2rem auto; padding: 0 1.5rem; }
  h1 { font-size: 1.5rem; margin: 0 0 1rem; }
  h2 { font-size: 1.2rem; margin: 1.5rem 0 0.75rem; color: #ccc; }
  .card-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
  .card {
    background: #1a1a2e; border-radius: 8px; overflow: hidden;
    border: 1px solid #2a2a4a; transition: border-color 0.2s;
  }
  .card:hover { border-color: #6cb4ee; }
  .card .thumb {
    aspect-ratio: 16/9; background: #111; display: flex;
    align-items: center; justify-content: center; position: relative;
    overflow: hidden;
  }
  .card .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .card .thumb .processing {
    color: #888; font-size: 0.85rem; font-style: italic;
  }
  .card .info { padding: 0.75rem; }
  .card .info .title { font-weight: 600; color: #fff; margin-bottom: 0.25rem; }
  .card .info .meta {
    font-size: 0.8rem; color: #888;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .card .info .meta img { width: 18px; height: 18px; border-radius: 50%; }
  .card .info .desc {
    font-size: 0.85rem; color: #aaa; margin-top: 0.5rem;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .duration-badge {
    position: absolute; bottom: 6px; right: 6px;
    background: rgba(0,0,0,0.8); color: #fff; font-size: 0.75rem;
    padding: 1px 5px; border-radius: 3px;
  }
  .btn {
    display: inline-block; padding: 0.5rem 1.25rem; border-radius: 6px;
    font-size: 0.9rem; font-weight: 600; cursor: pointer; border: none;
    text-decoration: none;
  }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; text-decoration: none; }
  .btn-google {
    background: #fff; color: #333; border: 1px solid #ddd;
    display: inline-flex; align-items: center; gap: 0.5rem;
  }
  .upload-form { max-width: 500px; }
  .upload-form label { display: block; margin: 1rem 0 0.25rem; font-weight: 500; }
  .upload-form input[type="text"],
  .upload-form textarea {
    width: 100%; padding: 0.5rem; border-radius: 6px; border: 1px solid #333;
    background: #1a1a2e; color: #e0e0e0; font-size: 0.9rem;
  }
  .upload-form textarea { resize: vertical; min-height: 60px; }
  .upload-form input[type="file"] { color: #aaa; margin: 0.5rem 0; }
  #progress-wrap { display: none; margin: 1rem 0; }
  #progress-bar {
    height: 8px; background: #333; border-radius: 4px; overflow: hidden;
  }
  #progress-bar div {
    height: 100%; background: #2563eb; width: 0%; transition: width 0.3s;
  }
  #progress-text { font-size: 0.85rem; color: #888; margin-top: 0.25rem; }
  .empty-state {
    text-align: center; padding: 3rem; color: #666;
    border: 2px dashed #2a2a4a; border-radius: 8px;
  }
  .empty-state p { margin: 0.5rem 0; }
  .player-overlay {
    display: none; position: fixed; inset: 0; z-index: 100;
    background: rgba(0,0,0,0.9); align-items: center; justify-content: center;
    padding: 2rem;
  }
  .player-overlay.active { display: flex; }
  .player-overlay .close-btn {
    position: absolute; top: 1rem; right: 1.5rem;
    color: #fff; font-size: 2rem; cursor: pointer; background: none; border: none;
  }
  .player-overlay iframe {
    width: 100%; max-width: 960px; aspect-ratio: 16/9; border: none; border-radius: 8px;
  }
  .delete-btn {
    background: none; border: 1px solid #555; color: #888; font-size: 0.75rem;
    padding: 2px 8px; border-radius: 4px; cursor: pointer; float: right;
  }
  .delete-btn:hover { border-color: #e53e3e; color: #e53e3e; }
  .star-btn {
    background: none; border: 1px solid #555; color: #888; font-size: 0.8rem;
    padding: 2px 8px; border-radius: 4px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 4px;
    transition: color 0.15s, border-color 0.15s;
  }
  .star-btn:hover { border-color: #f7931a; color: #f7931a; }
  .star-btn.starred { border-color: #f7931a; color: #f7931a; }
  .star-btn .star-icon::before { content: "\\2606"; }
  .star-btn.starred .star-icon::before { content: "\\2605"; }
  .star-btn:disabled { opacity: 0.4; cursor: default; }
  .card-actions {
    display: flex; align-items: center; gap: 0.5rem;
    margin-top: 0.5rem; justify-content: space-between;
  }
  .sort-toggle {
    display: inline-flex; font-size: 0.8rem; border: 1px solid #333;
    border-radius: 6px; overflow: hidden;
  }
  .sort-toggle button {
    background: none; border: none; color: #888; padding: 0.3rem 0.75rem;
    cursor: pointer; font-size: 0.8rem;
  }
  .sort-toggle button:not(:last-child) { border-right: 1px solid #333; }
  .sort-toggle button.active { background: #2a2a4a; color: #fff; }
  .sort-toggle button:hover { color: #ccc; }
  .breadcrumb { font-size: 0.85rem; color: #888; margin-bottom: 1rem; }
  .breadcrumb a { color: #6cb4ee; }
  footer {
    text-align: center; padding: 2rem; font-size: 0.8rem; color: #555;
    border-top: 1px solid #1a1a2e; margin-top: 3rem;
  }
</style>
</head>
<body>
<header>
  <a href="/" class="logo">Demo<span>Clips</span></a>
  <nav>
    ${
      user
        ? `<img src="${esc(user.picture)}" alt=""> ${esc(user.name.split(" ")[0])} <a href="/auth/logout">Sign out</a>`
        : `<a href="/auth/login" class="btn btn-google">Sign in with Google</a>`
    }
  </nav>
</header>
<main>${body}</main>
<footer>${SITE_NAME} — UCSC Computational Media</footer>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function videoCard(v: VideoRow, streamDomain: string, currentUserId?: string): string {
  const thumbImg = v.duration
    ? `<img src="https://customer-${streamDomain}.cloudflarestream.com/${v.id}/thumbnails/thumbnail.jpg?height=270" alt="${esc(v.title)}" loading="lazy">`
    : `<span class="processing">Processing...</span>`;
  const badge = v.duration
    ? `<span class="duration-badge">${fmtDuration(v.duration)}</span>`
    : "";
  const isOwner = currentUserId && v.user_id === currentUserId;
  const deleteBtn = isOwner
    ? `<button class="delete-btn" onclick="deleteVideo(event, '${esc(v.id)}')" title="Delete your clip">delete</button>`
    : "";
  const starredClass = v.user_starred ? " starred" : "";
  const starDisabled = isOwner ? " disabled" : "";
  const starBtn = currentUserId
    ? `<button class="star-btn${starredClass}"${starDisabled} onclick="starVideo(event, '${esc(v.id)}')" title="${isOwner ? "Can't star your own clip" : "Star this clip"}"><span class="star-icon"></span><span class="star-count">${v.star_count}</span></button>`
    : "";

  return `<div class="card" id="card-${esc(v.id)}" data-star-count="${v.star_count}" data-created-at="${esc(v.created_at)}" ${v.duration ? `data-video-id="${esc(v.id)}" data-stream-domain="${esc(streamDomain)}" onclick="openPlayer(this)"` : ""} style="${v.duration ? "cursor:pointer" : ""}">
  <div class="thumb">${thumbImg}${badge}</div>
  <div class="info">
    <div class="title">${deleteBtn}${esc(v.title)}</div>
    <div class="meta">
      <img src="${esc(v.user_picture || "")}" alt="">
      ${esc(v.user_name)} &middot; ${fmtDate(v.created_at)}
    </div>
    ${v.description ? `<div class="desc">${esc(v.description)}</div>` : ""}
    <div class="card-actions">${starBtn}</div>
  </div>
</div>`;
}

function playerScript(): string {
  return `
<div class="player-overlay" id="player-overlay">
  <button class="close-btn" onclick="closePlayer()">&times;</button>
  <iframe id="player-iframe" allow="autoplay; fullscreen" allowfullscreen></iframe>
</div>
<script>
async function starVideo(e, videoId) {
  e.stopPropagation();
  var btn = e.currentTarget;
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    var res = await fetch('/api/star', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: videoId }),
    });
    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Star failed');
    }
    var data = await res.json();
    btn.classList.toggle('starred', data.starred);
    btn.querySelector('.star-count').textContent = data.starCount;
    var card = document.getElementById('card-' + videoId);
    if (card) card.dataset.starCount = data.starCount;
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function sortCards(mode, toggleBtn) {
  var buttons = toggleBtn.parentElement.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('active');
  toggleBtn.classList.add('active');
  var grid = document.querySelector('.card-grid');
  if (!grid) return;
  var cards = Array.prototype.slice.call(grid.children);
  cards.sort(function(a, b) {
    if (mode === 'stars') {
      var diff = (parseInt(b.dataset.starCount) || 0) - (parseInt(a.dataset.starCount) || 0);
      if (diff !== 0) return diff;
    }
    return (b.dataset.createdAt || '').localeCompare(a.dataset.createdAt || '');
  });
  for (var i = 0; i < cards.length; i++) grid.appendChild(cards[i]);
}

async function deleteVideo(e, videoId) {
  e.stopPropagation();
  if (!confirm('Delete this clip? This cannot be undone.')) return;
  var btn = e.target;
  btn.disabled = true;
  btn.textContent = '...';
  try {
    var res = await fetch('/api/delete-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: videoId }),
    });
    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Delete failed');
    }
    var card = document.getElementById('card-' + videoId);
    if (card) card.remove();
  } catch (err) {
    alert('Error: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'delete';
  }
}
</script>
<script>
function openPlayer(el) {
  var id = el.dataset.videoId;
  var domain = el.dataset.streamDomain;
  var iframe = document.getElementById('player-iframe');
  iframe.src = 'https://customer-' + domain + '.cloudflarestream.com/' + id + '/iframe?autoplay=true';
  document.getElementById('player-overlay').classList.add('active');
}
function closePlayer() {
  document.getElementById('player-iframe').src = '';
  document.getElementById('player-overlay').classList.remove('active');
}
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closePlayer();
});
document.getElementById('player-overlay').addEventListener('click', function(e) {
  if (e.target === this) closePlayer();
});
</script>`;
}

// ─── Auth Middleware ─────────────────────────────────────────────

/** Soft auth: sets c.var.user if logged in, null otherwise. Never redirects. */
app.use("*", async (c, next) => {
  const token = getCookie(c, "session");
  if (token) {
    try {
      const payload = (await verify(token, c.env.JWT_SECRET, "HS256")) as unknown as User;
      c.set("user", payload);
    } catch {
      deleteCookie(c, "session", { path: "/" });
      c.set("user", null);
    }
  } else {
    c.set("user", null);
  }
  await next();
});

/** Hard auth guard for protected routes. */
function requireAuth(c: any, next: any) {
  if (!c.var.user) {
    return c.redirect("/auth/login");
  }
  return next();
}

// ─── Auth Routes ────────────────────────────────────────────────

app.get("/auth/login", (c) => {
  const state = crypto.randomUUID();
  setCookie(c, "oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: isSecure(c.env),
    sameSite: "Lax",
    maxAge: 300,
  });

  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: c.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
    hd: c.env.ALLOWED_DOMAIN,
    prompt: "select_account",
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "oauth_state");
  const error = c.req.query("error");

  deleteCookie(c, "oauth_state", { path: "/" });

  if (error) return c.text(`OAuth error: ${error}`, 400);
  if (!code || !state || state !== storedState) {
    return c.text("Invalid OAuth state", 403);
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: c.env.GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    return c.text(`Token exchange failed: ${await tokenRes.text()}`, 500);
  }

  const tokens = (await tokenRes.json()) as { access_token: string };

  // Fetch user info
  const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!infoRes.ok) return c.text("Failed to fetch user info", 500);

  const info = (await infoRes.json()) as {
    sub: string;
    email: string;
    name: string;
    picture: string;
    hd?: string;
  };

  // Server-side domain enforcement
  if (info.hd !== c.env.ALLOWED_DOMAIN) {
    return c.text(
      `Access restricted to @${c.env.ALLOWED_DOMAIN} accounts. You signed in as ${info.email}.`,
      403
    );
  }

  // Upsert user in D1
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture`
  )
    .bind(info.sub, info.email, info.name, info.picture)
    .run();

  // Issue JWT session cookie
  const jwt = await sign(
    {
      sub: info.sub,
      email: info.email,
      name: info.name,
      picture: info.picture,
      hd: info.hd,
      exp: Math.floor(Date.now() / 1000) + 86400, // 24h
    },
    c.env.JWT_SECRET,
    "HS256"
  );

  setCookie(c, "session", jwt, {
    path: "/",
    httpOnly: true,
    secure: isSecure(c.env),
    sameSite: "Lax",
    maxAge: 86400,
  });

  // Redirect to where they came from, or home
  const returnTo = getCookie(c, "return_to") || "/";
  deleteCookie(c, "return_to", { path: "/" });
  return c.redirect(returnTo);
});

app.get("/auth/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

app.get("/auth/me", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, user });
});

// ─── Stream API Helpers ─────────────────────────────────────────

async function streamAPI(
  env: Bindings,
  path: string,
  method = "GET",
  body?: any
): Promise<any> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );
  return res.json();
}

/** Check Stream for video status and backfill duration into D1. */
async function refreshVideoStatus(
  env: Bindings,
  videoIds: string[]
): Promise<Map<string, { duration: number }>> {
  const updates = new Map<string, { duration: number }>();
  // Fetch status for each video that lacks duration. In practice there should
  // be very few at a time (only newly-uploaded ones still processing).
  const promises = videoIds.map(async (id) => {
    const data = await streamAPI(env, `/${id}`);
    if (data.success && data.result?.readyToStream && data.result?.duration) {
      updates.set(id, { duration: data.result.duration });
      await env.DB.prepare("UPDATE videos SET duration = ? WHERE id = ?")
        .bind(data.result.duration, id)
        .run();
    }
  });
  await Promise.all(promises);
  return updates;
}

// ─── API Routes ─────────────────────────────────────────────────

/**
 * TUS upload initiation — creates a resumable upload session on Stream.
 * The client uses tus-js-client pointed at this endpoint; the Worker proxies
 * only the initial POST (creating the session), then the client uploads
 * chunks directly to the Stream-returned Location URL.
 *
 * Metadata (courseId, assignmentId, title, etc.) is passed via the
 * Upload-Metadata header per the TUS protocol.
 */
app.post("/api/tus-upload", requireAuth, async (c) => {
  const user = c.var.user!;

  // Parse TUS metadata: keys are plain text, values are base64-encoded
  const rawMeta = c.req.header("Upload-Metadata") || "";
  const meta: Record<string, string> = {};
  for (const pair of rawMeta.split(",")) {
    const [key, b64val] = pair.trim().split(/\s+/);
    if (key && b64val) {
      meta[key] = atob(b64val);
    } else if (key) {
      meta[key] = "";
    }
  }

  const courseId = meta.courseId || "";
  const assignmentId = meta.assignmentId || "";
  const title = meta.title || "Untitled";
  const description = meta.description || "";

  if (!courseId || !assignmentId) {
    return c.json({ error: "Missing courseId or assignmentId in Upload-Metadata" }, 400);
  }

  // Build the Upload-Metadata for Stream (add our constraints)
  const streamMeta = [
    `maxDurationSeconds ${btoa("600")}`,
    `expiry ${btoa(new Date(Date.now() + 3600_000).toISOString())}`,
    `allowedorigins ${btoa("gallery.democlips.dev,localhost:8787")}`,
  ].join(",");

  // Initiate TUS upload on Stream (direct_user=true means client uploads directly)
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.CLOUDFLARE_API_TOKEN}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": c.req.header("Upload-Length") || "0",
        "Upload-Metadata": streamMeta,
        "Upload-Creator": user.email,
      },
    }
  );

  const location = res.headers.get("Location");
  if (!location) {
    const body = await res.text();
    return c.json({ error: "Failed to create TUS upload", details: body }, 500);
  }

  // Extract the Stream video UID from the location URL
  // Location looks like: https://upload.cloudflarestream.com/tus/VIDEOUID...
  const videoId = res.headers.get("stream-media-id") || location.split("/").pop()?.split("?")[0] || "";

  // Insert video record in D1
  if (videoId) {
    await c.env.DB.prepare(
      `INSERT INTO videos (id, user_id, course_id, assignment_id, title, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(videoId, user.sub, courseId, assignmentId, title, description)
      .run();
  }

  // Return the Location to the tus-js-client so it uploads directly to Stream
  return new Response(null, {
    status: 201,
    headers: {
      "Tus-Resumable": "1.0.0",
      Location: location,
      "Access-Control-Expose-Headers": "Location, Tus-Resumable",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

/** Delete a video — only the uploader can delete their own clips. */
app.post("/api/delete-video", requireAuth, async (c) => {
  const user = c.var.user!;
  const { videoId } = await c.req.json<{ videoId: string }>();

  if (!videoId) return c.json({ error: "Missing videoId" }, 400);

  // Verify ownership
  const row = await c.env.DB.prepare("SELECT user_id FROM videos WHERE id = ?")
    .bind(videoId)
    .first<{ user_id: string }>();

  if (!row) return c.json({ error: "Video not found" }, 404);
  if (row.user_id !== user.sub) return c.json({ error: "Not your video" }, 403);

  // Delete from Stream (best-effort — don't block on failure)
  await streamAPI(c.env, `/${videoId}`, "DELETE").catch(() => {});

  // Delete from D1
  await c.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(videoId).run();

  return c.json({ ok: true });
});

/** Toggle a star on a video — no self-starring allowed. */
app.post("/api/star", requireAuth, async (c) => {
  const user = c.var.user!;
  const { videoId } = await c.req.json<{ videoId: string }>();

  if (!videoId) return c.json({ error: "Missing videoId" }, 400);

  // Verify the video exists and check ownership
  const video = await c.env.DB.prepare("SELECT user_id FROM videos WHERE id = ?")
    .bind(videoId)
    .first<{ user_id: string }>();

  if (!video) return c.json({ error: "Video not found" }, 404);
  if (video.user_id === user.sub) return c.json({ error: "Cannot star your own video" }, 403);

  // Check if already starred
  const existing = await c.env.DB.prepare(
    "SELECT 1 FROM stars WHERE user_id = ? AND video_id = ?"
  )
    .bind(user.sub, videoId)
    .first();

  if (existing) {
    await c.env.DB.prepare("DELETE FROM stars WHERE user_id = ? AND video_id = ?")
      .bind(user.sub, videoId)
      .run();
  } else {
    await c.env.DB.prepare("INSERT INTO stars (user_id, video_id) VALUES (?, ?)")
      .bind(user.sub, videoId)
      .run();
  }

  const count = await c.env.DB.prepare(
    "SELECT COUNT(*) as c FROM stars WHERE video_id = ?"
  )
    .bind(videoId)
    .first<{ c: number }>();

  return c.json({ starred: !existing, starCount: count!.c });
});

// CORS preflight for TUS (tus-js-client sends OPTIONS + special headers)
app.options("/api/tus-upload", (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Upload-Length, Upload-Metadata, Tus-Resumable",
      "Access-Control-Expose-Headers": "Location, Tus-Resumable",
      "Access-Control-Max-Age": "86400",
    },
  });
});

// ─── Page Routes ────────────────────────────────────────────────

/** Home page: landing / sign-in prompt. No cross-course content shown. */
app.get("/", (c) => {
  const user = c.var.user;

  const body = user
    ? `<div style="text-align:center; padding: 4rem 0;">
        <h1 style="font-size:2rem;">Demo<span style="color:#f7931a">Clips</span></h1>
        <p style="color:#aaa; max-width:450px; margin:1rem auto;">
          Share short video clips of your game engine projects with your classmates.
          See what others are building. Get inspired.
        </p>
        <p style="color:#888; margin-top:2rem;">
          Use the link your instructor gave you to go to your course's assignment gallery.
        </p>
      </div>`
    : `<div style="text-align:center; padding: 4rem 0;">
        <h1 style="font-size:2rem;">Demo<span style="color:#f7931a">Clips</span></h1>
        <p style="color:#aaa; max-width:450px; margin:1rem auto;">
          Share short video clips of your game engine projects with your classmates.
          See what others are building. Get inspired.
        </p>
        <p style="margin-top:2rem;">
          <a href="/auth/login" class="btn btn-primary">Sign in with your @ucsc.edu account</a>
        </p>
      </div>`;

  return c.html(layout("Welcome", body, user));
});

/** Assignment gallery: view all clips for a course/assignment, with upload link. */
app.get("/:courseId/:assignmentId", async (c) => {
  const user = c.var.user;
  const courseId = c.req.param("courseId");
  const assignmentId = c.req.param("assignmentId");

  if (!user) {
    // Set return_to so login redirects back here
    setCookie(c, "return_to", c.req.path, {
      path: "/",
      httpOnly: true,
      secure: isSecure(c.env),
      sameSite: "Lax",
      maxAge: 300,
    });
    return c.redirect("/auth/login");
  }

  const { results: videos } = await c.env.DB.prepare(
    `SELECT v.*, u.name as user_name, u.picture as user_picture, u.email as user_email,
            (SELECT COUNT(*) FROM stars s WHERE s.video_id = v.id) as star_count,
            EXISTS(SELECT 1 FROM stars s WHERE s.video_id = v.id AND s.user_id = ?) as user_starred
     FROM videos v JOIN users u ON v.user_id = u.id
     WHERE v.course_id = ? AND v.assignment_id = ?
     ORDER BY v.created_at DESC`
  )
    .bind(user.sub, courseId, assignmentId)
    .all<VideoRow>();

  // Backfill duration for videos still processing
  const pending = videos.filter((v) => v.duration === null);
  if (pending.length > 0) {
    const updates = await refreshVideoStatus(
      c.env,
      pending.map((v) => v.id)
    );
    for (const v of pending) {
      const u = updates.get(v.id);
      if (u) v.duration = u.duration;
    }
  }

  const sd = c.env.STREAM_CUSTOMER_SUBDOMAIN;
  const cards = videos.length
    ? `<div class="card-grid">${videos
        .map((v) => videoCard(v, sd, user.sub))
        .join("")}</div>`
    : `<div class="empty-state">
        <p>No clips for this assignment yet.</p>
        <p>Be the first!</p>
      </div>`;

  const body = `
    <div class="breadcrumb">
      <a href="/">Home</a> / ${esc(courseId)} / ${esc(assignmentId)}
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
      <h1 style="margin:0;">Assignment ${esc(assignmentId)}</h1>
      <a href="/${esc(courseId)}/${esc(assignmentId)}/upload" class="btn btn-primary">Upload a clip</a>
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem; margin-top:0.5rem;">
      <p style="color:#888; margin:0;">Course ${esc(courseId)} &middot; ${videos.length} clip${videos.length !== 1 ? "s" : ""}</p>
      ${videos.length > 1 ? `<div class="sort-toggle">
        <button class="active" onclick="sortCards('newest', this)">Newest</button>
        <button onclick="sortCards('stars', this)">Most starred</button>
      </div>` : ""}
    </div>
    ${cards}
    ${playerScript()}`;

  return c.html(layout(`Assignment ${assignmentId}`, body, user));
});

/** Upload page for a specific assignment. */
app.get(
  "/:courseId/:assignmentId/upload",
  requireAuth,
  async (c) => {
    const courseId = c.req.param("courseId");
    const assignmentId = c.req.param("assignmentId");
    const user = c.var.user!;

    const galleryUrl = `/${esc(courseId)}/${esc(assignmentId)}`;

    const body = `
    <div class="breadcrumb">
      <a href="/">Home</a> /
      <a href="${galleryUrl}">${esc(courseId)} / ${esc(assignmentId)}</a> /
      upload
    </div>
    <h1>Upload a Clip</h1>
    <p style="color:#888;">Assignment ${esc(assignmentId)} in course ${esc(courseId)}</p>

    <form id="upload-form" class="upload-form">
      <label for="title">Title</label>
      <input type="text" id="title" name="title" required placeholder="e.g. Player controller with wall jump">

      <label for="description">Description (optional)</label>
      <textarea id="description" name="description" placeholder="What are you showing off?"></textarea>

      <label for="file">Video file (.webm, .mp4 &mdash; max 500MB, 10 min)</label>
      <input type="file" id="file" name="file" accept="video/webm,video/mp4,video/*" required>

      <div id="progress-wrap">
        <div id="progress-bar"><div></div></div>
        <div id="progress-text">Uploading...</div>
      </div>

      <div style="margin-top:1.25rem;">
        <button type="submit" class="btn btn-primary" id="submit-btn">Upload</button>
      </div>
    </form>

    <script src="https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js"></script>
    <script>
    var form = document.getElementById('upload-form');
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var title = document.getElementById('title').value.trim();
      var desc = document.getElementById('description').value.trim();
      var file = document.getElementById('file').files[0];
      var btn = document.getElementById('submit-btn');
      var progressWrap = document.getElementById('progress-wrap');
      var progressBar = document.getElementById('progress-bar').firstElementChild;
      var progressText = document.getElementById('progress-text');

      if (!file) return alert('Please select a video file.');
      if (file.size > 500 * 1024 * 1024) return alert('File too large (max 500MB).');

      btn.disabled = true;
      btn.textContent = 'Uploading...';
      progressWrap.style.display = 'block';

      var upload = new tus.Upload(file, {
        endpoint: '/api/tus-upload',
        chunkSize: 50 * 1024 * 1024, // 50 MB chunks
        retryDelays: [0, 1000, 3000, 5000],
        metadata: {
          filename: file.name,
          filetype: file.type,
          courseId: '${esc(courseId)}',
          assignmentId: '${esc(assignmentId)}',
          title: title,
          description: desc,
        },
        onError: function(err) {
          progressText.textContent = 'Upload failed: ' + err.message;
          btn.disabled = false;
          btn.textContent = 'Upload';
        },
        onProgress: function(bytesUploaded, bytesTotal) {
          var pct = Math.round((bytesUploaded / bytesTotal) * 100);
          progressBar.style.width = pct + '%';
          var mb = (bytesUploaded / 1024 / 1024).toFixed(1);
          var total = (bytesTotal / 1024 / 1024).toFixed(1);
          progressText.textContent = 'Uploading... ' + mb + ' / ' + total + ' MB (' + pct + '%)';
        },
        onSuccess: function() {
          progressText.textContent = 'Upload complete! Redirecting...';
          progressBar.style.width = '100%';
          window.location.href = '${galleryUrl}';
        },
      });

      upload.start();
    });
    </script>`;

    return c.html(layout("Upload", body, user));
  }
);

// ─── 404 ────────────────────────────────────────────────────────

app.notFound((c) => {
  const body = `
    <div class="empty-state">
      <h1>404</h1>
      <p>Page not found.</p>
      <p><a href="/">Go home</a></p>
    </div>`;
  return c.html(layout("Not Found", body, c.var.user), 404);
});

// ─── Export ─────────────────────────────────────────────────────

export default app;
