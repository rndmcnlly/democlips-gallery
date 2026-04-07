// Demo Clip Recorder -- scripts.democlips.dev
//
// Records a specific page element using getDisplayMedia + CropTarget.
// Saves a .webm file locally, or uploads directly to a DemoClips gallery
// if data-upload-url is provided.
//
// Usage:
//   <script type="module"
//           src="https://scripts.democlips.dev/demo-clip-recorder.mjs"
//           data-clip-root="YOUR_ELEMENT_ID"
//           data-upload-url="https://gallery.democlips.dev/k/TOKEN"></script>
//
// Attributes:
//   data-clip-root    (required) id of the element to record
//   data-upload-url   (optional) upload key URL; POST the recording here
//                     instead of saving locally

// ── Read configuration from the script tag ──────────────────────
//
// In an ES module, document.currentScript is null. We recover the
// <script> element by matching its src against import.meta.url.

const scriptEl = document.querySelector(`script[src="${import.meta.url}"]`);
if (!scriptEl) {
  console.error("Demo Clip Recorder: could not find own <script> element.");
}
const clipRootId = (scriptEl?.dataset.clipRoot || "").trim();
const uploadUrl = (scriptEl?.dataset.uploadUrl || "").trim();

// ── Recording state ─────────────────────────────────────────────

let mediaRecorder = null;
let recordedChunks = null;
let captureStream = null;

// ── Shared dialog helpers ───────────────────────────────────────
// Declared here (before use) because const is not hoisted like function.

const CODE_STYLE = "background:#004d87; padding:1px 4px; border-radius:3px;";

// ── Determine which dialog to show ──────────────────────────────

let dialog;
if (!clipRootId) {
  dialog = missingAttrDialog();
} else if (!document.getElementById(clipRootId)) {
  dialog = elementNotFoundDialog(clipRootId);
} else {
  dialog = recordingDialog();
}
dialog.showModal();

// ── Recording logic ─────────────────────────────────────────────

async function startClip() {
  if (mediaRecorder || recordedChunks) return;
  try {
    captureStream = await getStream();
  } catch (err) {
    console.error("Demo Clip Recorder: failed to start capture", err);
    return;
  }
  mediaRecorder = new MediaRecorder(captureStream, { mimeType: "video/webm" });
  recordedChunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    captureStream.getTracks().forEach((t) => t.stop());
    saveRecording();
    mediaRecorder = null;
    recordedChunks = null;
  };
  mediaRecorder.start();
}

async function getStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    preferCurrentTab: true,
    audio: true,
  });
  const videoTrack = stream.getVideoTracks()[0];
  const target = document.getElementById(clipRootId);
  const cropTarget = await CropTarget.fromElement(target);
  await videoTrack.cropTo(cropTarget);
  return stream;
}

function saveRecording() {
  const blob = new Blob(recordedChunks, { type: "video/webm" });
  if (uploadUrl) {
    uploadRecording(blob);
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demo-clip.webm";
    a.click();
  }
}

async function uploadRecording(blob) {
  const d = styledDialog();

  const status = document.createElement("p");
  status.style.margin = "0";
  status.textContent = "Uploading recording...";
  d.box.appendChild(status);

  d.dialog.showModal();

  try {
    const res = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "video/webm" },
      body: blob,
    });

    if (!res.ok) {
      let msg = `Server returned ${res.status}`;
      try {
        const data = await res.json();
        if (data.error) msg = data.error;
      } catch { /* ignore parse errors */ }
      throw new Error(msg);
    }

    status.textContent = "Upload complete!";
    status.style.color = "#7bed9f";
  } catch (err) {
    status.textContent = `Upload failed: ${err.message}`;
    status.style.color = "#ff6b6b";
  }

  const saveLocal = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "demo-clip.webm";
    a.click();
  };

  d.box.appendChild(makeButton("Save file locally", () => { saveLocal(); }));
  d.box.appendChild(makeButton("Close", () => d.dialog.close()));
}

// ── Shared dialog helpers (continued) ────────────────────────────

