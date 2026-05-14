import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TerminalId } from '@shared/types'

const MAX_BYTES_PER_TERMINAL = 200_000

/**
 * Per-terminal scrollback. Kept in memory while the app runs; persisted to
 * disk on quit so the cockpit "remembers" what each terminal was doing
 * across restarts. Only primary terminals (terminalId === agentId) are
 * loaded from disk on boot — secondary split terminals are session-only.
 *
 * Persistence is best-effort — a hard crash before before-quit loses the
 * last session. Worth the simplicity tradeoff.
 */
class Scrollback {
  private buffers = new Map<TerminalId, string>()

  append(terminalId: TerminalId, chunk: string): void {
    const prev = this.buffers.get(terminalId) ?? ''
    let next = prev + chunk
    if (next.length > MAX_BYTES_PER_TERMINAL) {
      next = next.slice(next.length - MAX_BYTES_PER_TERMINAL)
    }
    this.buffers.set(terminalId, next)
  }

  get(terminalId: TerminalId): string {
    return this.buffers.get(terminalId) ?? ''
  }

  clear(terminalId: TerminalId): void {
    this.buffers.delete(terminalId)
  }

  /** Read previously persisted buffers for the given terminals into memory. */
  loadFromDisk(terminalIds: TerminalId[]): void {
    const dir = this.dir()
    for (const id of terminalIds) {
      const file = join(dir, `${id}.bin`)
      if (!existsSync(file)) continue
      try {
        const data = readFileSync(file, 'utf8')
        const trimmed =
          data.length > MAX_BYTES_PER_TERMINAL
            ? data.slice(data.length - MAX_BYTES_PER_TERMINAL)
            : data
        this.buffers.set(id, trimmed)
      } catch {
        /* corrupt file — skip, will get rewritten on next quit */
      }
    }
  }

  /**
   * Write the given terminal buffers to disk. Pass the list of terminal ids
   * worth persisting (typically just the primary terminals — secondary
   * split terminals are session-only).
   */
  flushToDisk(terminalIds: TerminalId[]): void {
    const dir = this.dir()
    mkdirSync(dir, { recursive: true })
    const keep = new Set(terminalIds)
    for (const [id, buf] of this.buffers) {
      if (!keep.has(id)) continue
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
