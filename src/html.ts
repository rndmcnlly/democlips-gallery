// ─── HTML Helpers ───────────────────────────────────────────────
//
// Server-rendered HTML utilities: shared layout shell, escaping,
// formatting, video card component, and the player/edit overlay scripts.

import { User, VideoRow } from "./types";

export const SITE_NAME = "DemoClips";

export function layout(title: string, body: string, user: User | null = null): string {
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
  .hide-btn {
    background: none; border: 1px solid #555; color: #888; font-size: 0.75rem;
    padding: 2px 8px; border-radius: 4px; cursor: pointer; float: right;
    margin-right: 0.25rem;
  }
  .hide-btn:hover { border-color: #f59e0b; color: #f59e0b; }
  .card.hidden-card { opacity: 0.5; border-color: #e53e3e; }
  .card.hidden-card:hover { opacity: 0.75; }
  .hidden-label {
    position: absolute; top: 6px; left: 6px;
    background: #e53e3e; color: #fff; font-size: 0.7rem; font-weight: 700;
    padding: 1px 6px; border-radius: 3px; letter-spacing: 0.05em;
  }
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
  .share-link {
    font-size: 0.85rem; color: #555; text-decoration: none;
    padding: 2px 4px; border-radius: 4px;
    transition: color 0.15s;
  }
  .share-link:hover { color: #6cb4ee; text-decoration: none; }
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
  .mod-table {
    width: 100%; border-collapse: collapse; font-size: 0.9rem;
  }
  .mod-table th {
    text-align: left; padding: 0.5rem 0.75rem; border-bottom: 2px solid #2a2a4a;
    color: #888; font-weight: 600; font-size: 0.8rem; text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .mod-table td {
    padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a2e;
  }
  .mod-table tr:hover td { background: #1a1a2e; }
  .mod-table .course-header td {
    padding: 1rem 0.75rem 0.5rem; font-weight: 700; font-size: 1rem;
    color: #fff; border-bottom: 1px solid #2a2a4a; background: none;
  }
  .mod-badge {
    display: inline-block; font-size: 0.75rem; font-weight: 600;
    padding: 1px 6px; border-radius: 3px;
  }
  .mod-badge-warn { background: #e53e3e22; color: #e53e3e; }
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

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function videoCard(v: VideoRow, streamDomain: string, currentUserId?: string, moderator = false): string {
  const thumbAlt = v.title || v.user_name;
  const thumbTime = v.duration ? `&time=${(v.thumbnail_pct * v.duration).toFixed(1)}s` : "";
  const thumbImg = v.duration
    ? `<img src="https://customer-${streamDomain}.cloudflarestream.com/${v.id}/thumbnails/thumbnail.jpg?height=270${thumbTime}" alt="${esc(thumbAlt)}" loading="lazy">`
    : `<span class="processing">Processing...</span>`;
  const badge = v.duration
    ? `<span class="duration-badge">${fmtDuration(v.duration)}</span>`
    : "";
  const isOwner = currentUserId && v.user_id === currentUserId;
  const deleteBtn = isOwner
    ? `<button class="delete-btn" onclick="deleteVideo(event, '${esc(v.id)}')" title="Delete your clip">delete</button>`
    : "";
  const editBtn = isOwner
    ? `<button class="delete-btn" onclick="openEdit(event, '${esc(v.id)}', this)" title="Edit details" style="margin-right:0.25rem;">edit</button>`
    : "";
  const starredClass = v.user_starred ? " starred" : "";
  const starDisabled = isOwner ? " disabled" : "";
  const starBtn = currentUserId
    ? `<button class="star-btn${starredClass}"${starDisabled} onclick="starVideo(event, '${esc(v.id)}')" title="${isOwner ? "Can't star your own clip" : "Star this clip"}"><span class="star-icon"></span><span class="star-count">${v.star_count}</span></button>`
    : "";
  const isHidden = v.hidden === 1;
  const hideBtn = moderator
    ? `<button class="hide-btn" onclick="hideVideo(event, '${esc(v.id)}')" title="${isHidden ? "Unhide this clip" : "Hide this clip"}">${isHidden ? "unhide" : "hide"}</button>`
    : "";
  const hiddenClass = isHidden ? " hidden-card" : "";
  const hiddenLabel = isHidden && moderator ? `<span class="hidden-label">HIDDEN</span>` : "";

  // Title line: only show if non-empty
  const titleHtml = v.title
    ? `<div class="title">${hideBtn}${deleteBtn}${editBtn}${esc(v.title)}</div>`
    : `<div class="title">${hideBtn}${deleteBtn}${editBtn}</div>`;

  // URL link (shown below description if present)
  const urlDisplay = v.url ? v.url.replace(/^https?:\/\//, "").slice(0, 40) : "";
  const urlEllipsis = v.url && v.url.replace(/^https?:\/\//, "").length > 40 ? "..." : "";
  const urlHtml = v.url
    ? `<div style="margin-top:0.35rem;"><a href="${esc(v.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="font-size:0.8rem; display:inline-flex; align-items:center; gap:0.3rem;">&#128279; ${esc(urlDisplay)}${urlEllipsis}</a></div>`
    : "";

  return `<div class="card${hiddenClass}" id="card-${esc(v.id)}" data-star-count="${v.star_count}" data-created-at="${esc(v.created_at)}" data-title="${esc(v.title)}" data-description="${esc(v.description)}" data-url="${esc(v.url)}" ${v.duration ? `data-video-id="${esc(v.id)}" data-stream-domain="${esc(streamDomain)}" onclick="openPlayer(this)"` : ""} style="${v.duration ? "cursor:pointer" : ""}">
  <div class="thumb">${thumbImg}${badge}${hiddenLabel}</div>
  <div class="info">
    ${titleHtml}
    <div class="meta">
      <img src="${esc(v.user_picture || "")}" alt="">
      ${esc(v.user_name)} &middot; ${fmtDate(v.created_at)}
    </div>
    ${v.description ? `<div class="desc">${esc(v.description)}</div>` : ""}
    ${urlHtml}
    <div class="card-actions">${starBtn}<a href="/v/${esc(v.id)}" class="share-link" onclick="event.stopPropagation()" title="Shareable link to this clip">&#128279;</a></div>
  </div>
</div>`;
}

export function playerScript(): string {
  return `
<div class="player-overlay" id="player-overlay">
  <button class="close-btn" onclick="closePlayer()">&times;</button>
  <iframe id="player-iframe" allow="autoplay; fullscreen" allowfullscreen></iframe>
</div>
<div class="player-overlay" id="edit-overlay">
  <div style="background:#1a1a2e; border-radius:8px; padding:1.5rem; width:100%; max-width:420px; position:relative;">
    <button class="close-btn" onclick="closeEdit()" style="position:absolute; top:0.5rem; right:0.75rem; font-size:1.5rem;">&times;</button>
    <h2 style="margin:0 0 1rem;">Edit clip details</h2>
    <input type="hidden" id="edit-video-id">
    <label style="display:block; margin:0.75rem 0 0.25rem; font-weight:500;">Link</label>
    <input type="text" id="edit-url" placeholder="https://" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem;">
    <label style="display:block; margin:0.75rem 0 0.25rem; font-weight:500;">Title</label>
    <input type="text" id="edit-title" placeholder="optional" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem;">
    <label style="display:block; margin:0.75rem 0 0.25rem; font-weight:500;">Description</label>
    <textarea id="edit-description" placeholder="optional" style="width:100%; padding:0.5rem; border-radius:6px; border:1px solid #333; background:#0f0f0f; color:#e0e0e0; font-size:0.9rem; resize:vertical; min-height:60px;"></textarea>
    <div style="margin-top:1rem; display:flex; gap:0.75rem;">
      <button class="btn btn-primary" id="edit-save-btn" onclick="saveEdit()">Save</button>
      <button class="btn" onclick="closeEdit()" style="color:#888;">Cancel</button>
    </div>
  </div>
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

async function hideVideo(e, videoId) {
  e.stopPropagation();
  var btn = e.currentTarget;
  btn.disabled = true;
  try {
    var res = await fetch('/api/hide-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: videoId }),
    });
    if (!res.ok) {
      var err = await res.json();
      throw new Error(err.error || 'Hide failed');
    }
    var data = await res.json();
    var card = document.getElementById('card-' + videoId);
    if (card) {
      if (data.hidden) {
        card.classList.add('hidden-card');
      } else {
        card.classList.remove('hidden-card');
      }
    }
    btn.textContent = data.hidden ? 'unhide' : 'hide';
    btn.title = data.hidden ? 'Unhide this clip' : 'Hide this clip';
    var label = card ? card.querySelector('.hidden-label') : null;
    if (data.hidden && !label && card) {
      var thumb = card.querySelector('.thumb');
      if (thumb) {
        var span = document.createElement('span');
        span.className = 'hidden-label';
        span.textContent = 'HIDDEN';
        thumb.appendChild(span);
      }
    } else if (!data.hidden && label) {
      label.remove();
    }
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

function openEdit(e, videoId, btn) {
  e.stopPropagation();
  var card = document.getElementById('card-' + videoId);
  if (!card) return;
  document.getElementById('edit-video-id').value = videoId;
  document.getElementById('edit-title').value = card.dataset.title || '';
  document.getElementById('edit-description').value = card.dataset.description || '';
  document.getElementById('edit-url').value = card.dataset.url || '';
  document.getElementById('edit-overlay').classList.add('active');
}

function closeEdit() {
  document.getElementById('edit-overlay').classList.remove('active');
}

function saveEdit() {
  var videoId = document.getElementById('edit-video-id').value;
  var title = document.getElementById('edit-title').value.trim();
  var desc = document.getElementById('edit-description').value.trim();
  var url = document.getElementById('edit-url').value.trim();
  var btn = document.getElementById('edit-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  fetch('/api/update-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId: videoId, title: title, description: desc, url: url }),
  })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) { alert('Error: ' + data.error); btn.disabled = false; btn.textContent = 'Save'; return; }
      // Update the card in-place
      var card = document.getElementById('card-' + videoId);
      if (card) {
        card.dataset.title = title;
        card.dataset.description = desc;
        card.dataset.url = url;
        var titleEl = card.querySelector('.title');
        if (titleEl) {
          // Preserve action buttons, update text
          var buttons = titleEl.querySelectorAll('button');
          var btnHtml = '';
          for (var i = 0; i < buttons.length; i++) btnHtml += buttons[i].outerHTML;
          titleEl.innerHTML = btnHtml + (title ? title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '');
        }
        var descEl = card.querySelector('.desc');
        if (desc) {
          if (descEl) { descEl.textContent = desc; }
          else {
            var meta = card.querySelector('.meta');
            if (meta) {
              var d = document.createElement('div');
              d.className = 'desc';
              d.textContent = desc;
              meta.insertAdjacentElement('afterend', d);
            }
          }
        } else if (descEl) {
          descEl.remove();
        }
      }
      closeEdit();
    })
    .catch(function(err) { alert('Error: ' + err.message); })
    .finally(function() { btn.disabled = false; btn.textContent = 'Save'; });
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
  if (e.key === 'Escape') { closePlayer(); closeEdit(); }
});
document.getElementById('player-overlay').addEventListener('click', function(e) {
  if (e.target === this) closePlayer();
});
document.getElementById('edit-overlay').addEventListener('click', function(e) {
  if (e.target === this) closeEdit();
});
</script>`;
}
