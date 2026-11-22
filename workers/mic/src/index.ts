import { handleMicGrantRequest } from "../../../pipeline/mic-grant.js";

interface MicEnv {
  /** wrangler secret put DEEPGRAM_API_KEY. Never put this in wrangler.jsonc. */
  DEEPGRAM_API_KEY?: string;
  /** Optional comma-separated extra origins. GitHub Pages is allowed in code. */
  MIC_ALLOWED_ORIGINS?: string;
  ASSETS: { fetch(input: Request): Promise<Response> };
}

function clientKey(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "anonymous";
}

export default {
  async fetch(request: Request, env: MicEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/mic/token" || url.pathname === "/token") {
      const response = await handleMicGrantRequest(request, {
        apiKey: env.DEEPGRAM_API_KEY,
        allowedOrigins: env.MIC_ALLOWED_ORIGINS,
        clientKey: clientKey(request),
        // Same-origin GET may omit Origin. Cross-origin browsers always send it,
        // and disallowed origins are rejected. Rate limit covers anonymous callers.
        allowMissingOrigin: true,
      });
      console.log(JSON.stringify({
        message: "mic token",
        status: response.status,
        configured: Boolean(env.DEEPGRAM_API_KEY),
      }));
      return response;
    }
    if (url.pathname === "/health") {
      return Response.json(
        { ok: true, configured: Boolean(env.DEEPGRAM_API_KEY) },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return env.ASSETS.fetch(request);
  },
};
