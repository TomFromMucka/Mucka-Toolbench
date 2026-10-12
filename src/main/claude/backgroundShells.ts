import { execFile } from 'node:child_process'

/**
 * Which cockpit terminals have a Claude with something still running in
 * the background: a Monitor, or a command it sent off to run on its own.
 *
 * Claude's turn ends as soon as it starts one, so its hooks say "idle"
 * while the work carries on, and the card dropped into Waiting on you for
 * the whole half hour a Monitor watched CI. Each such command runs in a
 * shell Claude spawns from its own shell snapshot, so it shows up as a
 * child process; that's what this looks for. Reading the process table is
 * not reading the PTY stream: it doesn't depend on what the TUI drew.
 */

const SHELL_MARK = '/.claude/shell-snapshots/'

/**
 * Past this a background command stops counting as work. Monitors expire
 * at 30 minutes anyway; anything older is usually a dev server left
 * running, and it mustn't hide a finished Claude from Tom for ever.
 */
export const BACKGROUND_CAP_MS = 30 * 60_000

interface Proc {
  pid: number
  ppid: number
  elapsedMs: number
  command: string
}

/** `ps` etime: `[[dd-]hh:]mm:ss`. */
export function parseElapsed(etime: string): number {
  const [days, clock] = etime.includes('-') ? etime.split('-', 2) : ['0', etime]
  const parts = clock.split(':').map(Number)
  while (parts.length < 3) parts.unshift(0)
  const [h, m, s] = parts
  return (((Number(days) * 24 + h) * 60 + m) * 60 + s) * 1000
}

function parsePs(output: string): Proc[] {
  const procs: Proc[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    procs.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      elapsedMs: parseElapsed(match[3]),
      command: match[4]
    })
  }
  return procs
}

/** Terminals with a background shell younger than `capMs` anywhere under their PTY. */
export function busyTerminals(
  psOutput: string,
  roots: ReadonlyMap<string, number>,
  capMs: number = BACKGROUND_CAP_MS
): Set<string> {
  const children = new Map<number, Proc[]>()
  for (const proc of parsePs(psOutput)) {
    const list = children.get(proc.ppid)
    if (list) list.push(proc)
    else children.set(proc.ppid, [proc])
  }
  const busy = new Set<string>()
  for (const [terminalId, rootPid] of roots) {
    const stack = [...(children.get(rootPid) ?? [])]
    while (stack.length > 0) {
      const proc = stack.pop()
      if (!proc) break
      if (proc.command.includes(SHELL_MARK) && proc.elapsedMs < capMs) {
        busy.add(terminalId)
        break
      }
      stack.push(...(children.get(proc.pid) ?? []))
    }
  }
  return busy
}

export function readProcessTable(): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'ps',
      ['-A', '-o', 'pid=,ppid=,etime=,command='],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => resolve(err ? '' : stdout)
    )
  })
}
