// ─── Page Routes ────────────────────────────────────────────────
//
// Server-rendered HTML pages: home, onboarding, moderation dashboard,
// single-video page, assignment gallery, upload page, and 404.

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { Bindings, Variables, VideoRow, isSecure, isModerator } from "./types";
import { layout, esc, fmtDuration, fmtDate, videoCard, playerScript } from "./html";
import { requireAuth } from "./auth";
import { refreshVideoStatus } from "./stream";

export const pageRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ─── Home ───────────────────────────────────────────────────────

/** Home page: landing / sign-in prompt. No cross-course content shown. */
pageRoutes.get("/", (c) => {
  const user = c.var.user;

  const moderator = isModerator(c.env, user);

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
        <p style="margin-top:1.5rem;">
          <a href="/onboarding" style="color:#6cb4ee;">Instructor? Set up your gallery &rarr;</a>
        </p>
        ${moderator ? `<p style="margin-top:1rem;"><a href="/moderation" class="btn btn-primary" style="background:#7c3aed;">Moderation Dashboard</a></p>` : ""}
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

// ─── Onboarding ─────────────────────────────────────────────────

/** Onboarding: help instructors extract course/assignment IDs from Canvas URLs. */
pageRoutes.get("/onboarding", requireAuth, async (c) => {
  const user = c.var.user!;

  // Build moderator contact list from env, enriched with DB profiles
  const modEmails = (c.env.MODERATOR_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  type ModProfile = { email: string; name: string; picture: string };
  const modProfiles = new Map<string, ModProfile>();
  if (modEmails.length) {
    const placeholders = modEmails.map(() => "?").join(",");
    const { results } = await c.env.DB.prepare(
      `SELECT email, name, picture FROM users WHERE LOWER(email) IN (${placeholders})`
    )
      .bind(...modEmails)
      .all<ModProfile>();
    for (const row of results) {
      modProfiles.set(row.email.toLowerCase(), row);
    }
  }

  const modListHtml = modEmails.length
    ? modEmails
        .map((e) => {
          const profile = modProfiles.get(e);
          if (profile) {
            return `<a href="mailto:${esc(e)}" style="display:inline-flex; align-items:center; gap:0.5rem;
              text-decoration:none; color:#e0e0e0; background:#1a1a2e; border:1px solid #2a2a4a;
              border-radius:8px; padding:0.4rem 0.75rem 0.4rem 0.4rem; margin:0.25rem 0;">
              <img src="${esc(profile.picture)}" style="width:24px; height:24px; border-radius:50%;">
              <span>${esc(profile.name)}</span>
              <span style="color:#888; font-size:0.8rem;">${esc(e)}</span>
            </a>`;
          }
          return `<a href="mailto:${esc(e)}" style="color:#6cb4ee;">${esc(e)}</a>`;
        })
        .join(" ")
    : `<span style="color:#888;">(none configured)</span>`;

  const body = `
    <div class="breadcrumb"><a href="/">Home</a> / Instructor Onboarding</div>

    <div style="max-width:640px; margin:2rem auto;">
      <h1 style="font-size:1.5rem; margin-bottom:0.5rem;">Instructor Onboarding</h1>
      <p style="color:#aaa; margin-bottom:2rem;">
        Set up a DemoClips gallery for your Canvas assignment in three steps.
      </p>

      <h2 style="font-size:1.1rem; color:#f7931a; margin-bottom:0.5rem;">Step 1 &mdash; Paste your Canvas assignment URL</h2>
      <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.75rem;">
        Open the assignment in Canvas and copy the full URL from your browser's address bar.
        It should look like:<br>
        <code style="color:#888; font-size:0.85rem;">https://canvas.ucsc.edu/courses/<b style="color:#6cb4ee;">12345</b>/assignments/<b style="color:#6cb4ee;">67890</b></code>
      </p>
      <input
        type="text" id="canvas-url"
        placeholder="https://canvas.ucsc.edu/courses/…/assignments/…"
        style="width:100%; padding:0.6rem 0.75rem; background:#111; border:1px solid #333;
               border-radius:6px; color:#e0e0e0; font-size:0.95rem; box-sizing:border-box;"
      >
      <p id="parse-error" style="color:#e53e3e; font-size:0.85rem; margin-top:0.4rem; display:none;"></p>

      <div id="result" style="display:none; margin-top:1.5rem;">
        <h2 style="font-size:1.1rem; color:#f7931a; margin-bottom:0.5rem;">Step 2 &mdash; Share this gallery link with students</h2>
        <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.5rem;">
          Students who visit this link will be prompted to sign in with their @ucsc.edu account,
          then they can upload a clip or browse the gallery.
        </p>
        <div style="background:#111; border:1px solid #333; border-radius:6px; padding:0.6rem 0.75rem;
                    display:flex; align-items:center; gap:0.5rem;">
          <code id="gallery-url" style="flex:1; word-break:break-all; color:#6cb4ee; font-size:0.9rem;"></code>
          <button id="copy-btn" onclick="copyUrl()" class="btn btn-primary"
                  style="flex-shrink:0; font-size:0.8rem; padding:0.35rem 0.75rem;">Copy</button>
        </div>

        <h2 style="font-size:1.1rem; color:#f7931a; margin-top:2rem; margin-bottom:0.5rem;">Step 3 &mdash; Know how moderation works</h2>
        <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.5rem;">
          Students can upload one clip per assignment. They can delete and re-upload their own clip,
          but they <strong>cannot</strong> hide other students' clips.
        </p>
        <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.5rem;">
          Only <strong>moderators</strong> can hide clips (e.g. for policy violations). Hidden clips
          are not deleted &mdash; they're just invisible to non-moderators and can be un-hidden later.
        </p>
        <p style="color:#aaa; font-size:0.9rem; margin-bottom:0.5rem;">
          If you need a clip hidden, or if you'd like moderator access yourself,
          contact a current moderator:
        </p>
        <p style="margin-bottom:0.5rem;">${modListHtml}</p>
      </div>

    </div>

    <script>
    var input = document.getElementById("canvas-url");
    var result = document.getElementById("result");
    var error = document.getElementById("parse-error");
    var galleryUrl = document.getElementById("gallery-url");
    var copyBtn = document.getElementById("copy-btn");

    var pattern = /\\/courses\\/(\\d+)\\/assignments\\/(\\d+)/;

    function parseUrl() {
      var val = input.value.trim();
      error.style.display = "none";
      if (!val) { result.style.display = "none"; return; }
      var m = val.match(pattern);
      if (!m) {
        error.textContent = "Could not find course and assignment IDs. Paste the full Canvas URL, e.g. https://canvas.ucsc.edu/courses/12345/assignments/67890";
        error.style.display = "block";
        result.style.display = "none";
        return;
      }
      var courseId = m[1];
      var assignmentId = m[2];
      var url = location.origin + "/" + courseId + "/" + assignmentId;
      galleryUrl.textContent = url;
      result.style.display = "block";
    }

    input.addEventListener("input", parseUrl);
    input.addEventListener("paste", function() { setTimeout(parseUrl, 0); });

    function copyUrl() {
      navigator.clipboard.writeText(galleryUrl.textContent).then(function() {
        copyBtn.textContent = "Copied!";
        setTimeout(function() { copyBtn.textContent = "Copy"; }, 1500);
      });
    }
    </script>`;

  return c.html(layout("Instructor Onboarding", body, user));
});

// ─── Moderation Dashboard ───────────────────────────────────────

/** Moderation dashboard: per-course, per-assignment summary stats. Moderators only. */
pageRoutes.get("/moderation", requireAuth, async (c) => {
  const user = c.var.user!;
  if (!isModerator(c.env, user)) {
    return c.text("Not authorized", 403);
  }

  type SummaryRow = {
    course_id: string;
    assignment_id: string;
    total_clips: number;
    total_stars: number;
    hidden_clips: number;
  };

  const { results: rows } = await c.env.DB.prepare(
    `SELECT
       v.course_id,
       v.assignment_id,
       COUNT(*) as total_clips,
       COALESCE(SUM(sc.star_count), 0) as total_stars,
       SUM(v.hidden) as hidden_clips
     FROM videos v
     LEFT JOIN (
       SELECT video_id, COUNT(*) as star_count FROM stars GROUP BY video_id
     ) sc ON sc.video_id = v.id
     GROUP BY v.course_id, v.assignment_id
     ORDER BY v.course_id, v.assignment_id`
  ).all<SummaryRow>();

  // Group rows by course
  const courses = new Map<string, SummaryRow[]>();
  for (const row of rows) {
    const list = courses.get(row.course_id);
    if (list) {
      list.push(row);
    } else {
      courses.set(row.course_id, [row]);
    }
  }

  let tableRows = "";
  for (const [courseId, assignments] of courses) {
    tableRows += `<tr class="course-header"><td colspan="4">${esc(courseId)}</td></tr>`;
    for (const a of assignments) {
      const hiddenBadge = a.hidden_clips > 0
        ? ` <span class="mod-badge mod-badge-warn">${a.hidden_clips} hidden</span>`
        : "";
      tableRows += `<tr>
        <td style="padding-left:1.5rem;">
          <a href="/${esc(a.course_id)}/${esc(a.assignment_id)}">${esc(a.assignment_id)}</a>
        </td>
        <td>${a.total_clips}</td>
        <td>${a.total_stars}</td>
        <td>${hiddenBadge}</td>
      </tr>`;
    }
  }

  const body = `
    <div class="breadcrumb"><a href="/">Home</a> / Moderation</div>
    <h1>Moderation Dashboard</h1>
    <p style="color:#888;">Per-assignment summary across all courses. Click an assignment to open its gallery.</p>
    ${rows.length === 0
      ? `<div class="empty-state"><p>No clips in the system yet.</p></div>`
      : `<table class="mod-table">
          <thead><tr><th>Assignment</th><th>Clips</th><th>Stars</th><th>Flags</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table>`
    }`;

  return c.html(layout("Moderation", body, user));
});

// ─── Single Video Page ──────────────────────────────────────────

/** Standalone video page: shareable link to a single clip. */
pageRoutes.get("/v/:videoId{[0-9a-fA-F-]+}", async (c) => {
  const user = c.var.user;
  const videoId = c.req.param("videoId");

  if (!user) {
    setCookie(c, "return_to", c.req.path, {
      path: "/",
      httpOnly: true,
      secure: isSecure(c.env),
      sameSite: "Lax",
      maxAge: 300,
    });
    return c.redirect("/auth/login");
  }

  const moderator = isModerator(c.env, user);

  const video = await c.env.DB.prepare(
    `SELECT v.*, u.name as user_name, u.picture as user_picture, u.email as user_email,
            (SELECT COUNT(*) FROM stars s WHERE s.video_id = v.id) as star_count,
            EXISTS(SELECT 1 FROM stars s WHERE s.video_id = v.id AND s.user_id = ?) as user_starred
     FROM videos v JOIN users u ON v.user_id = u.id
     WHERE v.id = ? AND (v.hidden = 0 OR ?)`
  )
    .bind(user.sub, videoId, moderator ? 1 : 0)
    .first<VideoRow>();

  if (!video) {
    const body = `
      <div class="empty-state">
        <h1>Video not found</h1>
        <p>This clip may have been deleted, or you may not have access.</p>
        <p><a href="/">Go home</a></p>
      </div>`;
    return c.html(layout("Not Found", body, user), 404);
  }

  // Backfill duration if still processing
  if (video.duration === null) {
    const updates = await refreshVideoStatus(c.env, [video.id]);
    const u = updates.get(video.id);
    if (u) video.duration = u.duration;
  }

  const sd = c.env.STREAM_CUSTOMER_SUBDOMAIN;
  const galleryUrl = `/${esc(video.course_id)}/${esc(video.assignment_id)}`;
  const isOwner = video.user_id === user.sub;

  const playerEmbed = video.duration
    ? `<div style="width:100%; max-width:960px; aspect-ratio:16/9; margin:0 auto 1.5rem;">
        <iframe
          src="https://customer-${esc(sd)}.cloudflarestream.com/${esc(video.id)}/iframe?autoplay=true"
          style="width:100%; height:100%; border:none; border-radius:8px;"
          allow="autoplay; fullscreen" allowfullscreen>
        </iframe>
      </div>`
    : `<div style="text-align:center; padding:3rem; color:#888; font-style:italic; background:#111; border-radius:8px; margin-bottom:1.5rem;">
        Video is still processing&hellip; check back shortly.
      </div>`;

  const durationStr = video.duration ? ` &middot; ${fmtDuration(video.duration)}` : "";

  const starredClass = video.user_starred ? " starred" : "";
  const starDisabled = isOwner ? " disabled" : "";
  const starBtn = `<button class="star-btn${starredClass}"${starDisabled} onclick="starVideo(event, '${esc(video.id)}')" title="${isOwner ? "Can't star your own clip" : "Star this clip"}"><span class="star-icon"></span><span class="star-count">${video.star_count}</span></button>`;

  const editBtn = isOwner
    ? `<button class="delete-btn" onclick="openEdit()" title="Edit clip details" style="font-size:0.85rem; padding:4px 10px; margin-right:0.25rem;">edit</button>`
    : "";
  const deleteBtn = isOwner
    ? `<button class="delete-btn" onclick="deleteVideo(event, '${esc(video.id)}')" title="Delete your clip" style="font-size:0.85rem; padding:4px 10px;">delete</button>`
    : "";

  const urlDisplay = video.url ? video.url.replace(/^https?:\/\//, "").slice(0, 60) : "";
  const urlEllipsis = video.url && video.url.replace(/^https?:\/\//, "").length > 60 ? "..." : "";
  const urlHtml = video.url
    ? `<p style="margin-top:0.75rem;"><a href="${esc(video.url)}" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:0.3rem;">&#128279; ${esc(urlDisplay)}${urlEllipsis}</a></p>`
    : "";

  const hiddenLabel = video.hidden === 1 && moderator
    ? `<span class="mod-badge mod-badge-warn" style="margin-left:0.5rem;">HIDDEN</span>`
    : "";

  const body = `
    <div class="breadcrumb">
      <a href="/">Home</a> /
      <a href="${galleryUrl}">${esc(video.course_id)} / ${esc(video.assignment_id)}</a> /
      clip
    </div>
    ${playerEmbed}
    <div style="max-width:960px; margin:0 auto;">
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:1rem; flex-wrap:wrap;">
        <div>
          ${video.title ? `<h1 style="margin:0 0 0.25rem;">${esc(video.title)}${hiddenLabel}</h1>` : `<h1 style="margin:0 0 0.25rem; color:#888; font-style:italic;">Untitled clip${hiddenLabel}</h1>`}
          <div style="color:#888; font-size:0.9rem; display:flex; align-items:center; gap:0.5rem;">
            <img src="${esc(video.user_picture || "")}" style="width:22px; height:22px; border-radius:50%;" alt="">
            ${esc(video.user_name)} &middot; ${fmtDate(video.created_at)}${durationStr}
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:0.5rem;">
          ${starBtn}
          ${editBtn}
          ${deleteBtn}
        </div>
      </div>
      ${video.description ? `<p id="clip-desc" style="color:#aaa; margin-top:0.75rem;">${esc(video.description)}</p>` : ""}
      ${urlHtml}
      ${isOwner ? `
      <div id="edit-form" style="display:none; margin-top:1rem; background:#1a1a2e; border-radius:8px; padding:1.25rem;">
        <h3 style="margin:0 0 0.75rem;">Edit clip details</h3>
        <label style="display:block; margin:0.5rem 0 0.25rem; font-weight:500;">Link</label>
        <input type="text" id="edit-url" placeholder="https://" value="${esc(video.url)}" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem; box-sizing:border-box;">
        <label style="display:block; margin:0.5rem 0 0.25rem; font-weight:500;">Title</label>
        <input type="text" id="edit-title" placeholder="optional" value="${esc(video.title)}" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem; box-sizing:border-box;">
        <label style="display:block; margin:0.5rem 0 0.25rem; font-weight:500;">Description</label>
        <textarea id="edit-description" placeholder="optional" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem; resize:vertical; min-height:60px; box-sizing:border-box;">${esc(video.description)}</textarea>
        <div style="margin-top:0.75rem; display:flex; gap:0.75rem;">
          <button class="btn btn-primary" id="edit-save-btn" onclick="saveEdit()">Save</button>
          <button class="btn" onclick="closeEdit()" style="color:#888;">Cancel</button>
        </div>
      </div>
      ` : ""}
      <p style="margin-top:1.5rem;">
        <a href="${galleryUrl}" style="color:#6cb4ee;">&larr; Back to assignment gallery</a>
      </p>
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
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btn.disabled = false;
      }
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
        window.location.href = '${galleryUrl}';
      } catch (err) {
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.textContent = 'delete';
      }
    }

    function openEdit() {
      var form = document.getElementById('edit-form');
      if (form) form.style.display = 'block';
    }

    function closeEdit() {
      var form = document.getElementById('edit-form');
      if (form) form.style.display = 'none';
    }

    function saveEdit() {
      var title = document.getElementById('edit-title').value.trim();
      var desc = document.getElementById('edit-description').value.trim();
      var url = document.getElementById('edit-url').value.trim();
      var btn = document.getElementById('edit-save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      fetch('/api/update-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: '${esc(video.id)}', title: title, description: desc, url: url }),
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) { alert('Error: ' + data.error); return; }
          // Update the page in-place
          var h1 = document.querySelector('h1');
          if (h1) {
            var hidden = h1.querySelector('.mod-badge');
            var hiddenHtml = hidden ? hidden.outerHTML : '';
            if (title) {
              h1.innerHTML = title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + hiddenHtml;
              h1.style.color = '';
              h1.style.fontStyle = '';
            } else {
              h1.innerHTML = 'Untitled clip' + hiddenHtml;
              h1.style.color = '#888';
              h1.style.fontStyle = 'italic';
            }
          }
          var descEl = document.getElementById('clip-desc');
          if (desc) {
            if (descEl) {
              descEl.textContent = desc;
            } else {
              var editForm = document.getElementById('edit-form');
              if (editForm) {
                var p = document.createElement('p');
                p.id = 'clip-desc';
                p.style.color = '#aaa';
                p.style.marginTop = '0.75rem';
                p.textContent = desc;
                editForm.parentNode.insertBefore(p, editForm);
              }
            }
          } else if (descEl) {
            descEl.remove();
          }
          // Update URL link
          var urlContainer = document.querySelector('a[target="_blank"][rel="noopener"]');
          if (url) {
            var stripped = url.replace(/^https?:\\/\\//, '');
            var display = stripped.length > 60 ? stripped.slice(0, 60) + '...' : stripped;
            if (urlContainer) {
              urlContainer.href = url;
              urlContainer.innerHTML = '&#128279; ' + display.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            } else {
              var editForm = document.getElementById('edit-form');
              if (editForm) {
                var p = document.createElement('p');
                p.style.marginTop = '0.75rem';
                p.innerHTML = '<a href="' + url.replace(/&/g,'&amp;').replace(/"/g,'&quot;') + '" target="_blank" rel="noopener" style="display:inline-flex; align-items:center; gap:0.3rem;">&#128279; ' + display.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</a>';
                editForm.parentNode.insertBefore(p, editForm);
              }
            }
          } else if (urlContainer) {
            urlContainer.closest('p').remove();
          }
          closeEdit();
        })
        .catch(function(err) { alert('Error: ' + err.message); })
        .finally(function() { btn.disabled = false; btn.textContent = 'Save'; });
    }
    </script>`;

  return c.html(layout(video.title || "Clip", body, user));
});

// ─── Assignment Gallery ─────────────────────────────────────────

/** Assignment gallery: view all clips for a course/assignment, with upload link. */
pageRoutes.get("/:courseId{[0-9a-fA-F-]+}/:assignmentId{[0-9a-fA-F-]+}", async (c) => {
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

  const moderator = isModerator(c.env, user);

  const { results: videos } = await c.env.DB.prepare(
    `SELECT v.*, u.name as user_name, u.picture as user_picture, u.email as user_email,
            (SELECT COUNT(*) FROM stars s WHERE s.video_id = v.id) as star_count,
            EXISTS(SELECT 1 FROM stars s WHERE s.video_id = v.id AND s.user_id = ?) as user_starred
     FROM videos v JOIN users u ON v.user_id = u.id
     WHERE v.course_id = ? AND v.assignment_id = ? AND (v.hidden = 0 OR ?)
     ORDER BY v.created_at DESC`
  )
    .bind(user.sub, courseId, assignmentId, moderator ? 1 : 0)
    .all<VideoRow>();

  // Backfill duration for videos still processing.
  // Cap per page load to avoid unbounded Stream API calls + D1 writes
  // on a single GET request. The backlog self-heals across subsequent loads.
  const maxDurationChecksPerLoad = 10;
  const pending = videos.filter((v) => v.duration === null).slice(0, maxDurationChecksPerLoad);
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
  const hasOwnClip = videos.some((v) => v.user_id === user.sub);
  const cards = videos.length
    ? `<div class="card-grid">${videos
        .map((v) => videoCard(v, sd, user.sub, moderator))
        .join("")}</div>`
    : `<div class="empty-state">
        <p>No clips for this assignment yet.</p>
        <p>Be the first!</p>
      </div>`;

  const uploadLabel = hasOwnClip ? "Replace your clip" : "Upload a clip";
  const body = `
    <div class="breadcrumb">
      <a href="/">Home</a> / ${esc(courseId)} / ${esc(assignmentId)}
    </div>
    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:1rem;">
      <h1 style="margin:0;">Assignment ${esc(assignmentId)}</h1>
      <a href="/${esc(courseId)}/${esc(assignmentId)}/upload" class="btn btn-primary">${uploadLabel}</a>
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

// ─── Upload Page ────────────────────────────────────────────────

/** Upload page for a specific assignment. */
pageRoutes.get(
  "/:courseId{[0-9a-fA-F-]+}/:assignmentId{[0-9a-fA-F-]+}/upload",
  requireAuth,
  async (c) => {
    const courseId = c.req.param("courseId");
    const assignmentId = c.req.param("assignmentId");
    const user = c.var.user!;

    const galleryUrl = `/${esc(courseId)}/${esc(assignmentId)}`;

    // Check if student already has a clip for this assignment
    const existing = await c.env.DB.prepare(
      "SELECT id, title, description, url FROM videos WHERE user_id = ? AND course_id = ? AND assignment_id = ?"
    )
      .bind(user.sub, courseId, assignmentId)
      .first<{ id: string; title: string; description: string; url: string }>();

    const body = `
    <div class="breadcrumb">
      <a href="/">Home</a> /
      <a href="${galleryUrl}">${esc(courseId)} / ${esc(assignmentId)}</a> /
      upload
    </div>
    <h1>Upload a Clip</h1>
    <p style="color:#888;">Assignment ${esc(assignmentId)} in course ${esc(courseId)}</p>
    ${existing ? `<p style="color:#f7931a; font-size:0.9rem;">You already have a clip for this assignment. Uploading a new file will replace it.</p>` : ""}

    <div class="upload-form">
      <label for="file">Video file (.webm, .mp4 &mdash; max 500MB, 10 min)</label>
      <input type="file" id="file" name="file" accept="video/webm,video/mp4,video/*">

      <div id="progress-wrap">
        <div id="progress-bar"><div></div></div>
        <div id="progress-text">Uploading...</div>
      </div>

      <div id="metadata-section" style="display:none; margin-top:1.5rem; border-top:1px solid #2a2a4a; padding-top:1rem;">
        <p style="color:#888; font-size:0.85rem; margin:0 0 1rem;">Optional &mdash; you can always edit this later from the gallery.</p>

        <label for="url">Link <span style="color:#666; font-weight:normal;">(playable game, GitHub, etc.)</span></label>
        <input type="text" id="url" name="url" placeholder="https://">

        <label for="title">Title</label>
        <input type="text" id="title" name="title" placeholder="e.g. Player controller with wall jump">

        <label for="description">Description</label>
        <textarea id="description" name="description" placeholder="What are you showing off?"></textarea>

        <div style="margin-top:1.25rem; display:flex; gap:0.75rem; align-items:center;">
          <button class="btn btn-primary" id="save-btn" onclick="saveMetadata()" disabled>Save details</button>
          <a href="${galleryUrl}" id="skip-link" style="color:#888; font-size:0.85rem; display:none;">Skip &mdash; go to gallery</a>
          <span id="upload-pending-hint" style="color:#666; font-size:0.85rem;">Upload in progress...</span>
        </div>
      </div>
    </div>

    <div style="margin-top:2.5rem; border-top:1px solid #2a2a4a; padding-top:1.5rem;">
      <h2 style="font-size:1rem; color:#ccc; margin:0 0 0.5rem;">Upload from an external tool</h2>
      <p style="color:#888; font-size:0.85rem; margin:0 0 0.75rem;">
        Generate a temporary upload link you can paste into OBS, a Unity script,
        or any tool that can POST a video file. The link is tied to your account
        and this assignment, and expires in 24 hours.
      </p>
      <button class="btn btn-primary" id="gen-key-btn" onclick="generateKey()" style="font-size:0.85rem; padding:0.4rem 1rem;">Generate upload link</button>
      <div id="key-result" style="display:none; margin-top:0.75rem;">
        <div style="background:#111; border:1px solid #333; border-radius:6px; padding:0.5rem 0.75rem; display:flex; align-items:center; gap:0.5rem;">
          <code id="key-url" style="flex:1; word-break:break-all; color:#6cb4ee; font-size:0.8rem;"></code>
          <button onclick="copyText('key-url', this)" class="btn btn-primary" style="flex-shrink:0; font-size:0.75rem; padding:0.25rem 0.5rem;">Copy</button>
        </div>
        <details style="margin-top:0.75rem;">
          <summary style="color:#888; font-size:0.8rem; cursor:pointer;">Example: upload with curl</summary>
          <pre style="background:#111; border:1px solid #333; border-radius:6px; padding:0.5rem 0.75rem; font-size:0.75rem; color:#aaa; overflow-x:auto; margin-top:0.5rem;"><code id="key-curl-example"></code></pre>
        </details>
        <p style="color:#666; font-size:0.8rem; margin-top:0.5rem;">Expires in 24 hours. Uploading replaces any existing clip.</p>
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/tus-js-client@4/dist/tus.min.js"></script>
    <script>
    var videoId = null;
    var galleryUrl = '${galleryUrl}';
    var uploadDone = false;

    function copyText(elementId, btn) {
      var text = document.getElementById(elementId).textContent;
      navigator.clipboard.writeText(text).then(function() {
        var orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = orig; }, 1500);
      });
    }

    function generateKey() {
      var btn = document.getElementById('gen-key-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      fetch('/api/create-upload-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: '${esc(courseId)}', assignmentId: '${esc(assignmentId)}' }),
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) { alert('Error: ' + data.error); btn.disabled = false; btn.textContent = 'Generate upload link'; return; }
          document.getElementById('key-url').textContent = data.url;
          document.getElementById('key-curl-example').textContent =
            'curl -X POST -H "Content-Type: video/mp4" \\\n     --data-binary @your-video.mp4 \\\n     ' + data.url;
          document.getElementById('key-result').style.display = 'block';
          btn.textContent = 'Regenerate upload link';
          btn.disabled = false;
        })
        .catch(function(err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Generate upload link';
        });
    }

    var fileInput = document.getElementById('file');
    fileInput.addEventListener('change', function() {
      var file = fileInput.files[0];
      if (!file) return;
      if (file.size > 500 * 1024 * 1024) { alert('File too large (max 500MB).'); fileInput.value = ''; return; }
      startUpload(file);
    });

    function startUpload(file) {
      var progressWrap = document.getElementById('progress-wrap');
      var progressBar = document.getElementById('progress-bar').firstElementChild;
      var progressText = document.getElementById('progress-text');
      var metaSection = document.getElementById('metadata-section');

      fileInput.disabled = true;
      progressWrap.style.display = 'block';
      metaSection.style.display = 'block';

      var upload = new tus.Upload(file, {
        endpoint: '/api/tus-upload',
        chunkSize: 50 * 1024 * 1024,
        retryDelays: [0, 1000, 3000, 5000],
        metadata: {
          filename: file.name,
          filetype: file.type,
          courseId: '${esc(courseId)}',
          assignmentId: '${esc(assignmentId)}',
        },
        onError: function(err) {
          progressText.textContent = 'Upload failed: ' + err.message;
          fileInput.disabled = false;
        },
        onProgress: function(bytesUploaded, bytesTotal) {
          var pct = Math.round((bytesUploaded / bytesTotal) * 100);
          progressBar.style.width = pct + '%';
          var mb = (bytesUploaded / 1024 / 1024).toFixed(1);
          var total = (bytesTotal / 1024 / 1024).toFixed(1);
          progressText.textContent = 'Uploading... ' + mb + ' / ' + total + ' MB (' + pct + '%)';
        },
        onSuccess: function() {
          uploadDone = true;
          progressText.textContent = 'Upload complete!';
          progressBar.style.width = '100%';
          document.getElementById('save-btn').disabled = false;
          document.getElementById('skip-link').style.display = '';
          document.getElementById('upload-pending-hint').style.display = 'none';
          // Extract video ID from the upload URL
          var url = upload.url || '';
          var parts = url.split('/');
          videoId = parts[parts.length - 1] ? parts[parts.length - 1].split('?')[0] : null;
        },
      });

      upload.start();
    }

    function saveMetadata() {
      var title = document.getElementById('title').value.trim();
      var desc = document.getElementById('description').value.trim();
      var url = document.getElementById('url').value.trim();
      var btn = document.getElementById('save-btn');

      if (!title && !desc && !url) {
        window.location.href = galleryUrl;
        return;
      }

      if (!videoId) {
        if (!uploadDone) { alert('Upload still in progress — hang on!'); return; }
        // Video ID unknown but upload done; just go to gallery
        window.location.href = galleryUrl;
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Saving...';

      fetch('/api/update-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId: videoId, title: title, description: desc, url: url }),
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data.error) { alert('Error: ' + data.error); btn.disabled = false; btn.textContent = 'Save details'; return; }
          window.location.href = galleryUrl;
        })
        .catch(function(err) {
          alert('Error: ' + err.message);
          btn.disabled = false;
          btn.textContent = 'Save details';
        });
    }
    </script>`;

    return c.html(layout("Upload", body, user));
  }
);

// ─── 404 ────────────────────────────────────────────────────────

pageRoutes.notFound((c) => {
  const body = `
    <div class="empty-state">
      <h1>404</h1>
      <p>Page not found.</p>
      <p><a href="/">Go home</a></p>
    </div>`;
  return c.html(layout("Not Found", body, c.var.user), 404);
});
