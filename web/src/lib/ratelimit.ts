// Best-effort abuse protection for the AI endpoint.
//
// This is the no-database tier: an origin check plus an in-memory sliding
// window. Serverless instances don't share memory, so the window caps each warm
// instance rather than the fleet — enough to stop a script hammering the
// endpoint, not a substitute for the per-account quota that lands with auth.

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 20; // per IP per instance

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const h = req.headers;
  return (
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

/** True when the request came from our own pages (blocks casual curl/scripts). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  // Same-origin fetch from our own page always sends Origin; allow only ours.
  if (!origin) return false;
  try {
    const o = new URL(origin).host;
    const self = new URL(req.url).host;
    if (o === self) return true;
    // Vercel preview deployments and the production alias.
    return (
      o.endsWith(".vercel.app") ||
      o === "health.striortus.com" ||
      o.startsWith("localhost:") ||
      o === "localhost"
    );
  } catch {
    return false;
  }
}

export function rateLimit(key: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) {
    const oldest = arr[0];
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }
  arr.push(now);
  hits.set(key, arr);
  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [k, v] of hits) {
      if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return { ok: true, retryAfter: 0 };
}
