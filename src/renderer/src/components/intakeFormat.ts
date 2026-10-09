import type { Ticket } from '@shared/types'

export function ago(ms: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ms) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function when(ms: number | null): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function bytes(n: number | null): string {
  if (n === null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * /admin/support's follow-up rule (src/lib/admin/follow-up.ts): an open or
 * in-progress ticket quiet for two days. "chase" when we spoke last, so it's
 * on them; "follow up" when it's on us.
 */
export function followUp(t: Ticket, now: number): { days: number; label: string } | null {
  if (t.status !== 'open' && t.status !== 'in_progress') return null
  const elapsed = now - t.updatedAt
  if (!t.updatedAt || elapsed < 2 * DAY_MS) return null
  return {
    days: Math.floor(elapsed / DAY_MS),
    label: t.lastAuthor === 'admin' ? 'chase' : 'follow up'
  }
}

/** Follow-ups first, most overdue at the top; then most recently touched. */
export function sortTickets(tickets: Ticket[], now: number): Ticket[] {
  return [...tickets].sort((a, b) => {
    const fa = followUp(a, now)
    const fb = followUp(b, now)
    if (fa && !fb) return -1
    if (fb && !fa) return 1
    if (fa && fb) return a.updatedAt - b.updatedAt
    return b.updatedAt - a.updatedAt
  })
}

export const STATUS_LABELS: Record<string, string> = {
  open: 'open',
  in_progress: 'in progress',
  resolved: 'resolved',
  closed: 'closed'
}

export const CATEGORY_LABELS: Record<string, string> = {
  bug: 'bug',
  feature_request: 'feature request',
  migration: 'migration',
  early_access: 'early access'
}
