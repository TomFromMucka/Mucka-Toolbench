import type { AgentId, AgentStatus, TerminalId } from '@shared/types'

/**
 * Heuristic status detection from Claude Code's TUI output.
 *
 * We only watch each agent's *primary* terminal (the one with
 * terminalId === agentId), where Claude Code runs by default. Cues:
 *
 *   • "esc to interrupt"            → Claude is generating → thinking
 *   • permission prompts            → awaits Tom            → awaiting-input
 *   • nothing recent                → idle
 *
 * The TUI redraws every ~100ms, so we keep a small sliding buffer
 * (last 4KB stripped of ANSI) and re-evaluate after each chunk. After
 * 2s of silence we decay to idle, since the generation indicators have
 * disappeared from the visible frame.
 *
 * This is intentionally cheap and approximate. Claude Code's TUI is
 * not a stable contract; if a future TUI revision changes the cue
 * strings, only this file needs to move.
 */

const TAIL_BYTES = 4000
const SCAN_TAIL_BYTES = 1500
const IDLE_DECAY_MS = 2000

/* eslint-disable no-control-regex -- ANSI escape parsing requires control bytes. */
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const ANSI_DCS = /\x1b[PX^_].*?\x1b\\/g
const ANSI_CHARSET = /\x1b[()][\x20-\x7e]/g
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g
/* eslint-enable no-control-regex */

function stripAnsi(input: string): string {
  return input
    .replace(ANSI_CSI, '')
    .replace(ANSI_OSC, '')
    .replace(ANSI_DCS, '')
    .replace(ANSI_CHARSET, '')
    .replace(CONTROL_CHARS, '')
}

function detectStatus(buffer: string): AgentStatus {
  const tail = buffer.slice(-SCAN_TAIL_BYTES)

  // Approval / confirmation menus. Claude Code prints either a numbered
  // list with a "❯" cursor, a "Do you want to ..." question, or a "Trust
  // this folder" prompt on first boot.
  if (
    /Do you want to (?:proceed|allow|continue|trust)/i.test(tail) ||
    /Trust (?:the )?files in this folder/i.test(tail) ||
    /❯\s*\d+\.\s/.test(tail) ||
    /^\s*1\.\s+Yes\b/m.test(tail)
  ) {
    return 'awaiting-input'
  }

  // Active generation indicator.
  if (/(esc|ctrl\+c) to interrupt/i.test(tail)) {
    return 'thinking'
  }

  return 'idle'
}

/**
 * Last capture-group match in the tail, or null. The status line redraws
 * constantly, so the tail usually holds several stale copies — the last
 * one is the current value.
 */
function lastPercent(tail: string, re: RegExp): number | null {
  let found: number | null = null
  for (const m of tail.matchAll(re)) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 0 && n <= 100) found = n
  }
  return found
}

/**
 * Percent of the context window *consumed*.
 *
 * Claude Code's built-in footer counts down ("Context left until
 * auto-compact: 87%") while a custom status line built on
 * `.context_window.used_percentage` counts up ("ctx:27%"). Both are
 * normalised to used here, so everything downstream reads one direction.
 * Remaining-shaped patterns are tried first because they're the specific
 * ones; the bare `context: N%` catch-all is read as used.
 */
function detectContextUsedPercent(buffer: string): number | null {
  const tail = buffer.slice(-SCAN_TAIL_BYTES)
  const remaining: RegExp[] = [
    /context\s+left\s+until\s+auto-compact[:\s]+(\d{1,3})\s*%/gi,
    /(\d{1,3})\s*%\s+context\s+(?:left|remaining)/gi
  ]
  for (const re of remaining) {
    const n = lastPercent(tail, re)
    if (n !== null) return 100 - n
  }
  const used: RegExp[] = [
    /\bctx[:\s]\s*(\d{1,3})\s*%/gi,
    /context\s+used[:\s]+(\d{1,3})\s*%/gi,
    /context[:\s]+(\d{1,3})\s*%/gi
  ]
  for (const re of used) {
    const n = lastPercent(tail, re)
    if (n !== null) return n
  }
  return null
}

