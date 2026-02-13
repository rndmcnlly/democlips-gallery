// ─── Upload Key Routes ──────────────────────────────────────────
//
// Stateless JWT-based upload keys for external tools (OBS, Unity, curl).
// Keys encode user + course + assignment and expire in 24h.
// Exports: uploadKeyRoutes (mounted at root — handles /api/create-upload-key and /k/:key)

import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import { Bindings, Variables, UploadKeyClaims } from "./types";
import { requireAuth } from "./auth";
import { streamAPI, initiateStreamUpload } from "./stream";

export const uploadKeyRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * Verify an upload key JWT and return the claims. Rejects expired or
 * malformed tokens, and tokens that aren't upload keys (e.g. session JWTs).
 */
async function verifyUploadKey(
  token: string,
  secret: string
): Promise<UploadKeyClaims | null> {
  try {
    const payload = (await verify(token, secret, "HS256")) as unknown as UploadKeyClaims;
    if (payload.purpose !== "upload-key") return null;
    if (!payload.sub || !payload.courseId || !payload.assignmentId) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate an upload key — a signed JWT URL the student can paste into
 * an external tool. The key is scoped to one course+assignment and expires
 * in 24 hours.
 */
uploadKeyRoutes.post("/api/create-upload-key", requireAuth, async (c) => {
  const user = c.var.user!;
  const { courseId, assignmentId } = await c.req.json<{
    courseId: string;
    assignmentId: string;
  }>();

  if (!courseId || !assignmentId) {
    return c.json({ error: "Missing courseId or assignmentId" }, 400);
  }

  const claims: UploadKeyClaims = {
    sub: user.sub,
    email: user.email,
    courseId,
    assignmentId,
    purpose: "upload-key",
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  };

  const token = await sign(claims, c.env.JWT_SECRET, "HS256");

  // Build the full upload URL — POST a file here, or point a TUS client at it
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/k/${token}`;

  return c.json({ key: token, url, expiresIn: "24h" });
});

/**
 * Upload via upload key — single endpoint for both plain POST and TUS clients.
 * If the request carries a Tus-Resumable header, treat it as a TUS session
 * initiation; otherwise read the body as a plain file upload.
 *
 *   curl -X POST -H "Content-Type: video/mp4" --data-binary @clip.mp4 \
 *        https://gallery.democlips.dev/k/<token>
 */
uploadKeyRoutes.post("/k/:key", async (c) => {
  const claims = await verifyUploadKey(c.req.param("key"), c.env.JWT_SECRET);
  if (!claims) {
    return c.json({ error: "Invalid or expired upload key" }, 401);
  }

  // ── TUS path: client sent Tus-Resumable header ──────────────────
  if (c.req.header("Tus-Resumable")) {
    const uploadLength = c.req.header("Upload-Length") || "0";
    const result = await initiateStreamUpload(
      c.env,
      claims.sub,
      claims.email,
      claims.courseId,
      claims.assignmentId,
      uploadLength
    );

    if ("error" in result) {
      return c.json({ error: result.error }, result.status as 500);
    }

    return new Response(null, {
      status: 201,
      headers: {
        "Tus-Resumable": "1.0.0",
        Location: result.location,
        "Access-Control-Expose-Headers": "Location, Tus-Resumable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ── Plain upload path: raw file body ────────────────────────────
  const body = await c.req.arrayBuffer();
  if (!body || body.byteLength === 0) {
    return c.json({ error: "Empty request body — POST the video file as the request body" }, 400);
  }

  // One clip per student per assignment — auto-replace any existing clip
  const existing = await c.env.DB.prepare(
    "SELECT id FROM videos WHERE user_id = ? AND course_id = ? AND assignment_id = ?"
  )
    .bind(claims.sub, claims.courseId, claims.assignmentId)
    .first<{ id: string }>();

  if (existing) {
    await streamAPI(c.env, `/${existing.id}`, "DELETE").catch(() => {});
    await c.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(existing.id).run();
  }

  // Use the Stream direct-upload JSON API (not TUS) for a single-shot upload
  const formData = new FormData();
  const contentType = c.req.header("Content-Type") || "video/mp4";
  const blob = new Blob([body], { type: contentType });
  formData.append("file", blob, "upload.mp4");
  formData.append("maxDurationSeconds", "600");
  formData.append("creator", claims.email);

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${c.env.CLOUDFLARE_ACCOUNT_ID}/stream`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.CLOUDFLARE_API_TOKEN}`,
      },
      body: formData,
    }
  );

  const data = (await res.json()) as {
    success: boolean;
    result?: { uid: string };
    errors?: { message: string }[];
  };

  if (!data.success || !data.result?.uid) {
    const msg = data.errors?.map((e) => e.message).join(", ") || "Unknown Stream error";
    return c.json({ error: `Stream upload failed: ${msg}` }, 500);
  }

  const videoId = data.result.uid;

  await c.env.DB.prepare(
    `INSERT INTO videos (id, user_id, course_id, assignment_id, title, description, url)
     VALUES (?, ?, ?, ?, '', '', '')`
  )
    .bind(videoId, claims.sub, claims.courseId, claims.assignmentId)
    .run();

  return c.json({ ok: true, videoId });
});

// CORS preflight for upload key endpoint
uploadKeyRoutes.options("/k/:key", (c) => {
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
