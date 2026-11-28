import { bindMicrophone } from "./mic.js";
import { createInsightWorkspace } from "./insight-workspace.js";

const partialEl = document.getElementById("partial");
const heardLive = document.getElementById("heard-live");
const transcriptEl = document.getElementById("transcript");
const meterEl = document.getElementById("mic-meter");
const statusEl = document.getElementById("mic-status");
const heardBlock = document.getElementById("heard-block");
const exportPanel = document.getElementById("export-panel");
const btnDownload = document.getElementById("btn-download-snapshot");
const sessionMeta = document.getElementById("session-meta");

const workspace = createInsightWorkspace(
  {
    workspaceEl: document.getElementById("workspace"),
    feedEl: document.getElementById("feed"),
    detailEl: document.getElementById("topic-detail"),
    searchEl: document.getElementById("topic-search"),
    carouselCount: document.getElementById("carousel-count"),
    momentsPeek: document.getElementById("moments-peek"),
    momentsPanel: document.getElementById("moments-panel"),
    btnBrowse: document.getElementById("btn-browse"),
    btnCloseMoments: document.getElementById("btn-close-moments"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    researchNote: document.getElementById("research-note"),
    sessionMeta,
  },
  { mode: "live" },
);

workspace.revealWorkspace();

const failedPhases = new Set(["denied", "no-device", "insecure", "token-missing", "token-error", "error"]);

bindMicrophone({
  button: document.getElementById("btn-mic"),
  label: document.getElementById("mic-label"),
  onPhase(notice) {
    statusEl.textContent = notice.message;
    statusEl.classList.toggle("is-bad", failedPhases.has(notice.phase));
    if (failedPhases.has(notice.phase)) partialEl.textContent = "";
    if (notice.phase === "requesting-permission") {
      transcriptEl.replaceChildren();
      partialEl.textContent = "Waiting for speech.";
      heardLive.textContent = "";
      meterEl.style.width = "0%";
      exportPanel.hidden = true;
    }
    if (notice.phase === "stopped") {
      exportPanel.hidden = false;
    }
  },
  onPartial(text) {
    partialEl.textContent = text || "Waiting for speech.";
  },
  onFinal(text) {
    partialEl.textContent = "Waiting for speech.";
    heardLive.textContent = text;
    heardBlock.hidden = false;
    const li = document.createElement("li");
    li.textContent = text;
    transcriptEl.appendChild(li);
    transcriptEl.scrollTop = transcriptEl.scrollHeight;
  },
  onLevel(rms) {
    const width = Math.max(0, Math.min(100, Math.round(rms * 280)));
    meterEl.style.width = `${width}%`;
  },
  onSnapshot(snapshot) {
    workspace.applySnapshot(snapshot);
  },
});

btnDownload?.addEventListener("click", () => {
  const snap = workspace.getLastSnapshot();
  if (!snap?.pages?.length) {
    statusEl.textContent = "Nothing to download yet. Speak a checkable claim first.";
    return;
  }
  const params = new URLSearchParams(location.search);
  const title = params.get("name")?.trim() || "live-session";
  const payload = {
    exportedAt: new Date().toISOString(),
    title,
    pages: snap.pages,
    timeline: snap.timeline,
    meta: {
      pagesCreated: snap.pagesCreated,
      pagesUpdated: snap.pagesUpdated,
      researchRequests: snap.researchRequests,
    },
  };
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/[^\w.-]+/g, "-")}-snapshot.json`;
  a.click();
  URL.revokeObjectURL(url);
});