/**
 * Exponential backoff for a poller. A failed tick doubles the wait before
 * the next attempt, capped; a success resets it. Auth failures get a
 * longer floor, because a revoked token won't fix itself in a minute and
 * every retry is a wasted request against a rate limit.
 */
export class Backoff {
  private failures = 0
  private pausedUntil = 0

  constructor(
    private readonly baseMs: number,
    private readonly maxMs: number
  ) {}

  /** True while a previous failure is still being waited out. */
  get paused(): boolean {
    return Date.now() < this.pausedUntil
  }

  /** True on the first failure of a streak — the moment worth logging. */
  get streakJustStarted(): boolean {
    return this.failures === 1
  }

  succeed(): void {
    this.failures = 0
    this.pausedUntil = 0
  }

  /** Record a failure; returns how long the poller will now wait. */
  fail(floorMs = 0): number {
    this.failures += 1
    const exponential = Math.min(this.maxMs, this.baseMs * 2 ** (this.failures - 1))
    const delay = Math.max(exponential, Math.min(this.maxMs, floorMs))
    this.pausedUntil = Date.now() + delay
    return delay
  }
}

const AUTH_RE = /\b(401|403)\b|auth rejected|unauthori[sz]ed|forbidden|bad credentials/i

export function isAuthError(message: string): boolean {
  return AUTH_RE.test(message)
}

export function describeDelay(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60_000)} min`
}
