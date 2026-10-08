import type { TicketsState } from '@shared/types'
import { listActiveTickets, syncTickets } from '../db/tickets'
import { lastJsonLine, lastLine, loginShell, parseListing } from './ticketCli'

/** Tickets arrive a few a day; a five-minute look is plenty. */
const POLL_MS = 5 * 60_000

export interface TicketWatcherDeps {
  /** The read-only checkout of the latest main to run from. */
  scoutCheckout: () => Promise<string>
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

  /** Look at the list now, after something changed a ticket. */
  refresh(): void {
    void this.poll()
  }

  state(): TicketsState {
    return { tickets: listActiveTickets(), error: this.error, polledAt: this.polledAt }
  }

  private async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      // Moves the checkout to the latest main, so ticket.ts is current.
      const dir = await this.deps.scoutCheckout()
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
  }
}
