/**
 * Best-effort per-IP sliding-window limiter. This exists to stop a single
 * visitor from draining the free Gemini quota.
 *
 * Note: on serverless platforms each instance keeps its own counters and they
 * reset on cold start, so this is a speed bump rather than a hard guarantee.
 * A shared store (Upstash, Redis) would be needed for a real quota.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const MAX_TRACKED_KEYS = 10_000;

const hits = new Map<string, number[]>();

function prune(now: number) {
  if (hits.size < MAX_TRACKED_KEYS) return;

  for (const [key, timestamps] of hits) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > WINDOW_MS) {
      hits.delete(key);
    }
  }

  // Still oversized: drop the oldest entries to bound memory.
  if (hits.size >= MAX_TRACKED_KEYS) {
    const keys = [...hits.keys()].slice(0, Math.floor(hits.size / 2));
    for (const key of keys) hits.delete(key);
  }
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

export function consume(key: string): RateLimitResult {
  const now = Date.now();
  prune(now);

  const windowStart = now - WINDOW_MS;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= MAX_REQUESTS) {
    const retryAfterMs = timestamps[0] + WINDOW_MS - now;
    hits.set(key, timestamps);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  timestamps.push(now);
  hits.set(key, timestamps);

  return { allowed: true, remaining: MAX_REQUESTS - timestamps.length };
}