function styledDialog() {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "border:none; border-radius:10px; padding:0; background:transparent;";

  const box = document.createElement("div");
  box.style.cssText = `
    max-width:480px; background:#003c6b; color:#fac500;
    padding:24px 28px; border-radius:10px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    font-size:15px; line-height:1.5;
  `.replace(/\n\s*/g, " ");

  const h1 = document.createElement("h1");
  h1.textContent = "Demo Clip Recorder";
  h1.style.cssText = "margin:0 0 12px; font-size:20px;";
  box.appendChild(h1);

  dialog.appendChild(box);
  document.body.prepend(dialog);
  return { dialog, box };
}

function makeButton(label, onclick) {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.style.cssText = `
    font-size:16px; padding:8px 20px; margin:4px 8px 4px 0;
    border-radius:6px; border:2px solid #fac500;
    background:transparent; color:#fac500; cursor:pointer;
  `.replace(/\n\s*/g, " ");
  btn.onmouseover = () => { btn.style.background = "#fac500"; btn.style.color = "#003c6b"; };
  btn.onmouseout = () => { btn.style.background = "transparent"; btn.style.color = "#fac500"; };
  btn.onclick = onclick;
  return btn;
}

function removalHint() {
  const p = document.createElement("p");
  p.style.cssText = "margin:16px 0 0; font-size:12px; color:#8cb8d8; line-height:1.4;";
  p.innerHTML = `This dialog appears because your page includes the
    <code style="${CODE_STYLE}">demo-clip-recorder.mjs</code> script.
    Remove the <code style="${CODE_STYLE}">&lt;script&gt;</code> tag
    when you no longer need to record clips.`;
  return p;
}

// ── Dialog: missing data-clip-root attribute ────────────────────

function missingAttrDialog() {
  const d = styledDialog();

  const p1 = document.createElement("p");
  p1.style.margin = "0 0 12px";
  p1.innerHTML = `The <code style="${CODE_STYLE}">data-clip-root</code>
    attribute is missing. This attribute tells the recorder which element
    to capture.`;
  d.box.appendChild(p1);

  const p2 = document.createElement("p");
  p2.style.margin = "0 0 16px";
  p2.innerHTML = `Add it to your script tag like this:<br>
    <code style="${CODE_STYLE} display:inline-block; margin-top:6px; font-size:13px;">data-clip-root="myCanvas"</code>`;
  d.box.appendChild(p2);

  d.box.appendChild(makeButton("OK", () => d.dialog.close()));
  d.box.appendChild(removalHint());
  return d.dialog;
}

// ── Dialog: element not found by id ─────────────────────────────

function elementNotFoundDialog(id) {
  const d = styledDialog();

  const p1 = document.createElement("p");
  p1.style.margin = "0 0 12px";
  p1.innerHTML = `Could not find an element with
    <code style="${CODE_STYLE}">id="${id}"</code> on this page.`;
  d.box.appendChild(p1);

  const p2 = document.createElement("p");
  p2.style.margin = "0 0 8px";
  p2.textContent = "Check that:";
  d.box.appendChild(p2);

  const ul = document.createElement("ul");
  ul.style.cssText = "margin:0 0 16px; padding-left:20px;";
  for (const text of [
    "The element exists in your HTML",
    `The id="${id}" attribute is spelled exactly right`,
    "The <script> tag appears after the element in your HTML (or at the end of <body>)",
  ]) {
    const li = document.createElement("li");
    li.style.margin = "4px 0";
    li.textContent = text;
    ul.appendChild(li);
  }
  d.box.appendChild(ul);

  d.box.appendChild(makeButton("OK", () => d.dialog.close()));
  d.box.appendChild(removalHint());
  return d.dialog;
}

// ── Dialog: ready to record ─────────────────────────────────────

function recordingDialog() {
  const d = styledDialog();

  const p = document.createElement("p");
  p.style.margin = "0 0 16px";
  const destination = uploadUrl
    ? "uploaded to the gallery"
    : "saved as a local file";
  p.innerHTML = `Ready to record
    <code style="${CODE_STYLE}">#${clipRootId}</code>.
    Your browser will ask you to share your screen. The recording
    will be cropped to just that element and ${destination}.`;
  d.box.appendChild(p);

  const btnDiv = document.createElement("div");
  btnDiv.appendChild(makeButton("Start Recording", () => {
    d.dialog.close();
    startClip();
  }));
  btnDiv.appendChild(makeButton("Cancel", () => {
    d.dialog.close();
  }));
  d.box.appendChild(btnDiv);

  d.box.appendChild(removalHint());
  return d.dialog;
}
