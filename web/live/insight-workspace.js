/** Insight carousel, moments sheet, and hero. Shared by live record and baked sessions. */

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

const SHEET_KEY = "cntxt_moments_open_v1";
const HOOK_MAX = 120;
const HEADLINE_MAX = 56;

const EMPTY_HERO =
  '<p class="muted">Speak a checkable claim. Cited facts from Wikipedia land here as you talk.</p>';

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

function insightHeadline(page) {
  if (!page) return "Moment";
  const fact = page.facts?.[0]?.text;
  if (fact) return truncate(fact, HEADLINE_MAX);
  if (page.title) return truncate(page.title, HEADLINE_MAX);
  return truncate(page.currentClaim ?? "Moment", HEADLINE_MAX);
}

function normalizeForCompare(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hookRedundantWithFact(page) {
  const fact = page?.facts?.[0]?.text;
  const claim = page?.currentClaim;
  if (!fact || !claim) return false;
  const a = normalizeForCompare(fact);
  const b = normalizeForCompare(claim);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 24 && longer.startsWith(shorter.slice(0, Math.min(48, shorter.length)))) {
    return true;
  }
  return false;
}

function spokenHook(page) {
  if (hookRedundantWithFact(page)) return "";
  return truncate(page?.currentClaim ?? "", HOOK_MAX);
}

/**
 * @param {Record<string, HTMLElement | null | undefined>} refs
 * @param {{ mode?: 'live' | 'session' }} [options]
 */
