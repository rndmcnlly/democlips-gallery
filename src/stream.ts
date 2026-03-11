// ─── Stream API Helpers ─────────────────────────────────────────
//
// Cloudflare Stream REST API wrappers: generic fetch helper,
// duration backfill, TUS upload session creation, and Stream Live
// input management for OBS-style RTMP ingest.

import { Bindings, LiveInputRow } from "./types";

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

// ─── Stream Live (OBS) ──────────────────────────────────────────

/** Response shape from the Cloudflare Stream Live Input API. */
type LiveInputResult = {
  uid: string;
  rtmps: { url: string; streamKey: string };
  srt: { url: string; streamId: string; passphrase: string };
  created: string;
  modified: string;
};

/** Response shape for videos produced by a Live Input. */
type LiveInputVideoResult = {
  uid: string;
  readyToStream: boolean;
  duration: number;
  created: string;
};

/**
 * Create a Cloudflare Stream Live Input for OBS-style RTMP ingest.
 * Sets recording.mode to "automatic" so a replay recording is produced
 * ~60s after the broadcast ends.
 */
export async function createLiveInput(
  env: Bindings,
  meta?: { creator?: string }
): Promise<LiveInputResult | null> {
  const body: Record<string, any> = {
    recording: { mode: "automatic", timeoutSeconds: 60 },
    meta: meta || {},
  };
  const data = await streamAPI(env, "/live_inputs", "POST", body);
  if (data.success && data.result) {
    return data.result as LiveInputResult;
  }
  return null;
}

/** List videos (recordings) produced by a Live Input. */
export async function getLiveInputVideos(
  env: Bindings,
  liveInputId: string
): Promise<LiveInputVideoResult[]> {
  const data = await streamAPI(env, `/live_inputs/${liveInputId}/videos`);
  if (data.success && data.result) {
    return data.result as LiveInputVideoResult[];
  }
  return [];
}

/** Delete a Cloudflare Stream Live Input. Best-effort. */
export async function deleteLiveInput(
  env: Bindings,
  liveInputId: string
): Promise<void> {
  await streamAPI(env, `/live_inputs/${liveInputId}`, "DELETE").catch(() => {});
}

/**
 * Resolve pending live inputs for a given course+assignment.
 *
 * For each live_inputs row:
 * - If expired with no recording: delete row + Cloudflare Live Input (cleanup).
 * - If a recording exists: INSERT into videos, delete the live_inputs row,
 *   and delete the Cloudflare Live Input. Returns the newly created video IDs
 *   so the caller can include them in the gallery response.
 *
 * Cap at maxChecks to bound latency per page load (same principle as
 * duration backfill).
 */
export async function resolveLiveInputs(
  env: Bindings,
  courseId: string,
  assignmentId: string,
  maxChecks = 5
): Promise<string[]> {
  const { results: pending } = await env.DB.prepare(
    "SELECT * FROM live_inputs WHERE course_id = ? AND assignment_id = ? LIMIT ?"
  )
    .bind(courseId, assignmentId, maxChecks)
    .all<LiveInputRow>();

  const newVideoIds: string[] = [];
  const now = new Date().toISOString();

  for (const input of pending) {
    // Expired with no recording? Clean up.
    if (input.expires_at < now) {
      const videos = await getLiveInputVideos(env, input.id);
      if (videos.length === 0) {
        await deleteLiveInput(env, input.id);
        await env.DB.prepare("DELETE FROM live_inputs WHERE id = ?").bind(input.id).run();
        continue;
      }
      // Expired but has a recording — fall through to resolve it
    }

    // Check for recordings
    const videos = await getLiveInputVideos(env, input.id);
    if (videos.length === 0) continue; // Still streaming or hasn't started

    // Take the latest recording
    const recording = videos[videos.length - 1];

    // Delete any existing video for this user+course+assignment (clobber)
    const existing = await env.DB.prepare(
      "SELECT id FROM videos WHERE user_id = ? AND course_id = ? AND assignment_id = ?"
    )
      .bind(input.user_id, input.course_id, input.assignment_id)
      .first<{ id: string }>();

    if (existing) {
      await streamAPI(env, `/${existing.id}`, "DELETE").catch(() => {});
      await env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(existing.id).run();
    }

    // Insert the recording as a real video row
    await env.DB.prepare(
      `INSERT INTO videos (id, user_id, course_id, assignment_id, title, description, url)
       VALUES (?, ?, ?, ?, '', '', '')`
    )
      .bind(recording.uid, input.user_id, input.course_id, input.assignment_id)
      .run();

    newVideoIds.push(recording.uid);

    // Clean up: delete the live input from both D1 and Cloudflare
    await deleteLiveInput(env, input.id);
    await env.DB.prepare("DELETE FROM live_inputs WHERE id = ?").bind(input.id).run();
  }

  return newVideoIds;
}

// ─── TUS Upload ─────────────────────────────────────────────────

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
