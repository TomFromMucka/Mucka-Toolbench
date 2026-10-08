import { THEME } from './terminalTheme'

/** A terminal-style button: `[ label ]`. */
export function TermButton({
  children,
  onClick,
  disabled,
  title,
  tone = 'normal'
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
  tone?: 'normal' | 'dim' | 'danger'
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className="shrink-0 px-1.5 text-left hover:bg-[rgba(234,233,232,0.1)] disabled:opacity-50"
      style={{
        fontFamily: 'inherit',
        color:
          tone === 'danger'
            ? THEME.brightRed
            : tone === 'dim'
              ? 'var(--dirty-grey)'
              : THEME.brightWhite
      }}
    >
      [ {children} ]
    </button>
  )
}

export function Dim({
  children,
  error = false
}: {
  children: React.ReactNode
  error?: boolean
}): React.JSX.Element {
  return (
    <span className="px-3 py-2" style={{ color: error ? THEME.brightRed : 'var(--dirty-grey)' }}>
      {children}
    </span>
  )
}
