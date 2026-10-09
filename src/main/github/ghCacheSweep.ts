import { open, readdir, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SWEEP_MS = 5 * 60_000

function ghCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'gh')
}

/**
 * True for a cached reply that says the GraphQL allowance is spent and
 * whose reset time has passed. gh caches some replies for 24 hours and
 * believes their rate-limit headers (cli/cli#12812), so one saved while
 * the allowance really was spent keeps refusing `gh pr checks`, `pr merge`
 * and `pr view` for a day after GitHub has reset it.
 */
export function isStaleLimit(cached: string, nowSeconds: number): boolean {
  const remaining = /^x-ratelimit-remaining:\s*(\d+)/im.exec(cached)
  const reset = /^x-ratelimit-reset:\s*(\d+)/im.exec(cached)
  if (!remaining || !reset) return false
  return Number(remaining[1]) === 0 && Number(reset[1]) < nowSeconds
}

/** The headers come first; bodies run to megabytes and don't matter. */
async function readHead(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await file.read(buf, 0, buf.length, 0)
    return buf.subarray(0, bytesRead).toString('latin1')
  } finally {
    await file.close()
  }
}

async function sweep(dir: string): Promise<void> {
  let files: string[]
  try {
    files = await readdir(dir, { recursive: true })
  } catch {
    return
  }
  const now = Date.now() / 1000
  for (const file of files) {
    const path = join(dir, file)
    try {
      if (isStaleLimit(await readHead(path), now)) await unlink(path)
    } catch {
      /* a directory, or gh rewrote it meanwhile */
    }
  }
}

/** Clear gh's stale "rate limit" replies now and every few minutes. */
export function startGhCacheSweep(): void {
  const dir = ghCacheDir()
  void sweep(dir)
  setInterval(() => void sweep(dir), SWEEP_MS).unref()
}
