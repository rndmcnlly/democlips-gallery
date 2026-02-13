// ─── Types ──────────────────────────────────────────────────────
//
// Shared type definitions used across all modules. Import from here
// rather than re-declaring types in each file.

import { Hono } from "hono";

export type Bindings = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  JWT_SECRET: string;
  ALLOWED_DOMAIN: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  STREAM_CUSTOMER_SUBDOMAIN: string;
  MODERATOR_EMAILS: string;
};

export type User = {
  sub: string;
  email: string;
  name: string;
  picture: string;
  hd: string;
};

export type Variables = {
  user: User | null;
};

export type UploadKeyClaims = {
  sub: string;          // user ID (Google 'sub')
  email: string;        // for Upload-Creator on Stream
  courseId: string;
  assignmentId: string;
  purpose: "upload-key"; // distinguishes from session JWTs
  exp: number;
};

export type VideoRow = {
  id: string;
  user_id: string;
  course_id: string;
  assignment_id: string;
  title: string;
  description: string;
  url: string;
  duration: number | null;
  thumbnail_pct: number;
  created_at: string;
  user_name: string;
  user_picture: string;
  user_email: string;
  hidden: number;
  star_count: number;
  user_starred: number;
};

/** Hono app type parameterised with our bindings + variables. */
export type App = Hono<{ Bindings: Bindings; Variables: Variables }>;

// ─── Helpers used across modules ────────────────────────────────

/** True in production (HTTPS), false on localhost (HTTP). */
export function isSecure(env: Bindings): boolean {
  return env.GOOGLE_REDIRECT_URI.startsWith("https://");
}

/** Check if the current user is a moderator (email in MODERATOR_EMAILS env var). */
export function isModerator(env: Bindings, user: User | null): boolean {
  if (!user || !env.MODERATOR_EMAILS) return false;
  return env.MODERATOR_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .includes(user.email.toLowerCase());
}
