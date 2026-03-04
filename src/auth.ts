// ─── Auth ───────────────────────────────────────────────────────
//
// Google OAuth 2.0 (authorization code flow) + JWT session cookies.
// Exports:
//   - softAuth: middleware that populates c.var.user (null if not logged in)
//   - requireAuth: guard that redirects to /auth/login if not logged in
//   - authRoutes: Hono app with /auth/login, /auth/callback, /auth/logout, /auth/me

import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Bindings, Variables, User, isSecure } from "./types";

// ─── Middleware ──────────────────────────────────────────────────

/** Soft auth: sets c.var.user if logged in, null otherwise. Never redirects. */
export async function softAuth(c: any, next: any) {
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
}

/** Hard auth guard for protected routes. Sets return_to so login redirects back. */
export function requireAuth(c: any, next: any) {
  if (!c.var.user) {
    setCookie(c, "return_to", c.req.path, {
      path: "/",
      httpOnly: true,
      secure: isSecure(c.env),
      sameSite: "Lax",
      maxAge: 300,
    });
    return c.redirect("/auth/login");
  }
  return next();
}

// ─── Helpers ────────────────────────────────────────────────────

/** Minimal error page with a retry link so users never hit a dead end. */
function authErrorPage(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{background:#0f0f0f;color:#e0e0e0;font-family:system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
  .box{text-align:center;max-width:28rem;padding:2rem;}
  h1{font-size:1.4rem;margin-bottom:.5rem;}
  p{color:#888;line-height:1.5;}
  a{color:#6cf;text-decoration:none;} a:hover{text-decoration:underline;}
</style>
</head><body><div class="box">
<h1>${title}</h1>
<p>${detail}</p>
<p style="margin-top:1.5rem;"><a href="/auth/login">Try signing in again</a> · <a href="/">Home</a></p>
</div></body></html>`;
}

// ─── Auth Routes ────────────────────────────────────────────────

export const authRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

authRoutes.get("/login", (c) => {
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

authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, "oauth_state");
  const error = c.req.query("error");

  deleteCookie(c, "oauth_state", { path: "/" });

  if (error) {
    return c.html(authErrorPage("Sign-in cancelled", "Google returned an error. This usually means the sign-in was cancelled or permissions were denied."), 400);
  }
  if (!code || !state || state !== storedState) {
    return c.html(authErrorPage("Session expired", "Your login session timed out before it could complete. This can happen if the sign-in page sat open for too long."), 403);
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
    return c.html(authErrorPage("Sign-in failed", "Something went wrong exchanging credentials with Google. This is usually temporary."), 500);
  }

  const tokens = (await tokenRes.json()) as { access_token: string };

  // Fetch user info
  const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!infoRes.ok) {
    return c.html(authErrorPage("Sign-in failed", "Could not retrieve your account information from Google. This is usually temporary."), 500);
  }

  const info = (await infoRes.json()) as {
    sub: string;
    email: string;
    name: string;
    picture: string;
    hd?: string;
  };

  // Server-side domain enforcement
  if (info.hd !== c.env.ALLOWED_DOMAIN) {
    return c.html(authErrorPage(
      "Wrong account",
      `Access is restricted to @${c.env.ALLOWED_DOMAIN} accounts. You signed in as ${info.email}. Try again with your university account.`
    ), 403);
  }

  // Upsert user in D1.
  // If the email already belongs to a row with a different id (e.g. a backfill
  // import that used a synthetic id like "backfill:1234"), migrate that row's id
  // to the real Google sub and cascade the change to videos and stars.
  const existing = await c.env.DB.prepare(
    "SELECT id FROM users WHERE email = ?"
  )
    .bind(info.email)
    .first<{ id: string }>();

  if (existing && existing.id !== info.sub) {
    // Migrate: replace the old synthetic id with the real Google sub.
    // D1 enforces foreign keys, so we must: clear the old row's email
    // (to avoid UNIQUE conflict), insert the new row (so the FK target
    // exists), reparent children, then delete the old row.
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET email = '' WHERE id = ?").bind(existing.id),
      c.env.DB.prepare(
        "INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)"
      ).bind(info.sub, info.email, info.name, info.picture),
      c.env.DB.prepare("UPDATE stars  SET user_id = ? WHERE user_id = ?").bind(info.sub, existing.id),
      c.env.DB.prepare("UPDATE videos SET user_id = ? WHERE user_id = ?").bind(info.sub, existing.id),
      c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(existing.id),
    ]);
  } else {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, name, picture) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture`
    )
      .bind(info.sub, info.email, info.name, info.picture)
      .run();
  }

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

authRoutes.get("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

authRoutes.get("/me", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, user });
});
