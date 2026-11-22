import { loadPreloadedSession } from "./ingest.js";

const STAGES = [
  { label: "Receiving audio" },
  { label: "Transcribing" },
  { label: "Building insights" },
];

const FEED_TYPES = new Set([
  "page-created",
  "page-updated",
  "claim-not-checkable",
  "duplicate-merged",
]);

const TYPE_LABEL = {
  "page-updated": "Updated",
  "claim-not-checkable": "Skipped",
  "duplicate-merged": "Merged",
};

const SEEN_KEY = "cntxt_seen_processing_v1";
const SHEET_KEY = "cntxt_moments_open_v1";
const HOOK_MAX = 120;
const HEADLINE_MAX = 56;

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
const carouselCount = document.getElementById("carousel-count");
const momentsPeek = document.getElementById("moments-peek");
const momentsPanel = document.getElementById("moments-panel");
const btnBrowse = document.getElementById("btn-browse");
const btnCloseMoments = document.getElementById("btn-close-moments");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");

const { session, pages, timeline, meta } = await loadPreloadedSession();

const pageById = new Map(pages.map((page) => [page.id, page]));
const pageOrder = pages.map((p) => p.id);
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

function truncate(text, max) {
  const t = String(text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
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

function insightHeadline(page) {
  if (!page) return "Moment";
  const fact = page.facts?.[0]?.text;
  if (fact) return truncate(fact, HEADLINE_MAX);
  if (page.title) return truncate(page.title, HEADLINE_MAX);
  return truncate(page.currentClaim ?? "Moment", HEADLINE_MAX);
}

function spokenHook(page) {
  return truncate(page?.currentClaim ?? "", HOOK_MAX);
}

const title = session.ingest.title || "CNTXT session";
sessionTitle.textContent = title;
document.title = `CNTXT | ${title}`;
sessionMeta.textContent = `${durationLabel(session.ingest.durationMs)} · ${session.ingest.speakers.length} speakers · ${pages.length} insights`;

if (new URLSearchParams(location.search).has("debug")) {
  debugStrip.hidden = false;
  debugStrip.textContent = `${meta.pagesCreated} pages · ${meta.uniqueClaims} claims · research: ${meta.researcher}`;
}

const feedEvents = timeline.filter((event) => FEED_TYPES.has(event.type));
let filter = "all";
let selectedId = null;
const feedNodes = [];
let momentsOpen = false;

function setMomentsOpen(open) {
  momentsOpen = open;
  workspaceEl.classList.toggle("moments-open", open);
  btnBrowse.setAttribute("aria-expanded", String(open));
  if (window.matchMedia("(max-width: 820px)").matches) {
    momentsPanel.hidden = !open;
  } else {
    momentsPanel.hidden = false;
  }
  try {
    sessionStorage.setItem(SHEET_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function eventMatchesFilter(event) {
  return filter === "all" || event.type === filter;
}

function feedRowLabel(event, page) {
  if (page) return insightHeadline(page);
  if (event.claim) {
    const who = event.speaker ? `${event.speaker}: ` : "";
    return truncate(`${who}${event.claim}`, HEADLINE_MAX);
  }
  return truncate(event.detail || "Moment", HEADLINE_MAX);
}

function renderFeed() {
  const q = searchEl.value.trim().toLowerCase();
  feedEl.replaceChildren();
  feedNodes.length = 0;
  for (const event of feedEvents) {
    if (!eventMatchesFilter(event)) continue;
    const page = event.refId ? pageById.get(event.refId) : null;
    const hay = `${feedRowLabel(event, page)} ${page?.currentSpeaker ?? event.speaker ?? ""}`.toLowerCase();
    if (q && !hay.includes(q)) continue;

    const li = document.createElement("li");
    li.className = "moments-row";
    li.dataset.mediaMs = String(event.mediaMs ?? 0);
    li.dataset.refId = event.refId ?? "";
    const badge = TYPE_LABEL[event.type];
    const speaker = page?.currentSpeaker ?? event.speaker ?? "";
    li.innerHTML = `<time>${formatClock(event.mediaMs ?? 0)}</time>${
      badge ? `<span class="badge">${escapeHtml(badge)}</span>` : ""
    }${speaker ? `<span class="row-speaker">${escapeHtml(speaker)}</span>` : ""}<span class="row-label">${escapeHtml(
      feedRowLabel(event, page),
    )}</span>`;
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

function renderInsightHero(page) {
  const facts = (page.facts ?? []).map(
    (fact, i) => `<li class="fact-card">
        <p class="fact-card__text">${escapeHtml(fact.text)}</p>
        <a class="fact-card__source" href="${escapeHtml(fact.sourceUrl)}" rel="noopener noreferrer" target="_blank">Source</a>
      </li>`,
  );
  const factsBlock = facts.length
    ? `<ol class="facts-list" aria-label="Cited facts">${facts.join("")}</ol>`
    : `<p class="muted">No cited facts on this moment yet.</p>`;

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
    ? `<details class="transcript-disclosure"><summary>What was said</summary><ul>${claims}</ul></details>`
    : "";

  const hook = spokenHook(page);
  const hookBlock = hook ? `<p class="spoken-hook">"${escapeHtml(hook)}"</p>` : "";

  detailEl.innerHTML = `
    <p class="speaker">${escapeHtml(page.currentSpeaker ?? "Unknown speaker")} · ${formatClock(page.createdAtMs)}</p>
    <h3 class="sr-only">${escapeHtml(insightHeadline(page))}</h3>
    ${factsBlock}
    ${hookBlock}
    ${transcriptBlock}
    <a class="present-link" href="deck.html#${encodeURIComponent(page.id)}">Present this topic</a>
  `;
}

function updateCarouselChrome() {
  const idx = pageOrder.indexOf(selectedId);
  if (idx < 0) {
    carouselCount.textContent = "—";
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }
  carouselCount.textContent = `${idx + 1} of ${pageOrder.length}`;
  btnPrev.disabled = idx <= 0;
  btnNext.disabled = idx >= pageOrder.length - 1;
  const page = pageById.get(selectedId);
  const at = formatClock(page?.createdAtMs ?? 0);
  momentsPeek.textContent = `${pageOrder.length} moments · now at ${at}`;
}

function selectPage(pageId, seekAudio) {
  if (!pageId || !pageById.has(pageId)) return;
  selectedId = pageId;
  const page = pageById.get(pageId);
  renderInsightHero(page);

  for (const node of feedNodes) {
    node.classList.toggle("hot", node.dataset.refId === pageId);
  }
  if (seekAudio && audio && createdAt.has(pageId)) {
    audio.currentTime = createdAt.get(pageId) / 1000;
  }
  history.replaceState(null, "", `#${pageId}`);
  updateCarouselChrome();
}

function moveTopic(delta) {
  const idx = pageOrder.indexOf(selectedId);
  if (idx < 0) return;
  const next = pageOrder[idx + delta];
  if (next) selectPage(next, true);
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

btnBrowse.addEventListener("click", () => setMomentsOpen(!momentsOpen));
btnCloseMoments.addEventListener("click", () => setMomentsOpen(false));
btnPrev.addEventListener("click", () => moveTopic(-1));
btnNext.addEventListener("click", () => moveTopic(1));

function highlightByAudio(ms) {
  let hottest = null;
  for (const li of feedNodes) {
    const at = Number(li.dataset.mediaMs);
    if (at <= ms && (!hottest || at >= Number(hottest.dataset.mediaMs))) hottest = li;
  }
  for (const li of feedNodes) li.classList.toggle("hot", li === hottest);
  if (hottest?.dataset.refId && hottest.dataset.refId !== selectedId) {
    selectPage(hottest.dataset.refId, false);
  }
}

audio.addEventListener("timeupdate", () => highlightByAudio(audio.currentTime * 1000));
audio.addEventListener("seeked", () => highlightByAudio(audio.currentTime * 1000));

document.addEventListener("keydown", (event) => {
  if (event.target !== document.body && event.target !== detailEl) return;
  if (event.code === "Space") {
    event.preventDefault();
    if (audio.paused) audio.play();
    else audio.pause();
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveTopic(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    moveTopic(1);
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

function initMomentsPanel() {
  const desktop = window.matchMedia("(min-width: 821px)").matches;
  let stored = false;
  try {
    stored = sessionStorage.getItem(SHEET_KEY) === "1";
  } catch {
    stored = false;
  }
  setMomentsOpen(desktop || stored);
}

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
  initMomentsPanel();
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const firstPage = pages[0]?.id;
  selectPage(pageById.has(fromHash) ? fromHash : firstPage, false);
  processStatus.textContent = `${pages.length} insights ready`;
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

window.matchMedia("(max-width: 820px)").addEventListener("change", () => {
  if (!ready) return;
  if (window.matchMedia("(max-width: 820px)").matches && !momentsOpen) {
    momentsPanel.hidden = true;
  } else if (window.matchMedia("(min-width: 821px)").matches) {
    momentsPanel.hidden = false;
  }
});

await runProcessing();