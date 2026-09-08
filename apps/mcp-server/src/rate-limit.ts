/**
 * Simple in-memory sliding-window rate limiter.
 * Each bucket tracks request timestamps; expired entries are pruned on check.
 */

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

interface Bucket {
  timestamps: number[];
}

export class RateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, Bucket>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Periodically prune stale buckets to prevent memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), config.windowMs * 2);
    this.cleanupTimer.unref();
  }

  /** Returns true if the request is allowed, false if rate-limited. */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.config.windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Prune expired timestamps
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= this.config.maxRequests) {
      return false;
    }

    bucket.timestamps.push(now);
    return true;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs;
    for (const [key, bucket] of this.buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}

// Pre-configured limiters per the security review recommendations
export const oauthRegisterLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 10 });
export const oauthFlowLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
export const mcpLimiter = new RateLimiter({ windowMs: 3_600_000, maxRequests: 1000 });

export function getClientIp(req: import('node:http').IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.socket?.remoteAddress ?? 'unknown';
}
