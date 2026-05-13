import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentId } from '@shared/types'

const MAX_BYTES_PER_AGENT = 200_000

/**
 * Per-agent terminal scrollback. Kept in memory while the app runs;
 * persisted to disk on quit so the cockpit "remembers" what each agent
 * was doing across restarts.
 *
 * Persistence is best-effort — a hard crash before before-quit loses the
 * last session. Worth the simplicity tradeoff.
 */
class Scrollback {
  private buffers = new Map<AgentId, string>()

  append(agentId: AgentId, chunk: string): void {
    const prev = this.buffers.get(agentId) ?? ''
    let next = prev + chunk
    if (next.length > MAX_BYTES_PER_AGENT) {
      next = next.slice(next.length - MAX_BYTES_PER_AGENT)
    }
    this.buffers.set(agentId, next)
  }

  get(agentId: AgentId): string {
    return this.buffers.get(agentId) ?? ''
  }

  clear(agentId: AgentId): void {
    this.buffers.delete(agentId)
  }

  /** Read previously persisted buffers for the given agents into memory. */
  loadFromDisk(agentIds: AgentId[]): void {
    const dir = this.dir()
    for (const id of agentIds) {
      const file = join(dir, `${id}.bin`)
      if (!existsSync(file)) continue
      try {
        const data = readFileSync(file, 'utf8')
        // In case the on-disk file was somehow over the cap, trim again.
        const trimmed =
          data.length > MAX_BYTES_PER_AGENT
            ? data.slice(data.length - MAX_BYTES_PER_AGENT)
            : data
        this.buffers.set(id, trimmed)
      } catch {
        /* corrupt file — skip, will get rewritten on next quit */
      }
    }
  }

  /** Write all current buffers to disk. Called on before-quit. */
  flushToDisk(): void {
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    for (const [id, buf] of this.buffers) {
      try {
        writeFileSync(join(dir, `${id}.bin`), buf, 'utf8')
      } catch {
        /* best-effort */
      }
    }
  }

  private dir(): string {
    return join(app.getPath('userData'), 'scrollback')
  }
}

export const scrollback = new Scrollback()
