import type { TicketsState } from '@shared/types'
import { listActiveTickets, syncTickets } from '../db/tickets'
import { lastJsonLine, lastLine, loginShell, parseListing } from './ticketCli'

/** Tickets arrive a few a day; a five-minute look is plenty. */
const POLL_MS = 5 * 60_000

export interface TicketWatcherDeps {
  /** The read-only checkout, moved to the latest main first. */
  scoutCheckout: () => Promise<string>
  /** The same checkout as it is: for a quick look after Tom changed a ticket. */
  scoutDir: () => Promise<string>
  /** Environment for launched commands, without the cockpit's secrets. */
  env: () => NodeJS.ProcessEnv
  emit: (state: TicketsState) => void
}

/**
 * Keeps Intake's live ticket list: polls `scripts/ticket.ts list --json`
 * for everything open or in progress. Work on a ticket starts when Tom
 * says so (Start job); nothing here acts on what a customer wrote.
 */
export class TicketWatcher {
  private readonly deps: TicketWatcherDeps
  private timer: NodeJS.Timeout | null = null
  private error: string | null = null
  private polledAt: number | null = null
  private busy = false
  /** A quick look was asked for while a poll ran; do it straight after. */
  private again = false

  constructor(deps: TicketWatcherDeps) {
    this.deps = deps
  }

  start(): void {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Look at the list now, after something changed a ticket. No git fetch first. */
  refresh(): void {
    void this.poll(true)
  }

  /** Send the stored list as it is, after a change recorded locally. */
  publish(): void {
    this.deps.emit(this.state())
  }

  state(): TicketsState {
    return { tickets: listActiveTickets(), error: this.error, polledAt: this.polledAt }
  }

  private async poll(quick = false): Promise<void> {
    if (this.busy) {
      // Never drop it: a refresh after a resolve must land, not wait for
      // the next five-minute poll.
      if (quick) this.again = true
      return
    }
    this.busy = true
    try {
      // A scheduled poll moves the checkout to the latest main first; a
      // quick look runs where it is.
      const dir = quick ? await this.deps.scoutDir() : await this.deps.scoutCheckout()
      const out = await loginShell(
        dir,
        'npx tsx scripts/ticket.ts list --json --limit 200',
        this.deps.env()
      )
      syncTickets(parseListing(lastJsonLine(out)))
      this.error = null
      this.polledAt = Date.now()
    } catch (err) {
      this.error = lastLine(err)
    } finally {
      this.busy = false
    }
    this.deps.emit(this.state())
    if (this.again) {
      this.again = false
      void this.poll(true)
    }
  }
}