export function createInsightWorkspace(refs, options = {}) {
  const live = (options.mode ?? "live") === "live";

  const workspaceEl = refs.workspaceEl;
  const feedEl = refs.feedEl;
  const detailEl = refs.detailEl;
  const searchEl = refs.searchEl;
  const carouselCount = refs.carouselCount;
  const momentsPeek = refs.momentsPeek;
  const momentsPanel = refs.momentsPanel;
  const btnBrowse = refs.btnBrowse;
  const btnCloseMoments = refs.btnCloseMoments;
  const btnPrev = refs.btnPrev;
  const btnNext = refs.btnNext;
  const researchNote = refs.researchNote ?? null;
  const sessionMeta = refs.sessionMeta ?? null;

  let pages = [];
  let timeline = [];
  let pageById = new Map();
  let pageOrder = [];
  const createdAt = new Map();
  let feedEvents = [];
  let filter = "all";
  let selectedId = null;
  const feedNodes = [];
  let momentsOpen = false;
  let ready = false;
  let lastSnapshot = null;

  function setMomentsOpen(open) {
    momentsOpen = open;
    workspaceEl?.classList.toggle("moments-open", open);
    btnBrowse?.setAttribute("aria-expanded", String(open));
    if (window.matchMedia("(max-width: 820px)").matches) {
      if (momentsPanel) momentsPanel.hidden = !open;
    } else if (momentsPanel) {
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
    if (!feedEl) return;
    const q = searchEl?.value.trim().toLowerCase() ?? "";
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
      li.addEventListener("click", () => selectPage(event.refId, false));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectPage(event.refId, false);
        }
      });
      feedEl.appendChild(li);
      feedNodes.push(li);
    }
  }

  function renderInsightHero(page) {
    if (!detailEl) return;
    if (!page) {
      detailEl.innerHTML = EMPTY_HERO;
      return;
    }
    const facts = (page.facts ?? []).map(
      (fact, i) => `<li class="fact-card">
        <div class="fact-card__head">
          <span class="fact-card__index" aria-hidden="true">${i + 1}</span>
        </div>
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

    const presentBlock = live
      ? ""
      : `<a class="btn-primary present-link" href="deck.html#${encodeURIComponent(page.id)}">Present this topic</a>`;

    detailEl.innerHTML = `
    <p class="speaker">${escapeHtml(page.currentSpeaker ?? "Unknown speaker")} · ${formatClock(page.createdAtMs)}</p>
    <h3 class="sr-only">${escapeHtml(insightHeadline(page))}</h3>
    ${factsBlock}
    ${hookBlock}
    ${transcriptBlock}
    ${presentBlock}
  `;
  }

  function updateCarouselChrome() {
    const idx = pageOrder.indexOf(selectedId);
    if (idx < 0) {
      if (carouselCount) carouselCount.textContent = "—";
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }
    if (carouselCount) carouselCount.textContent = `${idx + 1} of ${pageOrder.length}`;
    if (btnPrev) btnPrev.disabled = idx <= 0;
    if (btnNext) btnNext.disabled = idx >= pageOrder.length - 1;
    const page = pageById.get(selectedId);
    const at = formatClock(page?.createdAtMs ?? 0);
    if (momentsPeek) momentsPeek.textContent = `${pageOrder.length} moments · now at ${at}`;
  }

  function selectPage(pageId, writeHash = true) {
    if (!pageId || !pageById.has(pageId)) return;
    selectedId = pageId;
    renderInsightHero(pageById.get(pageId));
    for (const node of feedNodes) {
      node.classList.toggle("hot", node.dataset.refId === pageId);
    }
    if (writeHash) history.replaceState(null, "", `#${pageId}`);
    updateCarouselChrome();
  }

  function moveTopic(delta) {
    const idx = pageOrder.indexOf(selectedId);
    if (idx < 0) return;
    const next = pageOrder[idx + delta];
    if (next) selectPage(next, true);
  }

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

  function revealWorkspace() {
    if (ready) return;
    ready = true;
    if (workspaceEl) workspaceEl.hidden = false;
    renderFeed();
    initMomentsPanel();
    if (!selectedId && pages.length === 0 && detailEl) {
      detailEl.innerHTML = EMPTY_HERO;
    }
    updateCarouselChrome();
  }

  function replaceSession(nextPages, nextTimeline) {
    pages = nextPages;
    timeline = nextTimeline;
    pageById = new Map(pages.map((page) => [page.id, page]));
    pageOrder = pages.map((p) => p.id);
    feedEvents = timeline.filter((event) => FEED_TYPES.has(event.type));
    createdAt.clear();
    for (const event of timeline) {
      if (event.type === "page-created" && event.refId && !createdAt.has(event.refId)) {
        createdAt.set(event.refId, event.mediaMs ?? 0);
      }
    }
    renderFeed();
  }

  function applySnapshot(snapshot) {
    lastSnapshot = snapshot;
    replaceSession(snapshot.pages ?? [], snapshot.timeline ?? []);
    const newest = [...(snapshot.timeline ?? [])]
      .reverse()
      .find((event) => event.type === "page-created" || event.type === "page-updated");
    revealWorkspace();
    if (newest?.refId) {
      selectPage(newest.refId, false);
    } else if (pages.length === 0) {
      selectedId = null;
      renderInsightHero(null);
      updateCarouselChrome();
    }
    if (researchNote) {
      const lookups = snapshot.researchRequests ?? 0;
      researchNote.textContent = `Wikipedia · ${lookups} lookup${lookups === 1 ? "" : "s"}`;
    }
    if (sessionMeta) {
      const n = snapshot.pages?.length ?? 0;
      sessionMeta.textContent =
        n > 0 ? `${n} insight${n === 1 ? "" : "s"} so far · live` : "Live · insights appear as you speak";
    }
  }

  function getLastSnapshot() {
    return lastSnapshot;
  }

  if (searchEl) searchEl.addEventListener("input", () => renderFeed());

  for (const chip of document.querySelectorAll("[data-filter]")) {
    chip.addEventListener("click", () => {
      filter = chip.dataset.filter ?? "all";
      for (const other of document.querySelectorAll("[data-filter]")) {
        other.classList.toggle("is-on", other === chip);
      }
      renderFeed();
      if (selectedId) selectPage(selectedId, false);
    });
  }

  btnBrowse?.addEventListener("click", () => setMomentsOpen(!momentsOpen));
  btnCloseMoments?.addEventListener("click", () => setMomentsOpen(false));
  btnPrev?.addEventListener("click", () => moveTopic(-1));
  btnNext?.addEventListener("click", () => moveTopic(1));

  window.matchMedia("(max-width: 820px)").addEventListener("change", () => {
    if (!ready) return;
    if (window.matchMedia("(max-width: 820px)").matches && !momentsOpen && momentsPanel) {
      momentsPanel.hidden = true;
    } else if (momentsPanel && window.matchMedia("(min-width: 821px)").matches) {
      momentsPanel.hidden = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.target !== document.body && event.target !== detailEl) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveTopic(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveTopic(1);
    }
  });

  if (detailEl && live) {
    detailEl.innerHTML = EMPTY_HERO;
  }

  return {
    applySnapshot,
    getLastSnapshot,
    revealWorkspace,
    selectPage,
    moveTopic,
  };
}