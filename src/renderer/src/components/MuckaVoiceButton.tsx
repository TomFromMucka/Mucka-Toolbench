import clsx from 'clsx'
import { useMuckaSession } from '../mucka/MuckaSessionContext'

const LABEL = {
  idle: 'Talk to Mucka',
  connecting: 'Connecting…',
  listening: 'Listening',
  speaking: 'Mucka',
  error: 'Voice issue'
} as const

const BOLT_STATIC = '/brand/mucka-bolt-static.png'
const BOLT_ANIMATED = '/brand/mucka-bolt.gif'

/**
 * Voice-toggle button rendered as the Mucka bolt mark. Idle/disconnected
 * shows the static PNG; an active voice session (listening or speaking)
 * swaps to the animated GIF. Bitmap assets — never CSS-filter them.
 */
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

  const live = state === 'listening' || state === 'speaking'
  const connecting = state === 'connecting'

  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={unavailable}
        title={title}
        aria-label={LABEL[state]}
        className={clsx(
          'grid shrink-0 place-items-center overflow-hidden transition-opacity',
          unavailable && 'cursor-not-allowed opacity-40',
          !unavailable && !live && 'opacity-80 hover:opacity-100',
          connecting && 'animate-pulse'
        )}
        style={{
          height: '34px',
          width: '34px',
          background: 'transparent'
        }}
      >
        {/* The source asset has ~40% transparent padding around the
            hex-bolt mark. Render it larger than the button and clip the
            padding so the mark fills the visible 34×34 area. */}
        <img
          src={live ? BOLT_ANIMATED : BOLT_STATIC}
          alt=""
          aria-hidden
          draggable={false}
          style={{
            display: 'block',
            height: '56px',
            width: '56px',
            objectFit: 'contain'
          }}
        />
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
