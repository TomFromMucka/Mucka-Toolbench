import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Monitor, RotateCw, Smartphone, Tablet, X } from 'lucide-react'
import type { AgentConfig } from '@shared/types'
import { Clipboard } from './Clipboard'
import { Icon } from './ui/Icon'

interface BrowserPreviewProps {
  slotId: 'left' | 'right'
  agent: AgentConfig | null
}

type PresetId =
  | 'fit'
  | 'iphone-se'
  | 'iphone-14'
  | 'iphone-14-pro'
  | 'iphone-14-pro-max'
  | 'pixel-7'
  | 'galaxy-s22'
  | 'galaxy-s22-ultra'
  | 'ipad-mini'
  | 'ipad-pro-11'
  | 'ipad-pro-13'
  | 'galaxy-tab-s8'
  | 'galaxy-tab-s8-plus'
  | 'desktop-sm'
  | 'desktop'
  | 'desktop-lg'

type DeviceClass = 'phone' | 'tablet' | 'desktop'

interface Preset {
  id: PresetId
  label: string
  width: number
  height: number
  device: DeviceClass
}

const PRESETS: Preset[] = [
  { id: 'iphone-se', label: 'iPhone SE', width: 375, height: 667, device: 'phone' },
  { id: 'iphone-14', label: 'iPhone 14', width: 390, height: 844, device: 'phone' },
  { id: 'iphone-14-pro', label: 'iPhone 14 Pro', width: 393, height: 852, device: 'phone' },
  { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430, height: 932, device: 'phone' },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, device: 'phone' },
  { id: 'galaxy-s22', label: 'Galaxy S22', width: 360, height: 780, device: 'phone' },
  { id: 'galaxy-s22-ultra', label: 'Galaxy S22 Ultra', width: 384, height: 824, device: 'phone' },
  { id: 'ipad-mini', label: 'iPad Mini', width: 768, height: 1024, device: 'tablet' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834, height: 1194, device: 'tablet' },
  { id: 'ipad-pro-13', label: 'iPad Pro 13"', width: 1024, height: 1366, device: 'tablet' },
  { id: 'galaxy-tab-s8', label: 'Galaxy Tab S8', width: 800, height: 1280, device: 'tablet' },
  { id: 'galaxy-tab-s8-plus', label: 'Galaxy Tab S8+', width: 853, height: 1366, device: 'tablet' },
  { id: 'desktop-sm', label: 'Desktop · 1280', width: 1280, height: 800, device: 'desktop' },
  { id: 'desktop', label: 'Desktop · 1440', width: 1440, height: 900, device: 'desktop' },
  { id: 'desktop-lg', label: 'Desktop · 1920', width: 1920, height: 1080, device: 'desktop' }
]

function findPreset(id: PresetId): Preset | null {
  if (id === 'fit') return null
  return PRESETS.find((p) => p.id === id) ?? null
}

