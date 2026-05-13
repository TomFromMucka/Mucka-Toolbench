import clsx from 'clsx'

interface ClipboardProps {
  title: string
  subtitle?: string
  /** When true, the clipboard glows brand orange — Tom's attention needed. */
  attention?: boolean
  /** Paper texture variant. */
  paper?: 'lined' | 'grid' | 'plain'
  rightSlot?: React.ReactNode
  children: React.ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * A "clipboard" panel: dark wooden clip header with a paper page below.
 * The visual primitive used everywhere in the workstation.
 */
export function Clipboard({
  title,
  subtitle,
  attention = false,
  paper = 'lined',
  rightSlot,
  children,
  className,
  bodyClassName
}: ClipboardProps): React.JSX.Element {
  const paperUtility =
    paper === 'lined'
      ? 'paper-lined'
      : paper === 'grid'
        ? 'paper-grid'
        : 'paper-plain'

  return (
    <section
      className={clsx(
        'relative flex flex-col overflow-hidden rounded-md border border-black/40 shadow-[0_6px_18px_rgba(0,0,0,0.45)]',
        attention && 'attention-glow',
        className
      )}
    >
      {/* Wooden clip header */}
      <header className="clip-header relative flex items-center gap-3 px-3 py-1.5">
        {/* metal screw nubs */}
        <span className="size-1.5 rounded-full bg-[#7a6a55] shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]" />
        <span className="size-1.5 rounded-full bg-[#7a6a55] shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)]" />
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="truncate font-[var(--font-display)] text-[1.05rem] font-semibold leading-none tracking-wide text-paper-cream">
            {title}
          </h2>
          {subtitle ? (
            <span className="truncate font-[var(--font-hand)] text-[0.78rem] text-paper-cream/55">
              {subtitle}
            </span>
          ) : null}
        </div>
        {rightSlot ? (
          <div className="shrink-0 text-[0.7rem] text-paper-cream/75">
            {rightSlot}
          </div>
        ) : null}
      </header>

      {/* Paper page */}
      <div
        className={clsx(
          paperUtility,
          'relative min-h-0 flex-1 text-ink',
          bodyClassName
        )}
      >
        {/* faint shadow under the clip onto the page */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-2 bg-gradient-to-b from-black/30 to-transparent" />
        {children}
      </div>
    </section>
  )
}
