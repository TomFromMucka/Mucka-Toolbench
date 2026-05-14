import type { ReactNode } from 'react'
import { cn } from './cn'

export type StatusVariant =
  | 'on-site'
  | 'scheduled'
  | 'pending'
  | 'completed'
  | 'quote-sent'
  | 'cancelled'

const VARIANT: Record<
  StatusVariant,
  { bg: string; fg: string; label: string }
> = {
  'on-site': {
    bg: 'var(--pill-onsite-bg)',
    fg: 'var(--pill-onsite-fg)',
    label: 'On Site'
  },
  scheduled: {
    bg: 'var(--pill-scheduled-bg)',
    fg: 'var(--pill-scheduled-fg)',
    label: 'Scheduled'
  },
  pending: {
    bg: 'var(--pill-pending-bg)',
    fg: 'var(--pill-pending-fg)',
    label: 'Pending'
  },
  completed: {
    bg: 'var(--pill-completed-bg)',
    fg: 'var(--pill-completed-fg)',
    label: 'Completed'
  },
  'quote-sent': {
    bg: 'var(--pill-quote-bg)',
    fg: 'var(--pill-quote-fg)',
    label: 'Quote Sent'
  },
  cancelled: {
    bg: 'var(--pill-cancelled-bg)',
    fg: 'var(--pill-cancelled-fg)',
    label: 'Cancelled'
  }
}

export interface StatusPillProps {
  variant: StatusVariant
  children?: ReactNode
  className?: string
}

/**
 * Brand-aligned status pill. Six variants — orange tones for "Mucka
 * actively engaged" (on-site / pending), green for finished work
 * (completed / quote-sent), grey for inert states (scheduled /
 * cancelled). Locked to the same vocabulary as Mucka Pro mobile.
 */
export function StatusPill({
  variant,
  children,
  className
}: StatusPillProps): React.JSX.Element {
  const v = VARIANT[variant]
  return (
    <span
      className={cn('mucka-pill', className)}
      style={{ background: v.bg, color: v.fg }}
    >
      {children ?? v.label}
    </span>
  )
}
