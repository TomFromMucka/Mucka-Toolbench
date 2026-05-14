import clsx from 'clsx'
import { useMuckaSession } from '../mucka/MuckaSessionContext'
import { MuckaVoiceButton } from './MuckaVoiceButton'

interface MuckaTopBannerProps {
  onOpenSettings: () => void
}

const IDLE_LINE = 'Mucka is here when you need her — hit ⌘M to talk.'

export function MuckaTopBanner({
  onOpenSettings
}: MuckaTopBannerProps): React.JSX.Element {
  const { state, lastMucka, ambientStatus, error } = useMuckaSession()

  const line =
    state === 'error' && error
      ? error
      : state === 'connecting'
        ? 'Connecting to Mucka…'
        : (ambientStatus ?? lastMucka ?? IDLE_LINE)

  const isLive = state === 'listening' || state === 'speaking'

  return (
    <header
      className={clsx(
        'relative flex items-center gap-4 px-5 py-2 transition-colors',
        isLive ? 'bg-orange-glow' : 'bg-orange'
      )}
      style={{ color: 'var(--charcoal)' }}
    >
      <div className="flex shrink-0 items-center gap-3">
        <span
          role="img"
          aria-label="Mucka"
          className="block"
          style={{
            width: '40px',
            height: '26px',
            background: 'var(--charcoal)',
            WebkitMaskImage: 'url(/brand/mucka-icon-m.svg)',
            maskImage: 'url(/brand/mucka-icon-m.svg)',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskPosition: 'left center',
            maskPosition: 'left center'
          }}
        />
        <span
          role="img"
          aria-label="Mucka Workstation"
          className="block"
          style={{
            width: '128px',
            height: '22px',
            background: 'var(--charcoal)',
            WebkitMaskImage: 'url(/brand/mucka-wordmark.svg)',
            maskImage: 'url(/brand/mucka-wordmark.svg)',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskPosition: 'left center',
            maskPosition: 'left center'
          }}
        />
        <span
          className="ml-1 text-[0.68rem] uppercase tracking-[0.22em]"
          style={{ color: 'rgba(35, 31, 32, 0.55)' }}
        >
          Workstation
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="t-body-md truncate leading-tight"
          style={{ color: 'var(--charcoal)' }}
        >
          <span className="opacity-65">PM:</span>{' '}
          <span style={{ fontWeight: 500 }}>{line}</span>
        </p>
      </div>

      <MuckaVoiceButton />

      <button
        type="button"
        onClick={onOpenSettings}
        title="Settings (⌘,)"
        aria-label="Open settings"
        className="chamfer-sm ml-1 grid size-8 shrink-0 place-items-center"
        style={{
          background: 'rgba(35, 31, 32, 0.18)',
          color: 'var(--charcoal)'
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  )
}
