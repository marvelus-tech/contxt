import {
  browserListenProtocols,
  createMicrophonePipeline,
  deepgramBrowserListenUrl,
  describeMicFailure,
  downsampleBox,
  floatToInt16,
  isSafeTokenUrl,
  micNotice,
  readDeepgramListenEvent,
} from "./mic-engine.js";

const BAD_PHASES = new Set(["denied", "no-device", "insecure", "token-missing", "token-error", "error"]);

function safeServerMessage(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > 180) return "";
  if (/api[_-]?key\s*[:=]|bearer\s+[a-z0-9._-]{20,}/i.test(text)) return "";
  return text;
}

async function resolveTokenUrl() {
  let configured = "";
  try {
    const response = await fetch("mic-config.json", { cache: "no-store" });
    if (response.ok) {
      const body = await response.json();
      configured = typeof body.tokenUrl === "string" ? body.tokenUrl.trim() : "";
    }
  } catch {
    configured = "";
  }
  if (configured) {
    if (!isSafeTokenUrl(configured)) {
      const error = new Error("unsafe token url");
      error.phase = "token-missing";
      throw error;
    }
    return configured;
  }
  return new URL("/api/mic/token", location.origin).href;
}

async function fetchAccessToken(tokenUrl) {
  let response;
  try {
    response = await fetch(tokenUrl, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    const error = new Error("network");
    error.phase = "token-error";
    throw error;
  }
  if (response.status === 404) {
    const error = new Error("missing");
    error.phase = "token-missing";
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || typeof body.access_token !== "string") {
    const error = new Error(safeServerMessage(body.error) || "token");
    error.phase = "token-error";
    throw error;
  }
  return body.access_token;
}

function pumpPcm(socket, queue) {
  while (queue.length > 0 && socket.readyState === WebSocket.OPEN) {
    socket.send(queue.shift());
  }
}

/**
 * Live microphone. Partials update the screen immediately. Final lines go
 * through the same pipeline session the CLI uses.
 */
export function bindMicrophone(ui) {
  let pipeline = createMicrophonePipeline();
  let phase = "idle";
  let wantLive = false;
  let generation = 0;
  let socket = null;
  let context = null;
  let stream = null;
  let worklet = null;
  let processor = null;
  let mute = null;
  let mediaMs = 0;
  const queue = [];
  let retries = 0;

  function setPhase(next, message) {
    phase = next;
    const notice = micNotice(next, message);
    ui.onPhase(notice);
    const listening = next === "live" || next === "connecting" || next === "reconnecting" || next === "requesting-permission";
    ui.button.setAttribute("aria-pressed", listening ? "true" : "false");
    ui.label.textContent = listening ? "Stop microphone" : "Use microphone";
  }

  async function publishSegments(segments) {
    if (!segments?.length) return;
    const end = segments[segments.length - 1].endMs ?? mediaMs;
    mediaMs = Math.max(mediaMs, end);
    ui.onFinal(segments.map((segment) => segment.text).join(" "));
    await pipeline.session.processSegments(segments, mediaMs);
    ui.onSnapshot(pipeline.session.snapshot());
  }

  async function flushCarry() {
    await pipeline.session.flushExtractor(mediaMs);
    ui.onSnapshot(pipeline.session.snapshot());
  }

  function handlePayload(raw) {
    const event = readDeepgramListenEvent(raw);
    if (event.kind === "partial" && event.text) ui.onPartial(event.text);
    if (event.kind === "final") void publishSegments(event.segments);
    if (event.kind === "utterance_end") void flushCarry();
  }

  function enqueue(buffer) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(buffer);
    else {
      queue.push(buffer);
      if (queue.length > 24) queue.shift();
    }
  }

  async function connect(gen) {
    setPhase(retries > 0 ? "reconnecting" : "connecting");
    const tokenUrl = await resolveTokenUrl();
    const accessToken = await fetchAccessToken(tokenUrl);
    if (!wantLive || gen !== generation) return;
    const ws = new WebSocket(deepgramBrowserListenUrl(), browserListenProtocols(accessToken));
    ws.binaryType = "arraybuffer";
    socket = ws;
    ws.onopen = () => {
      if (gen !== generation) {
        ws.close();
        return;
      }
      retries = 0;
      setPhase("live");
      pumpPcm(ws, queue);
    };
    ws.onmessage = (event) => {
      if (gen !== generation) return;
      if (typeof event.data === "string") handlePayload(event.data);
    };
    ws.onerror = () => {
      if (gen === generation) ws.close();
    };
    ws.onclose = () => {
      if (!wantLive || gen !== generation) return;
      retries += 1;
      if (retries > 4) {
        wantLive = false;
        setPhase("error", "Live speech disconnected. Start the microphone again.");
        void releaseAudio();
        return;
      }
      const delay = Math.min(4000, 300 * 2 ** retries);
      window.setTimeout(() => {
        if (wantLive && gen === generation) {
          connect(gen).catch((error) => fail(error));
        }
      }, delay);
    };
  }

  function fail(error) {
    wantLive = false;
    generation += 1;
    const serverText = safeServerMessage(error?.message);
    const usable = serverText && !["token", "network", "missing", "unsafe token url"].includes(serverText)
      ? serverText
      : undefined;
    const notice = error?.phase ? micNotice(error.phase, usable) : describeMicFailure(error);
    setPhase(notice.phase, notice.message);
    void releaseAudio();
  }

  async function releaseAudio() {
    worklet?.port.postMessage({ type: "stop" });
    worklet?.disconnect();
    processor?.disconnect();
    mute?.disconnect();
    worklet = null;
    processor = null;
    mute = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "CloseStream" }));
    }
    socket?.close();
    socket = null;
    queue.length = 0;
    if (context) {
      await context.close().catch(() => {});
      context = null;
    }
  }

  function onPcm(floatSamples, sampleRate) {
    const down = downsampleBox(floatSamples, sampleRate, 16000);
    const pcm = new Int16Array(down.length);
    let energy = 0;
    for (let i = 0; i < down.length; i += 1) {
      const sample = down[i];
      energy += sample * sample;
      pcm[i] = floatToInt16(sample);
    }
    if (down.length) ui.onLevel(Math.sqrt(energy / down.length));
    if (pcm.length) enqueue(pcm.buffer);
  }

  async function openAudio() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream);
    try {
      await context.audioWorklet.addModule(new URL("./mic-worklet.js", import.meta.url));
      worklet = new AudioWorkletNode(context, "pcm-capture");
      worklet.port.onmessage = (event) => {
        if (event.data?.pcm) enqueue(event.data.pcm);
        if (typeof event.data?.rms === "number") ui.onLevel(event.data.rms);
      };
      source.connect(worklet);
      return;
    } catch {
      worklet = null;
    }
    // Older browsers: ScriptProcessor still delivers samples. Gain stays at 0
    // so the mic is never played back into the speakers.
    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      onPcm(event.inputBuffer.getChannelData(0), context.sampleRate);
    };
    mute = context.createGain();
    mute.gain.value = 0;
    source.connect(processor);
    processor.connect(mute);
    mute.connect(context.destination);
  }

  async function start() {
    if (!window.isSecureContext) {
      setPhase("insecure");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("error", "This browser has no microphone API.");
      return;
    }
    wantLive = true;
    retries = 0;
    mediaMs = 0;
    pipeline = createMicrophonePipeline();
    const gen = ++generation;
    setPhase("requesting-permission");
    try {
      await openAudio();
      if (!wantLive || gen !== generation) return;
      await connect(gen);
    } catch (error) {
      if (gen === generation) fail(error);
    }
  }

  async function stop() {
    const wasLive = wantLive || BAD_PHASES.has(phase) === false && phase !== "idle";
    wantLive = false;
    generation += 1;
    await releaseAudio();
    if (wasLive) {
      await flushCarry();
      setPhase("stopped");
      ui.onPartial("");
    }
  }

  ui.button.addEventListener("click", () => {
    if (wantLive || phase === "requesting-permission" || phase === "connecting" || phase === "live" || phase === "reconnecting") {
      void stop();
      return;
    }
    void start();
  });

  setPhase("idle");
  return { stop: () => stop() };
}
