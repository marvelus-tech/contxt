import { loadPreloadedSession } from "./ingest.js";

const STAGES = [
  { label: "Receiving audio" },
  { label: "Transcribing" },
  { label: "Building topics" },
];

const FEED_TYPES = new Set([
  "page-created",
  "page-updated",
  "claim-not-checkable",
  "duplicate-merged",
]);

const TYPE_LABEL = {
  "page-created": "New topic",
  "page-updated": "Updated",
  "claim-not-checkable": "Skipped",
  "duplicate-merged": "Merged",
};

const SEEN_KEY = "cntxt_seen_processing_v1";

const audio = document.getElementById("audio");
const feedEl = document.getElementById("feed");
const detailEl = document.getElementById("topic-detail");
const sessionTitle = document.getElementById("session-title");
const sessionMeta = document.getElementById("session-meta");
const debugStrip = document.getElementById("debug-strip");
const stepsEl = document.getElementById("steps");
const processStatus = document.getElementById("process-status");
const processingEl = document.getElementById("processing");
const workspaceEl = document.getElementById("workspace");
const transportEl = document.getElementById("transport");
const searchEl = document.getElementById("topic-search");

const { session, pages, timeline, meta } = await loadPreloadedSession();

const pageById = new Map(pages.map((page) => [page.id, page]));
const createdAt = new Map();
for (const event of timeline) {
  if (event.type === "page-created" && event.refId && !createdAt.has(event.refId)) {
    createdAt.set(event.refId, event.mediaMs ?? 0);
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function durationLabel(ms) {
  const total = Math.round(Number(ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes} min ${String(seconds).padStart(2, "0")} sec`;
}

const title = session.ingest.title || "CNTXT session";
sessionTitle.textContent = title;
document.title = `CNTXT | ${title}`;
sessionMeta.textContent = `${durationLabel(session.ingest.durationMs)} · ${session.ingest.speakers.length} speakers · ${pages.length} topics`;

if (new URLSearchParams(location.search).has("debug")) {
  debugStrip.hidden = false;
  debugStrip.textContent = `${meta.pagesCreated} pages · ${meta.uniqueClaims} claims · research: ${meta.researcher}`;
}

const feedEvents = timeline.filter((event) => FEED_TYPES.has(event.type));
let filter = "all";
let selectedId = null;
const feedNodes = [];

function eventMatchesFilter(event) {
  return filter === "all" || event.type === filter;
}

function eventLabel(event) {
  if (
    (event.type === "page-created" || event.type === "page-updated") &&
    event.refId &&
    pageById.get(event.refId)?.currentClaim
  ) {
    return pageById.get(event.refId).currentClaim;
  }
  if (event.claim) {
    const who = event.speaker ? `${event.speaker}: ` : "";
    return `${who}${event.claim}`;
  }
  return event.detail || "";
}

function renderFeed() {
  const q = searchEl.value.trim().toLowerCase();
  feedEl.replaceChildren();
  feedNodes.length = 0;
  for (const event of feedEvents) {
    if (!eventMatchesFilter(event)) continue;
    const page = event.refId ? pageById.get(event.refId) : null;
    const hay = `${eventLabel(event)} ${page?.currentSpeaker ?? ""}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    const li = document.createElement("li");
    li.dataset.mediaMs = String(event.mediaMs ?? 0);
    li.dataset.refId = event.refId ?? "";
    const badge = TYPE_LABEL[event.type] ?? "";
    li.innerHTML = `<time>${formatClock(event.mediaMs ?? 0)}</time>${
      badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ""
    }<span>${escapeHtml(eventLabel(event))}</span>`;
    li.tabIndex = 0;
    li.addEventListener("click", () => selectPage(event.refId, true));
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectPage(event.refId, true);
      }
    });
    feedEl.appendChild(li);
    feedNodes.push(li);
  }
}