export function BrowserPreview({
  slotId,
  agent
}: BrowserPreviewProps): React.JSX.Element {
  const [reloadKey, setReloadKey] = useState(0)
  const [presetId, setPresetId] = useState<PresetId>('fit')
  const [landscape, setLandscape] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [bodyRect, setBodyRect] = useState<DOMRect | null>(null)

  const configuredUrl = agent?.previewUrl ?? null
  const subtitle = agent ? `${agent.displayName.toLowerCase()} · preview` : 'no agent'
  const placeholderPort = slotId === 'left' ? '3001' : '3002'

  // src = what the iframe is actually loading right now. Starts from the
  // agent's configured previewUrl and can be moved around via the URL
  // bar without persisting back to the config.
  const [src, setSrc] = useState<string | null>(configuredUrl)
  const [barValue, setBarValue] = useState<string>(configuredUrl ?? '')

  // Re-sync when the agent's configured URL changes (Settings edit, or
  // the preview button binds a new localhost server). React's canonical
  // "reset state on prop change" pattern.
  const [prevConfigured, setPrevConfigured] = useState<string | null>(configuredUrl)
  if (prevConfigured !== configuredUrl) {
    setPrevConfigured(configuredUrl)
    setSrc(configuredUrl)
    setBarValue(configuredUrl ?? '')
  }

  const url = src
  const preset = findPreset(presetId)
  const inDeviceMode = preset !== null && url !== null
  const deviceW = preset ? (landscape ? preset.height : preset.width) : 0
  const deviceH = preset ? (landscape ? preset.width : preset.height) : 0

  const navigateTo = (raw: string): void => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return
    const base = src ?? configuredUrl ?? `http://localhost:${placeholderPort}`
    let next: string
    try {
      next = new URL(trimmed, base).toString()
    } catch {
      // Last-ditch — let Chromium try to make sense of it as-is.
      next = trimmed
    }
    setSrc(next)
    setBarValue(next)
  }

  // Track the body area's screen position so the portaled iframe stays
  // anchored to the panel even as the cockpit reflows.
  useLayoutEffect(() => {
    if (!inDeviceMode) {
      setBodyRect(null)
      return
    }
    const el = bodyRef.current
    if (!el) return
    const update = (): void => setBodyRect(el.getBoundingClientRect())
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [inDeviceMode])

  // Esc closes device mode — match the macOS muscle memory.
  useEffect(() => {
    if (!inDeviceMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPresetId('fit')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inDeviceMode])

  return (
    <Clipboard
      title="Preview"
      subtitle={subtitle}
      rightSlot={
        <div className="flex items-center gap-1.5">
          <DeviceSelect
            value={presetId}
            onChange={(id) => setPresetId(id)}
            disabled={!url}
          />
          {preset ? (
            <button
              type="button"
              onClick={() => setLandscape((v) => !v)}
              title={landscape ? 'Switch to portrait' : 'Rotate to landscape'}
              aria-label="Rotate device"
              className="grid size-6 place-items-center rounded-sm transition-colors hover:bg-van-white/15"
              style={{ color: 'var(--van-white)' }}
            >
              <Icon icon={RotateCw} size={12} strokeWidth={2.25} />
            </button>
          ) : null}
          {url ? (
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="t-label-sm chamfer-sm px-2 py-0.5"
              style={{
                background: 'rgba(234, 233, 232, 0.12)',
                color: 'var(--van-white)'
              }}
              title="Reload iframe"
            >
              reload
            </button>
          ) : (
            <span className="font-mono text-[0.65rem] text-dirty-grey">no url</span>
          )}
        </div>
      }
      className="min-h-0"
      bodyClassName="bg-surface-2"
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className="flex items-center gap-2 border-b px-2 py-1"
          style={{ background: 'var(--charcoal)', borderColor: 'var(--border)' }}
        >
          <div className="flex gap-1.5">
            <span className="size-2 rounded-full" style={{ background: '#ff5f57' }} />
            <span className="size-2 rounded-full" style={{ background: '#febc2e' }} />
            <span className="size-2 rounded-full" style={{ background: '#28c840' }} />
          </div>
          <input
            type="text"
            value={barValue}
            onChange={(e) => setBarValue(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                navigateTo(barValue)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setBarValue(src ?? '')
                e.currentTarget.blur()
              }
            }}
            spellCheck={false}
            placeholder={`http://localhost:${placeholderPort}`}
            title="Type a URL or /path — Enter navigates · Esc reverts"
            className="ml-1 chamfer-sm flex-1 px-2 py-1 font-mono text-[0.7rem] focus:outline-none"
            style={{
              background: 'var(--surface2)',
              color: barValue === (src ?? '') ? 'var(--dirty-grey)' : 'var(--van-white)',
              border: '1px solid transparent'
            }}
          />
        </div>

        <div
          ref={bodyRef}
          className="relative min-h-0 flex-1 overflow-hidden"
        >
          {url ? (
            inDeviceMode ? (
              <DevicePanelBackdrop preset={preset} landscape={landscape} />
            ) : (
              <iframe
                // Stable key so URL-bar navigations update src in place
                // (cookies + session state preserved). Reload bumps
                // reloadKey to force a remount.
                key={`${slotId}#${reloadKey}`}
                title={`preview-${slotId}`}
                src={url}
                className="size-full border-0"
                /*
                Deliberately no `sandbox` attribute. Tightening it broke
                login flows (cookies + magic-link popups) on dev servers
                running at localhost. Trade-off: full iframe powers for
                what is, by definition, your own code on your machine.
                Cookies + localStorage persist across cockpit restarts
                via Electron's default persistent session in userData.
              */
              />
            )
          ) : (
            <div className="grid h-full place-items-center px-4">
              <div
                className="chamfer-card w-full p-4 t-body-md leading-snug"
                style={{
                  background: 'var(--surface)',
                  color: 'var(--dirty-grey)'
                }}
              >
                <p className="t-heading-md text-van-white">
                  {agent
                    ? `No preview URL set for ${agent.displayName}.`
                    : 'No agent assigned to this preview slot.'}
                </p>
                <p className="mt-2 t-body-sm text-dirty-grey">
                  Set one in Settings (⌘,) — point it at the agent&apos;s dev
                  server (e.g. http://localhost:{placeholderPort}).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {inDeviceMode && bodyRect && url ? (
        <DeviceOverlay
          url={url}
          width={deviceW}
          height={deviceH}
          anchorRect={bodyRect}
          reloadKey={reloadKey}
          slotId={slotId}
          onClose={() => setPresetId('fit')}
        />
      ) : null}
    </Clipboard>
  )
}

function DeviceSelect({
  value,
  onChange,
  disabled
}: {
  value: PresetId
  onChange: (id: PresetId) => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as PresetId)}
      disabled={disabled}
      title="Preview viewport"
      className="chamfer-sm px-1.5 py-0.5 text-[0.65rem] focus:outline-none"
      style={{
        fontFamily: 'var(--font-soehne)',
        background: 'rgba(234, 233, 232, 0.12)',
        color: 'var(--van-white)',
        border: 'none',
        appearance: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1
      }}
    >
      <option value="fit">Fit</option>
      <optgroup label="Phone">
        {PRESETS.filter((p) => p.device === 'phone').map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Tablet">
        {PRESETS.filter((p) => p.device === 'tablet').map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="Desktop">
        {PRESETS.filter((p) => p.device === 'desktop').map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

function DevicePanelBackdrop({
  preset,
  landscape
}: {
  preset: Preset
  landscape: boolean
}): React.JSX.Element {
  const w = landscape ? preset.height : preset.width
  const h = landscape ? preset.width : preset.height
  const DeviceIcon =
    preset.device === 'phone'
      ? Smartphone
      : preset.device === 'tablet'
        ? Tablet
        : Monitor
  return (
    <div
      className="grid h-full place-items-center px-4"
      style={{ background: 'var(--surface2)' }}
    >
      <div
        className="flex flex-col items-center gap-1 text-center"
        style={{ color: 'var(--dirty-grey)' }}
      >
        <Icon icon={DeviceIcon} size={20} strokeWidth={2} className="opacity-60" />
        <p className="t-label-sm">{preset.label}</p>
        <p className="font-mono text-[0.7rem]">
          {w} × {h}
        </p>
        <p className="mt-1 text-[0.65rem] opacity-70">Esc to return to Fit</p>
      </div>
    </div>
  )
}

function DeviceOverlay({
  url,
  width,
  height,
  anchorRect,
  reloadKey,
  slotId,
  onClose
}: {
  url: string
  width: number
  height: number
  anchorRect: DOMRect
  reloadKey: number
  slotId: 'left' | 'right'
  onClose: () => void
}): React.JSX.Element {
  // Shift the overlay left/up when the device size would otherwise spill
  // off-screen. Right edge pins to `window.innerWidth - MARGIN` so wide
  // desktop sizes (1440, 1920) stay fully visible from the right column.
  const MARGIN = 12
  const viewportRight = window.innerWidth - MARGIN
  const viewportBottom = window.innerHeight - MARGIN
  const wantedLeft = anchorRect.left
  const wantedTop = anchorRect.top
  const left =
    wantedLeft + width > viewportRight
      ? Math.max(MARGIN, viewportRight - width)
      : wantedLeft
  const top =
    wantedTop + height > viewportBottom
      ? Math.max(MARGIN, viewportBottom - height)
      : wantedTop

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top,
        left,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: 80,
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.6), 0 4px 12px rgba(0, 0, 0, 0.4)',
        background: 'white',
        pointerEvents: 'auto',
        // Hard right-edge cut so the iframe never visually bleeds off the
        // window — the cockpit page bg shows past this seam.
        outline: '2px solid var(--charcoal)'
      }}
    >
      <button
        type="button"
        onClick={onClose}
        title="Close device preview (Esc)"
        aria-label="Close device preview"
        className="absolute -right-3 -top-3 grid size-7 place-items-center transition-colors"
        style={{
          background: 'var(--charcoal)',
          color: 'var(--van-white)',
          borderRadius: '999px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
          zIndex: 1
        }}
      >
        <Icon icon={X} size={14} strokeWidth={2.5} />
      </button>
      <iframe
        // Stable key — URL-bar navigations + device resizes happen via
        // src/style updates without remount, so cookies + auth survive.
        key={`${slotId}-device#${reloadKey}`}
        title={`preview-${slotId}-device`}
        src={url}
        style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
        /* Same reasoning as the fit-mode iframe — sandbox blocks login. */
      />
    </div>,
    document.body
  )
}