/**
 * Model display name from the status line, e.g. "Opus 5 (1M context)".
 *
 * Anchored on the `[model] ctx:N%` pairing rather than matching any
 * bracketed text — square brackets are far too common in TUI output to
 * key off alone.
 */
const MODEL_PATTERN = /\[([^[\]]{2,48})\]\s*ctx[:\s]/gi

function detectModel(buffer: string): string | null {
  const tail = buffer.slice(-SCAN_TAIL_BYTES)
  let found: string | null = null
  for (const m of tail.matchAll(MODEL_PATTERN)) {
    const label = m[1].trim()
    if (label.length > 0) found = label
  }
  return found
}

interface Tracker {
  agentId: AgentId
  buffer: string
  status: AgentStatus
  contextUsedPercent: number | null
  model: string | null
  decayTimer: NodeJS.Timeout | null
}

export interface StatusEmit {
  agentId: AgentId
  status: AgentStatus
  contextUsedPercent: number | null
  model: string | null
}

export class StatusDetector {
  private readonly trackers = new Map<TerminalId, Tracker>()
  private readonly emit: (event: StatusEmit) => void

  constructor(emit: (event: StatusEmit) => void) {
    this.emit = emit
  }

  /**
   * Register a terminal for detection. Only the agent's *primary*
   * terminal (terminalId === agentId) should be registered — that's
   * where Claude Code's TUI runs. Split terminals are ignored.
   */
  register(terminalId: TerminalId, agentId: AgentId): void {
    if (terminalId !== agentId) return
    const existing = this.trackers.get(terminalId)
    if (existing && existing.decayTimer) clearTimeout(existing.decayTimer)
    this.trackers.set(terminalId, {
      agentId,
      buffer: '',
      status: 'idle',
      contextUsedPercent: null,
      model: null,
      decayTimer: null
    })
    this.emit({ agentId, status: 'idle', contextUsedPercent: null, model: null })
  }

  ingest(terminalId: TerminalId, data: string): void {
    const tracker = this.trackers.get(terminalId)
    if (!tracker) return

    const stripped = stripAnsi(data)
    tracker.buffer = (tracker.buffer + stripped).slice(-TAIL_BYTES)

    const nextStatus = detectStatus(tracker.buffer)
    const nextContext = detectContextUsedPercent(tracker.buffer)
    // The status line scrolls out of the tail between redraws, so treat a
    // miss as "no news" and keep the last known values rather than
    // flickering the header chips off and on.
    const nextModel = detectModel(tracker.buffer) ?? tracker.model
    const resolvedContext = nextContext ?? tracker.contextUsedPercent
    if (
      nextStatus !== tracker.status ||
      resolvedContext !== tracker.contextUsedPercent ||
      nextModel !== tracker.model
    ) {
      tracker.status = nextStatus
      tracker.contextUsedPercent = resolvedContext
      tracker.model = nextModel
      this.emit({
        agentId: tracker.agentId,
        status: nextStatus,
        contextUsedPercent: resolvedContext,
        model: nextModel
      })
    }

    if (tracker.decayTimer) {
      clearTimeout(tracker.decayTimer)
      tracker.decayTimer = null
    }
    if (nextStatus !== 'idle') {
      tracker.decayTimer = setTimeout(() => {
        if (tracker.status !== 'idle') {
          tracker.status = 'idle'
          this.emit({
            agentId: tracker.agentId,
            status: 'idle',
            contextUsedPercent: tracker.contextUsedPercent,
            model: tracker.model
          })
        }
        tracker.decayTimer = null
      }, IDLE_DECAY_MS)
    }
  }

  release(terminalId: TerminalId): void {
    const tracker = this.trackers.get(terminalId)
    if (!tracker) return
    if (tracker.decayTimer) clearTimeout(tracker.decayTimer)
    this.trackers.delete(terminalId)
    this.emit({
      agentId: tracker.agentId,
      status: 'idle',
      contextUsedPercent: null,
      model: null
    })
  }

  disposeAll(): void {
    for (const tracker of this.trackers.values()) {
      if (tracker.decayTimer) clearTimeout(tracker.decayTimer)
    }
    this.trackers.clear()
  }
}
