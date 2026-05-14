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
          'group chamfer-sm inline-flex items-center gap-2 px-3 py-1.5 text-[0.72rem] uppercase tracking-[0.14em] transition-colors',
          unavailable && 'cursor-not-allowed'
        )}
        style={{
          fontFamily: 'var(--font-soehne)',
          fontWeight: 500,
          /* On the charcoal banner: active = primary orange (brand
             "engaged" channel), idle = subtle van-white wash, disabled
             = even fainter. */
          background: unavailable
            ? 'rgba(234, 233, 232, 0.05)'
            : active
              ? 'var(--orange)'
              : 'rgba(234, 233, 232, 0.10)',
          color: unavailable
            ? 'rgba(234, 233, 232, 0.35)'
            : active
              ? 'var(--charcoal)'
              : 'var(--van-white)'
        }}
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
          className="chamfer-sm px-2 py-1 text-[0.68rem] uppercase tracking-wide"
          style={{
            background: 'var(--orange)',
            color: 'var(--charcoal)',
            fontFamily: 'var(--font-soehne)',
            fontWeight: 500
          }}
          title="Open System Settings → Privacy → Microphone"
        >
          Fix
        </button>
      ) : null}
    </div>
  )
}
