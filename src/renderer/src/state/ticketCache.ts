import type { TicketDetail } from '@shared/types'

/**
 * Tickets already read this session. Hovering a row fetches it, so by the
 * click it's usually here; the modal still refetches in the background so
 * what it shows is never more than a moment old.
 */
const details = new Map<string, TicketDetail>()
const inFlight = new Map<string, Promise<TicketDetail>>()

export function cachedTicket(reference: string): TicketDetail | null {
  return details.get(reference) ?? null
}

export function loadTicket(reference: string): Promise<TicketDetail> {
  const running = inFlight.get(reference)
  if (running) return running
  const p = window.mucka
    .getTicket(reference)
    .then((d) => {
      details.set(reference, d)
      return d
    })
    .finally(() => inFlight.delete(reference))
  inFlight.set(reference, p)
  return p
}

export function prefetchTicket(reference: string): void {
  if (details.has(reference) || inFlight.has(reference)) return
  loadTicket(reference).catch(() => {
    // A hover that fails is retried by the click, which shows the error.
  })
}
