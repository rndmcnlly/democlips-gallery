// ─── Stream API Helpers ─────────────────────────────────────────
//
// Cloudflare Stream REST API wrappers: generic fetch helper,
// duration backfill, and TUS upload session creation.

import { Bindings } from "./types";

/** Generic Cloudflare Stream API caller. */
export async function streamAPI(
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
export async function refreshVideoStatus(
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

/**
 * Shared logic: replace any existing clip, create a TUS session on Stream,
 * insert the D1 record, and return the Stream Location URL + video ID.
 */
export async function initiateStreamUpload(
  env: Bindings,
  userId: string,
  email: string,
  courseId: string,
  assignmentId: string,
  uploadLength: string
): Promise<{ location: string; videoId: string } | { error: string; status: number }> {
  // One clip per student per assignment — auto-replace any existing clip
  const existing = await env.DB.prepare(
    "SELECT id FROM videos WHERE user_id = ? AND course_id = ? AND assignment_id = ?"
  )
    .bind(userId, courseId, assignmentId)
    .first<{ id: string }>();

  if (existing) {
    await streamAPI(env, `/${existing.id}`, "DELETE").catch(() => {});
    await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(existing.id).run();
  }

  const streamMeta = [
    `maxDurationSeconds ${btoa("600")}`,
    `expiry ${btoa(new Date(Date.now() + 3600_000).toISOString())}`,
    `allowedorigins ${btoa("gallery.democlips.dev,localhost:8787")}`,
  ].join(",");

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": uploadLength,
        "Upload-Metadata": streamMeta,
        "Upload-Creator": email,
      },
    }
  );

  const location = res.headers.get("Location");
  if (!location) {
    const body = await res.text();
    return { error: `Failed to create TUS upload: ${body}`, status: 500 };
  }

  const videoId = res.headers.get("stream-media-id") || location.split("/").pop()?.split("?")[0] || "";

  if (videoId) {
    await env.DB.prepare(
      `INSERT INTO videos (id, user_id, course_id, assignment_id, title, description, url)
       VALUES (?, ?, ?, ?, '', '', '')`
    )
      .bind(videoId, userId, courseId, assignmentId)
      .run();
  }

  return { location, videoId };
}
