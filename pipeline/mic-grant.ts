/**
 * Mints a Deepgram grant on the server. The permanent API key stays here.
 * Browsers receive only { access_token, expires_in } and open Deepgram themselves.
 */

const GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const DEFAULT_TTL_SECONDS = 30;
const WINDOW_MS = 60_000;
const MAX_GRANTS_PER_WINDOW = 12;

export interface GrantLimiter {
  allow(key: string, now: number): boolean;
}

export function createGrantLimiter(
  max = MAX_GRANTS_PER_WINDOW,
  windowMs = WINDOW_MS,
): GrantLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number): boolean {
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

export interface MicGrantConfig {
  apiKey?: string;
  allowedOrigins?: string;
  clientKey?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  limiter?: GrantLimiter;
  /** Localhost servers accept a missing Origin. Public workers should leave this false. */
  allowMissingOrigin?: boolean;
}

const DEFAULT_ORIGINS = ["https://marvelus-tech.github.io"];

function originList(extra: string | undefined): string[] {
  const fromEnv = (extra ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...fromEnv];
}

export function isGrantOriginAllowed(
  origin: string | null,
  allowed: string[],
  allowMissingOrigin: boolean,
): boolean {
  if (!origin) return allowMissingOrigin;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    return allowed.includes(origin);
  } catch {
    return false;
  }
}

function json(body: unknown, status: number, origin: string | null, vary: boolean): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  if (origin && status !== 403) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "origin");
  } else if (vary) {
    headers.set("vary", "origin");
  }
  return new Response(JSON.stringify(body), { status, headers });
}

const defaultLimiter = createGrantLimiter();

export async function handleMicGrantRequest(
  request: Request,
  config: MicGrantConfig = {},
): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowed = originList(config.allowedOrigins);
  const allowMissing = config.allowMissingOrigin === true;
  if (request.method === "OPTIONS") {
    if (!isGrantOriginAllowed(origin, allowed, allowMissing)) {
      return new Response(null, { status: 403 });
    }
    const headers = new Headers({
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "accept, content-type",
      "access-control-max-age": "600",
      "cache-control": "no-store",
    });
    if (origin) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "origin");
    }
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, origin, true);
  }
  if (!isGrantOriginAllowed(origin, allowed, allowMissing)) {
    return json({ error: "This origin cannot mint a speech token." }, 403, null, true);
  }
  const now = config.now ?? Date.now;
  const limiter = config.limiter ?? defaultLimiter;
  const clientKey = config.clientKey || "anonymous";
  if (!limiter.allow(clientKey, now())) {
    return json({ error: "Too many speech tokens. Wait a minute and try again." }, 429, origin, true);
  }
  const apiKey = config.apiKey ?? "";
  if (!apiKey) {
    return json(
      { error: "The speech token server is not configured. Set DEEPGRAM_API_KEY on the server." },
      503,
      origin,
      true,
    );
  }
  const doFetch = config.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(GRANT_URL, {
      method: "POST",
      headers: {
        authorization: `Token ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: DEFAULT_TTL_SECONDS }),
    });
  } catch {
    return json({ error: "The speech token server could not reach Deepgram." }, 502, origin, true);
  }
  if (!response.ok) {
    // Do not forward Deepgram's body. It can echo request details.
    const status = response.status === 401 || response.status === 403 ? 502 : 502;
    return json(
      { error: "The speech token server rejected the server credential." },
      status,
      origin,
      true,
    );
  }
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== "string" || body.access_token.length < 20) {
    return json({ error: "Deepgram did not return a usable speech token." }, 502, origin, true);
  }
  if (body.access_token === apiKey) {
    return json({ error: "Refusing to send the permanent speech credential." }, 502, origin, true);
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : DEFAULT_TTL_SECONDS;
  return json({ access_token: body.access_token, expires_in: expiresIn }, 200, origin, true);
}
