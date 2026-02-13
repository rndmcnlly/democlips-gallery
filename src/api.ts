// ─── API Routes ─────────────────────────────────────────────────
//
// JSON API endpoints: TUS upload initiation, video delete, star toggle,
// hide toggle, metadata update, and CORS preflight.

import { Hono } from "hono";
import { Bindings, Variables, isModerator } from "./types";
import { requireAuth } from "./auth";
import { streamAPI, initiateStreamUpload } from "./stream";

export const apiRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

/**
 * TUS upload initiation — creates a resumable upload session on Stream.
 * The client uses tus-js-client pointed at this endpoint; the Worker proxies
 * only the initial POST (creating the session), then the client uploads
 * chunks directly to the Stream-returned Location URL.
 *
 * Metadata (courseId, assignmentId, title, etc.) is passed via the
 * Upload-Metadata header per the TUS protocol.
 */
apiRoutes.post("/tus-upload", requireAuth, async (c) => {
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

  if (!courseId || !assignmentId) {
    return c.json({ error: "Missing courseId or assignmentId in Upload-Metadata" }, 400);
  }

  const result = await initiateStreamUpload(
    c.env,
    user.sub,
    user.email,
    courseId,
    assignmentId,
    c.req.header("Upload-Length") || "0"
  );

  if ("error" in result) {
    return c.json({ error: result.error }, result.status as 500);
  }

  // Return the Location to the tus-js-client so it uploads directly to Stream
  return new Response(null, {
    status: 201,
    headers: {
      "Tus-Resumable": "1.0.0",
      Location: result.location,
      "Access-Control-Expose-Headers": "Location, Tus-Resumable",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

/** Delete a video — only the uploader can delete their own clips. */
apiRoutes.post("/delete-video", requireAuth, async (c) => {
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
apiRoutes.post("/star", requireAuth, async (c) => {
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

/** Toggle hidden status on a video — moderators only. */
apiRoutes.post("/hide-video", requireAuth, async (c) => {
  const user = c.var.user!;

  if (!isModerator(c.env, user)) {
    return c.json({ error: "Not authorized" }, 403);
  }

  const { videoId } = await c.req.json<{ videoId: string }>();
  if (!videoId) return c.json({ error: "Missing videoId" }, 400);

  const row = await c.env.DB.prepare("SELECT id, hidden FROM videos WHERE id = ?")
    .bind(videoId)
    .first<{ id: string; hidden: number }>();

  if (!row) return c.json({ error: "Video not found" }, 404);

  await c.env.DB.prepare("UPDATE videos SET hidden = 1 - hidden WHERE id = ?")
    .bind(videoId)
    .run();

  return c.json({ hidden: !row.hidden });
});

/** Update video metadata — owner can edit title, description, url at any time. */
apiRoutes.post("/update-video", requireAuth, async (c) => {
  const user = c.var.user!;
  const { videoId, title, description, url } = await c.req.json<{
    videoId: string;
    title?: string;
    description?: string;
    url?: string;
  }>();

  if (!videoId) return c.json({ error: "Missing videoId" }, 400);

  // Verify ownership
  const row = await c.env.DB.prepare("SELECT user_id FROM videos WHERE id = ?")
    .bind(videoId)
    .first<{ user_id: string }>();

  if (!row) return c.json({ error: "Video not found" }, 404);
  if (row.user_id !== user.sub) return c.json({ error: "Not your video" }, 403);

  await c.env.DB.prepare(
    "UPDATE videos SET title = ?, description = ?, url = ? WHERE id = ?"
  )
    .bind(
      (title ?? "").trim(),
      (description ?? "").trim(),
      (url ?? "").trim(),
      videoId
    )
    .run();

  return c.json({ ok: true });
});

// CORS preflight for TUS (tus-js-client sends OPTIONS + special headers)
apiRoutes.options("/tus-upload", (c) => {
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
