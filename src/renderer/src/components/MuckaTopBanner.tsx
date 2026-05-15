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
      className="relative flex items-center gap-4 px-5 py-2 transition-colors"
      style={{
        background: 'var(--charcoal)',
        color: 'var(--van-white)',
        /* Subtle orange ribbon underneath when a voice session is live. */
        boxShadow: isLive ? 'inset 0 -2px 0 var(--orange)' : 'none'
      }}
    >
      <div className="flex shrink-0 items-center gap-3">
        <span
          role="img"
          aria-label="Mucka"
          className="block"
          style={{
            width: '40px',
            height: '26px',
            background: 'var(--orange)',
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
          className="text-[0.68rem] uppercase tracking-[0.22em]"
          style={{ color: 'rgba(234, 233, 232, 0.55)' }}
        >
          Toolbench
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="t-body-md truncate leading-tight"
          style={{ color: 'var(--van-white)' }}
        >
          <span style={{ opacity: 0.55 }}>PM:</span>{' '}
          <span style={{ fontWeight: 500 }}>{line}</span>
        </p>
      </div>

      <MuckaVoiceButton />

      <button
        type="button"
        onClick={onOpenSettings}
        title="Settings (⌘,)"
        aria-label="Open settings"
        className="chamfer-sm ml-1 grid size-8 shrink-0 place-items-center hover:bg-van-white/15"
        style={{
          background: 'rgba(234, 233, 232, 0.08)',
          color: 'var(--van-white)'
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
