import clsx from 'clsx'
import { Maximize2, Minimize2, Equal } from 'lucide-react'
import { Icon } from './ui/Icon'
import type { PanelSize } from './panelSize'

interface ClipboardProps {
  title: string
  subtitle?: React.ReactNode
  /** When true, the card glows brand orange — Tom's attention needed. */
  attention?: boolean
  /**
   * Legacy paper-texture prop. Ignored in the v2 design system; kept
   * on the API so callers don't all need updating at once. Slice 4
   * will sweep this prop out.
   */
  paper?: 'lined' | 'grid' | 'plain'
  rightSlot?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
  /** When set, renders a min/mid/max size control in the header. The
   *  body stays MOUNTED at every size (hidden via CSS when 'min') so
   *  live content — terminals especially — keeps running. */
  size?: PanelSize
  onResize?: (size: PanelSize) => void
}

const SIZE_OPTIONS: { value: PanelSize; icon: typeof Equal; label: string }[] = [
  { value: 'min', icon: Minimize2, label: 'Minimise (header only)' },
  { value: 'mid', icon: Equal, label: 'Medium' },
  { value: 'max', icon: Maximize2, label: 'Maximise' }
]

/**
 * The cockpit's universal panel — a chamfered (octagonal) card with a
 * charcoal header band and a light interior. Pure Mucka brand
 * silhouette; replaces the wooden-clip-on-paper metaphor from the
 * pre-v2 cockpit.
 */
export function Clipboard({
  title,
  subtitle,
  attention = false,
  rightSlot,
  children,
  className,
  bodyClassName,
  size = 'mid',
  onResize
}: ClipboardProps): React.JSX.Element {
  const isMin = size === 'min'
  return (
    <section
      className={clsx(
        'relative flex min-h-0 flex-col overflow-hidden bg-surface chamfer-card',
        attention && 'attention-glow',
        isMin && onResize && 'cursor-pointer',
        className
      )}
      onClick={isMin && onResize ? () => onResize('mid') : undefined}
      title={isMin && onResize ? 'Click to restore' : undefined}
    >
      <header
        className="flex items-center gap-2 py-2"
        style={{
          background: 'var(--charcoal)',
          color: 'var(--van-white)',
          /* Inset past the 14px corner chamfers so the title's first
             glyph + the right-slot tail clear the diagonal cuts. */
          paddingLeft: 'calc(var(--notch-card) + 8px)',
          paddingRight: 'calc(var(--notch-card) + 8px)'
        }}
      >
        <h2
          className="min-w-0 flex-shrink truncate"
          style={{
            fontFamily: 'var(--font-soehne-breit), system-ui, sans-serif',
            fontWeight: 500,
            fontSize: '17px',
            letterSpacing: '-0.005em',
            lineHeight: 1
          }}
        >
          {title}
        </h2>
        {subtitle ? (
          <span
            className="min-w-0 flex-1 truncate"
            style={{
              fontFamily: 'var(--font-soehne), system-ui, sans-serif',
              fontWeight: 400,
              fontSize: '12px',
              color: 'rgba(234, 233, 232, 0.65)'
            }}
          >
            {subtitle}
          </span>
        ) : null}
        {rightSlot ? (
          <div
            className="shrink-0"
            style={{
              fontFamily: 'var(--font-soehne), system-ui, sans-serif',
              fontSize: '11px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'rgba(234, 233, 232, 0.85)'
            }}
          >
            {rightSlot}
          </div>
        ) : null}
        {onResize ? (
          <div className="flex shrink-0 items-center gap-0.5 rounded-sm bg-van-white/5 p-0.5">
            {SIZE_OPTIONS.map((opt) => {
              const active = size === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onResize(opt.value)
                  }}
                  title={opt.label}
                  aria-label={opt.label}
                  aria-pressed={active}
                  className={clsx(
                    'grid size-5 place-items-center rounded-sm transition-colors',
                    active ? 'bg-van-white/20' : 'hover:bg-van-white/12'
                  )}
                  style={{ color: active ? 'var(--orange)' : 'var(--van-white)' }}
                >
                  <Icon icon={opt.icon} size={11} strokeWidth={2.25} />
                </button>
              )
            })}
          </div>
        ) : null}
      </header>

      <div
        className={clsx('relative min-h-0 flex-1', isMin && 'hidden', bodyClassName)}
        style={{ color: 'var(--charcoal)' }}
      >
        {children}
      </div>
    </section>
  )
}
