let cachedCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (cachedCtx) return cachedCtx
  if (typeof window === 'undefined') return null
  const AC: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AC) return null
  cachedCtx = new AC()
  return cachedCtx
}

/**
 * Short two-tone chime — plays when Mucka's voice session reaches
 * `connected`. Replaces her old spoken welcome line so the connection is
 * acknowledged without making her talk first.
 */
export function playConnectionChime(): void {
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  const now = ctx.currentTime

  const beep = (freq: number, start: number, dur: number, peak: number): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(ctx.destination)
    const t0 = now + start
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  // A clean major-third ascent: A5 → C#6.
  beep(880, 0, 0.12, 0.12)
  beep(1108.73, 0.1, 0.18, 0.14)
}

/**
 * Attention chime — plays when an agent flips `needsAttention` true.
 * A "tap-tap-ping" descending-then-rising motif so it's clearly distinct
 * from the connection chime and reads as "Tom, eyes here".
 */
export function playAttentionChime(): void {
  const ctx = getCtx()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    void ctx.resume()
  }
  const now = ctx.currentTime

  const beep = (
    freq: number,
    start: number,
    dur: number,
    peak: number,
    type: OscillatorType = 'triangle'
  ): void => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(gain)
    gain.connect(ctx.destination)
    const t0 = now + start
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  // E6 (1318.5) → C6 (1046.5) → G6 (1568): two short taps + a higher ping.
  beep(1318.5, 0, 0.08, 0.11)
  beep(1046.5, 0.09, 0.08, 0.1)
  beep(1568.0, 0.22, 0.22, 0.13, 'sine')
}
