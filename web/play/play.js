import { loadPreloadedSession, startDeferredIngest } from "./ingest.js";

const STAGES = [
  { id: "receive", label: "Receiving recording" },
  { id: "transcribe", label: "Transcribing speakers" },
  { id: "claims", label: "Extracting claims" },
  { id: "topics", label: "Grouping topics" },
  { id: "cite", label: "Citing checkable claims" },
  { id: "pages", label: "Building topic pages" },
];

const FEED_TYPES = new Set([
  "page-created",
  "page-updated",
  "claim-not-checkable",
  "duplicate-merged",
]);

const audio = document.getElementById("audio");
const feedEl = document.getElementById("feed");
const topicsEl = document.getElementById("topics");
const detailEl = document.getElementById("topic-detail");
const metaStrip = document.getElementById("meta-strip");
const fileNameEl = document.getElementById("file-name");
const fileMetaEl = document.getElementById("file-meta");
const ingestNote = document.getElementById("ingest-note");
const stepsEl = document.getElementById("steps");
const processStatus = document.getElementById("process-status");
const processingEl = document.getElementById("processing");
const workspaceEl = document.getElementById("workspace");
const researchNote = document.getElementById("research-note");
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

fileNameEl.textContent = session.ingest.filename;
fileMetaEl.textContent = `${durationLabel(session.ingest.durationMs)} · ${session.ingest.speakers.length} speakers · Public domain`;
metaStrip.textContent = `${meta.pagesCreated} pages · ${meta.uniqueClaims} unique claims · research: ${meta.researcher} (${meta.researchRequests} Tavily calls)`;
researchNote.textContent = `Research mode: ${meta.researcher}. Tavily requests: ${meta.researchRequests}.`;

function bindDeferred(button, kind) {
  button.addEventListener("click", () => {
    const result = startDeferredIngest(kind);
    ingestNote.textContent = result.message;
  });
}
bindDeferred(document.getElementById("btn-upload"), "file-upload");
bindDeferred(document.getElementById("btn-mic"), "microphone");

const feedEvents = timeline.filter((event) => FEED_TYPES.has(event.type));
let filter = "page-created";
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
    const verb = event.type === "page-created" ? "Page" : "Update";
    return `${verb}: ${pageById.get(event.refId).currentClaim}`;
  }
  if (event.claim) {
    const who = event.speaker ? `${event.speaker}: ` : "";
    return `${who}${event.claim}`;
  }
  return event.detail;
}

function renderFeed() {
  feedEl.replaceChildren();
  feedNodes.length = 0;
  for (const event of feedEvents) {
    if (!eventMatchesFilter(event)) continue;
    const li = document.createElement("li");
    li.dataset.mediaMs = String(event.mediaMs ?? 0);
    li.dataset.refId = event.refId ?? "";
    li.dataset.type = event.type;
    li.innerHTML = `<time>${formatClock(event.mediaMs ?? 0)}</time><span class="stage">${escapeHtml(event.type)}</span> ${escapeHtml(eventLabel(event))}`;
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

function pageCardLabel(page) {
  const speaker = page.currentSpeaker ? `${page.currentSpeaker} · ` : "";
  const facts = page.facts?.length ?? 0;
  return `${speaker}${facts} cited fact${facts === 1 ? "" : "s"}`;
}

function renderTopics(query) {
  const q = (query ?? "").trim().toLowerCase();
  topicsEl.replaceChildren();
  for (const page of pages) {
    const hay = `${page.currentClaim} ${page.currentSpeaker ?? ""} ${page.title}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "topic-card";
    if (page.id === selectedId) btn.classList.add("is-on");
    btn.dataset.pageId = page.id;
    btn.innerHTML = `<h3>${escapeHtml(page.currentClaim || page.title)}</h3><p>${escapeHtml(pageCardLabel(page))}</p>`;
    btn.addEventListener("click", () => selectPage(page.id, false));
    topicsEl.appendChild(btn);
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
    .slice(0, 6)
    .map(
      (item) =>
        `<li><time>${formatClock(item.startMs)}</time> ${
          item.speaker ? `<strong>${escapeHtml(item.speaker)}:</strong> ` : ""
        }${escapeHtml(item.text)}</li>`,
    )
    .join("");
  detailEl.innerHTML = `
    <p class="speaker">${escapeHtml(page.currentSpeaker ?? "Unknown speaker")} · ${formatClock(page.createdAtMs)}</p>
    <h3>${escapeHtml(page.currentClaim || page.title)}</h3>
    <h4>Cited facts</h4>
    <ul class="facts">${facts || "<li>No cited facts on this page.</li>"}</ul>
    ${claims ? `<h4>Claims on this topic</h4><ul>${claims}</ul>` : ""}
    <p class="panel-note"><a href="/contxt/play/deck.html#${encodeURIComponent(page.id)}">Open in deck</a></p>
  `;
  for (const node of feedNodes) {
    node.classList.toggle("hot", node.dataset.refId === pageId);
  }
  for (const card of topicsEl.querySelectorAll(".topic-card")) {
    card.classList.toggle("is-on", card.dataset.pageId === pageId);
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

searchEl.addEventListener("input", () => renderTopics(searchEl.value));

function highlightByAudio(ms) {
  let hottest = null;
  for (const li of feedNodes) {
    const at = Number(li.dataset.mediaMs);
    if (at <= ms && (!hottest || at >= Number(hottest.dataset.mediaMs))) hottest = li;
  }
  for (const li of feedNodes) li.classList.toggle("hot", li === hottest);
  if (hottest?.dataset.refId) {
    selectedId = hottest.dataset.refId;
    for (const card of topicsEl.querySelectorAll(".topic-card")) {
      card.classList.toggle("is-on", card.dataset.pageId === selectedId);
    }
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
  processingEl.classList.add("is-done");
  processingEl.setAttribute("aria-hidden", "true");
  workspaceEl.hidden = false;
  renderFeed();
  renderTopics(searchEl.value);
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const firstPage = pages[0]?.id;
  selectPage(pageById.has(fromHash) ? fromHash : firstPage, false);
  processStatus.textContent = `Ready · ${pages.length} cited topics`;
}

async function runProcessing() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const skip = new URLSearchParams(location.search).has("ready") || reduce;
  renderSteps(0);
  if (skip) {
    renderSteps(STAGES.length);
    showReady();
    return;
  }
  let skipped = false;
  document.getElementById("btn-skip").addEventListener("click", () => {
    skipped = true;
    showReady();
  });
  for (let i = 0; i < STAGES.length; i += 1) {
    if (skipped) return;
    renderSteps(i);
    processStatus.textContent = `${STAGES[i].label}…`;
    await new Promise((resolve) => setTimeout(resolve, 380));
  }
  if (!skipped) {
    renderSteps(STAGES.length);
    showReady();
  }
}

await runProcessing();
