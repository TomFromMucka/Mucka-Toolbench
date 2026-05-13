import clsx from 'clsx'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

const LABEL = {
  idle: 'Talk to Mucka',
  connecting: 'Connecting…',
  listening: 'Listening',
  speaking: 'Mucka',
  error: 'Voice issue'
} as const

export function MuckaVoiceButton(): React.JSX.Element {
  const { state, credentialStatus, error, toggle, openMicSettings } =
    useMuckaSession()

  const unavailable = credentialStatus.kind !== 'ok'
  const title = unavailable
    ? credentialStatus.kind === 'missing-key'
      ? 'Set ELEVENLABS_API_KEY in your env to enable voice'
      : credentialStatus.kind === 'missing-agent'
        ? 'Set MUCKA_AGENT_ID in your env to enable voice'
        : credentialStatus.kind === 'error'
          ? credentialStatus.message
          : 'Voice unavailable'
    : error
      ? error
      : state === 'idle'
        ? 'Start a conversation with Mucka (⌘M)'
        : 'End conversation (⌘M)'

  const active =
    state === 'connecting' ||
    state === 'listening' ||
    state === 'speaking'

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={unavailable}
        title={title}
        aria-label={LABEL[state]}
        className={clsx(
          'group inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.78rem] font-semibold uppercase tracking-[0.14em] transition-colors',
          unavailable &&
            'cursor-not-allowed border-paper-cream/20 bg-mucka-deep/20 text-paper-cream/45',
          !unavailable &&
            !active &&
            'border-paper-cream/35 bg-mucka-deep/30 text-paper-cream hover:bg-mucka-deep/60',
          !unavailable &&
            active &&
            'border-paper-cream/70 bg-paper-cream/20 text-paper-cream'
        )}
      >
        {/* mic glyph */}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
          <path d="M12 19v3" />
        </svg>
        <span>{LABEL[state]}</span>
        {active ? <span className="mucka-live-pip" aria-hidden /> : null}
      </button>

      {state === 'error' &&
      error?.toLowerCase().includes('microphone access') ? (
        <button
          type="button"
          onClick={openMicSettings}
          className="rounded-full border border-paper-cream/35 bg-mucka-deep/40 px-2 py-1 text-[0.7rem] uppercase tracking-wide text-paper-cream hover:bg-mucka-deep/70"
          title="Open System Settings → Privacy → Microphone"
        >
          Fix
        </button>
      ) : null}
    </div>
  )
}