function selectPage(pageId, seekAudio) {
  if (!pageId || !pageById.has(pageId)) return;
  selectedId = pageId;
  const page = pageById.get(pageId);
  const facts = (page.facts ?? [])
    .map(
      (fact) =>
        `<li>${escapeHtml(fact.text)} <a href="${escapeHtml(fact.sourceUrl)}" rel="noopener noreferrer" target="_blank">Source</a></li>`,
    )
    .join("");
  const claims = (page.claims ?? [])
    .slice(0, 12)
    .map(
      (item) =>
        `<li><time>${formatClock(item.startMs)}</time> ${
          item.speaker ? `<strong>${escapeHtml(item.speaker)}:</strong> ` : ""
        }${escapeHtml(item.text)}</li>`,
    )
    .join("");

  const transcriptBlock = claims
    ? `<details><summary>Transcript on this topic</summary><ul>${claims}</ul></details>`
    : "";

  detailEl.innerHTML = `
    <p class="speaker">${escapeHtml(page.currentSpeaker ?? "Unknown speaker")} · ${formatClock(page.createdAtMs)}</p>
    <h3>${escapeHtml(page.currentClaim || page.title)}</h3>
    <h4>Cited facts</h4>
    <ul class="facts">${facts || "<li>No cited facts on this page.</li>"}</ul>
    ${transcriptBlock}
    <a class="present-link" href="deck.html#${encodeURIComponent(page.id)}">Present this topic</a>
  `;

  for (const node of feedNodes) {
    node.classList.toggle("hot", node.dataset.refId === pageId);
  }
  if (seekAudio && audio && createdAt.has(pageId)) {
    audio.currentTime = createdAt.get(pageId) / 1000;
  }
  history.replaceState(null, "", `#${pageId}`);
}

for (const chip of document.querySelectorAll("[data-filter]")) {
  chip.addEventListener("click", () => {
    filter = chip.dataset.filter;
    for (const other of document.querySelectorAll("[data-filter]")) {
      other.classList.toggle("is-on", other === chip);
    }
    renderFeed();
    if (selectedId) selectPage(selectedId, false);
  });
}

searchEl.addEventListener("input", () => renderFeed());

function highlightByAudio(ms) {
  let hottest = null;
  for (const li of feedNodes) {
    const at = Number(li.dataset.mediaMs);
    if (at <= ms && (!hottest || at >= Number(hottest.dataset.mediaMs))) hottest = li;
  }
  for (const li of feedNodes) li.classList.toggle("hot", li === hottest);
  if (hottest?.dataset.refId) {
    selectedId = hottest.dataset.refId;
  }
}

audio.addEventListener("timeupdate", () => highlightByAudio(audio.currentTime * 1000));
audio.addEventListener("seeked", () => highlightByAudio(audio.currentTime * 1000));

document.addEventListener("keydown", (event) => {
  if (event.code === "Space" && event.target === document.body) {
    event.preventDefault();
    if (audio.paused) audio.play();
    else audio.pause();
  }
});

function renderSteps(activeIndex) {
  stepsEl.replaceChildren();
  STAGES.forEach((stage, index) => {
    const li = document.createElement("li");
    li.textContent = stage.label;
    if (index === activeIndex) li.classList.add("is-on");
    if (index < activeIndex) li.classList.add("is-done");
    stepsEl.appendChild(li);
  });
}

let ready = false;

function showReady() {
  if (ready) return;
  ready = true;
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
  processingEl.classList.add("is-done");
  processingEl.setAttribute("aria-hidden", "true");
  workspaceEl.hidden = false;
  transportEl.hidden = false;
  renderFeed();
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const firstPage = pages[0]?.id;
  selectPage(pageById.has(fromHash) ? fromHash : firstPage, false);
  processStatus.textContent = `${pages.length} topics ready`;
}

async function runProcessing() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let seen = false;
  try {
    seen = localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    seen = false;
  }
  const skip = new URLSearchParams(location.search).has("ready") || reduce || seen;

  if (skip) {
    renderSteps(STAGES.length);
    showReady();
    return;
  }

  renderSteps(0);
  let skipped = false;
  document.getElementById("btn-skip").addEventListener("click", () => {
    skipped = true;
    showReady();
  });

  for (let i = 0; i < STAGES.length; i += 1) {
    if (skipped) return;
    renderSteps(i);
    processStatus.textContent = `${STAGES[i].label}…`;
    await new Promise((resolve) => setTimeout(resolve, 420));
  }
  if (!skipped) {
    renderSteps(STAGES.length);
    showReady();
  }
}

await runProcessing();