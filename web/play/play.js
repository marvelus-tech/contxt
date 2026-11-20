import { loadPreloadedSession, startDeferredIngest } from "./ingest.js";
import { bindMicrophone } from "./mic.js";

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
const ingestNote = document.getElementById("ingest-note");
const stepsEl = document.getElementById("steps");
const processStatus = document.getElementById("process-status");
const processingEl = document.getElementById("processing");
const workspaceEl = document.getElementById("workspace");
const researchNote = document.getElementById("research-note");
const searchEl = document.getElementById("topic-search");
const playerEl = document.getElementById("debate-player");
const partialEl = document.getElementById("partial");
const heardLive = document.getElementById("heard-live");
const transcriptEl = document.getElementById("transcript");
const meterEl = document.getElementById("mic-meter");
const statusEl = document.getElementById("mic-status");

let pages = [];
let timeline = [];
let pageById = new Map();
let feedEvents = [];
let filter = "page-created";
let selectedId = null;
const feedNodes = [];
const createdAt = new Map();
let debateAudio = false;

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
  const visible = feedEvents.filter(eventMatchesFilter);
  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "Cited topics land here after a checkable sentence.";
    feedEl.appendChild(empty);
    return;
  }
  for (const event of visible) {
    const li = document.createElement("li");
    li.dataset.mediaMs = String(event.mediaMs ?? 0);
    li.dataset.refId = event.refId ?? "";
    li.dataset.type = event.type;
    li.innerHTML = `<time>${formatClock(event.mediaMs ?? 0)}</time><span class="stage">${escapeHtml(event.type)}</span> ${escapeHtml(eventLabel(event))}`;
    li.tabIndex = 0;
    li.addEventListener("click", () => selectPage(event.refId, debateAudio));
    li.addEventListener("keydown", (eventKey) => {
      if (eventKey.key === "Enter" || eventKey.key === " ") {
        eventKey.preventDefault();
        selectPage(event.refId, debateAudio);
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
  const matched = pages.filter((page) => {
    const hay = `${page.currentClaim} ${page.currentSpeaker ?? ""} ${page.title}`.toLowerCase();
    return !q || hay.includes(q);
  });
  if (matched.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No cited topics yet.";
    topicsEl.appendChild(empty);
    return;
  }
  for (const page of matched) {
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

function selectPage(pageId, seekAudio, writeHash = true) {
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
    <p class="speaker">${escapeHtml(page.currentSpeaker ?? "Speaker")} · ${formatClock(page.updatedAtMs ?? page.createdAtMs)}</p>
    <h3>${escapeHtml(page.currentClaim || page.title)}</h3>
    <h4>Cited facts</h4>
    <ul class="facts">${facts || "<li>No cited facts on this page yet.</li>"}</ul>
    ${claims ? `<h4>Claims on this topic</h4><ul>${claims}</ul>` : ""}
    <p class="panel-note"><a href="/contxt/play/deck.html#${encodeURIComponent(page.id)}">Open in deck</a></p>
  `;
  for (const node of feedNodes) node.classList.toggle("hot", node.dataset.refId === pageId);
  for (const card of topicsEl.querySelectorAll(".topic-card")) {
    card.classList.toggle("is-on", card.dataset.pageId === pageId);
  }
  if (seekAudio && audio && createdAt.has(pageId)) audio.currentTime = createdAt.get(pageId) / 1000;
  if (writeHash) history.replaceState(null, "", `#${pageId}`);
}

function replaceSession(nextPages, nextTimeline) {
  pages = nextPages;
  timeline = nextTimeline;
  pageById = new Map(pages.map((page) => [page.id, page]));
  feedEvents = timeline.filter((event) => FEED_TYPES.has(event.type));
  createdAt.clear();
  for (const event of timeline) {
    if (event.type === "page-created" && event.refId && !createdAt.has(event.refId)) {
      createdAt.set(event.refId, event.mediaMs ?? 0);
    }
  }
  renderFeed();
  renderTopics(searchEl.value);
}

function applySnapshot(snapshot) {
  replaceSession(snapshot.pages, snapshot.timeline);
  const newest = [...snapshot.timeline].reverse().find(
    (event) => event.type === "page-created" || event.type === "page-updated",
  );
  if (newest?.refId) selectPage(newest.refId, false, false);
  researchNote.textContent = `Research mode: wikipedia. Lookups: ${snapshot.researchRequests}. Tavily requests: 0.`;
  metaStrip.textContent = `${snapshot.pagesCreated} live pages · ${snapshot.pagesUpdated} updates`;
  workspaceEl.hidden = false;
}

const mic = bindMicrophone({
  button: document.getElementById("btn-mic"),
  label: document.getElementById("mic-label"),
  onPhase(notice) {
    statusEl.textContent = notice.message;
    const failed = ["denied", "no-device", "insecure", "token-missing", "token-error", "error"].includes(notice.phase);
    statusEl.classList.toggle("is-bad", failed);
    if (failed) partialEl.textContent = "";
    if (notice.phase === "requesting-permission") {
      transcriptEl.replaceChildren();
      partialEl.textContent = "Waiting for speech.";
      heardLive.textContent = "";
      meterEl.style.width = "0";
    }
  },
  onPartial(text) {
    partialEl.textContent = text || "Waiting for speech.";
  },
  onFinal(text) {
    partialEl.textContent = "Waiting for speech.";
    heardLive.textContent = text;
    const li = document.createElement("li");
    li.textContent = text;
    transcriptEl.appendChild(li);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  },
  onLevel(rms) {
    const width = Math.max(0, Math.min(100, Math.round(rms * 280)));
    meterEl.style.width = `${width}%`;
  },
  onSnapshot: applySnapshot,
});

document.getElementById("btn-upload").addEventListener("click", () => {
  const result = startDeferredIngest("file-upload");
  ingestNote.textContent = result.message;
});

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
  if (!debateAudio) return;
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

audio?.addEventListener("timeupdate", () => highlightByAudio(audio.currentTime * 1000));
audio?.addEventListener("seeked", () => highlightByAudio(audio.currentTime * 1000));

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

async function runProcessing() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const skip = new URLSearchParams(location.search).has("ready") || reduce;
  processingEl.hidden = false;
  processingEl.classList.remove("is-done");
  processingEl.removeAttribute("aria-hidden");
  renderSteps(0);
  if (skip) {
    renderSteps(STAGES.length);
    processingEl.hidden = true;
    workspaceEl.hidden = false;
    return;
  }
  let skipped = false;
  const skipButton = document.getElementById("btn-skip");
  const onSkip = () => {
    skipped = true;
    processingEl.hidden = true;
    workspaceEl.hidden = false;
  };
  skipButton.addEventListener("click", onSkip, { once: true });
  for (let i = 0; i < STAGES.length; i += 1) {
    if (skipped) return;
    renderSteps(i);
    processStatus.textContent = `${STAGES[i].label}...`;
    await new Promise((resolve) => setTimeout(resolve, 280));
  }
  if (!skipped) {
    renderSteps(STAGES.length);
    processingEl.hidden = true;
    workspaceEl.hidden = false;
    processStatus.textContent = `Ready · ${pages.length} cited topics`;
  }
}

document.getElementById("btn-debate").addEventListener("click", async () => {
  await mic.stop();
  ingestNote.textContent = "Loading the baked 1992 debate.";
  try {
    const loaded = await loadPreloadedSession();
    debateAudio = true;
    playerEl.hidden = false;
    replaceSession(loaded.pages, loaded.timeline);
    metaStrip.textContent = `${loaded.meta.pagesCreated} pages · ${loaded.meta.uniqueClaims} unique claims · research: ${loaded.meta.researcher} (${loaded.meta.researchRequests} Tavily calls)`;
    researchNote.textContent = `Research mode: ${loaded.meta.researcher}. Tavily requests: ${loaded.meta.researchRequests}.`;
    workspaceEl.hidden = true;
    await runProcessing();
    const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
    selectPage(pageById.has(fromHash) ? fromHash : pages[0]?.id, false);
    ingestNote.textContent = "Showing the preloaded 1992 debate. File upload is still deferred.";
  } catch {
    ingestNote.textContent = "The baked debate is not on this host yet. Run the play bake, then try again.";
  }
});

replaceSession([], []);
metaStrip.textContent = "Live microphone ready";
researchNote.textContent = "Research mode: wikipedia, when you speak. The baked debate uses fixture research and zero Tavily calls.";
workspaceEl.hidden = false;
