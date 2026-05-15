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
 * Pull the context window % out of Claude Code's TUI footer. The
 * format has drifted slightly between TUI revisions, so try a few
 * shapes. Returns null when no plausible match is in the tail.
 */
function detectContextPercent(buffer: string): number | null {
  const tail = buffer.slice(-SCAN_TAIL_BYTES)
  const patterns: RegExp[] = [
    /context\s+left\s+until\s+auto-compact[:\s]+(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s+context\s+(?:left|remaining)/i,
    /context[:\s]+(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%\s*·?\s*context/i
  ]
  for (const re of patterns) {
    const m = tail.match(re)
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n
  }
  return null
}

interface Tracker {
  agentId: AgentId
  buffer: string
  status: AgentStatus
  contextPercent: number | null
  decayTimer: NodeJS.Timeout | null
}

export interface StatusEmit {
  agentId: AgentId
  status: AgentStatus
  contextPercent: number | null
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
      contextPercent: null,
      decayTimer: null
    })
    this.emit({ agentId, status: 'idle', contextPercent: null })
  }

  ingest(terminalId: TerminalId, data: string): void {
    const tracker = this.trackers.get(terminalId)
    if (!tracker) return

    const stripped = stripAnsi(data)
    tracker.buffer = (tracker.buffer + stripped).slice(-TAIL_BYTES)

    const nextStatus = detectStatus(tracker.buffer)
    const nextContext = detectContextPercent(tracker.buffer)
    const statusChanged = nextStatus !== tracker.status
    const contextChanged = nextContext !== tracker.contextPercent
    if (statusChanged || contextChanged) {
      tracker.status = nextStatus
      tracker.contextPercent = nextContext
      this.emit({
        agentId: tracker.agentId,
        status: nextStatus,
        contextPercent: nextContext
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
            contextPercent: tracker.contextPercent
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
    this.emit({ agentId: tracker.agentId, status: 'idle', contextPercent: null })
  }

  disposeAll(): void {
    for (const tracker of this.trackers.values()) {
      if (tracker.decayTimer) clearTimeout(tracker.decayTimer)
    }
    this.trackers.clear()
  }
}
