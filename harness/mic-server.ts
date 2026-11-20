import { createReadStream } from "node:fs";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { createGrantLimiter, handleMicGrantRequest } from "../pipeline/mic-grant.js";

const root = resolve("web/play");
const port = Number(process.env.MIC_PORT ?? 8787);
const host = process.env.MIC_HOST ?? "127.0.0.1";
const limiter = createGrantLimiter();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".opus": "audio/ogg",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

/** Loads .env without printing values. Existing process env wins. */
async function loadDotEnv(): Promise<void> {
  let text = "";
  try {
    text = await readFile(".env", "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function safeFile(urlPath: string): string | null {
  let decoded = urlPath;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const full = resolve(root, `.${normalize(decoded.startsWith("/") ? decoded : `/${decoded}`)}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  return full;
}

function toWebRequest(req: IncomingMessage): Request {
  const hostHeader = req.headers.host ?? `${host}:${port}`;
  const url = new URL(req.url ?? "/", `http://${hostHeader}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(", "));
  }
  return new Request(url, { method: req.method, headers });
}

async function sendGrant(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const response = await handleMicGrantRequest(toWebRequest(req), {
    apiKey: process.env.DEEPGRAM_API_KEY,
    allowedOrigins: process.env.MIC_ALLOWED_ORIGINS,
    clientKey: req.socket.remoteAddress ?? "local",
    allowMissingOrigin: true,
    limiter,
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function sendFile(res: ServerResponse, filePath: string): void {
  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
  createReadStream(filePath).pipe(res);
}

await loadDotEnv();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/api/mic/token" || url.pathname === "/token") {
    void sendGrant(req, res);
    return;
  }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, configured: Boolean(process.env.DEEPGRAM_API_KEY) }));
    return;
  }
  const target = safeFile(url.pathname === "/" ? "/index.html" : url.pathname);
  if (!target || !existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const stat = statSync(target);
  if (stat.isDirectory()) {
    const index = join(target, "index.html");
    if (!existsSync(index)) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    sendFile(res, index);
    return;
  }
  sendFile(res, target);
});

server.listen(port, host, () => {
  console.log(JSON.stringify({
    message: "mic server",
    url: `http://${host}:${port}/`,
    configured: Boolean(process.env.DEEPGRAM_API_KEY),
  }));
});
