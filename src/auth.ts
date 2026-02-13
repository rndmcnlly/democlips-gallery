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

/** Hard auth guard for protected routes. */
export function requireAuth(c: any, next: any) {
  if (!c.var.user) {
    return c.redirect("/auth/login");
  }
  return next();
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

authRoutes.get("/logout", (c) => {
  deleteCookie(c, "session", { path: "/" });
  return c.redirect("/");
});

authRoutes.get("/me", async (c) => {
  const user = c.var.user;
  if (!user) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, user });
});
