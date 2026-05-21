import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Monitor,
  Plus,
  RotateCw,
  Smartphone,
  Tablet,
  X,
  type LucideIcon
} from 'lucide-react'
import type {
  BrowserSlotId,
  TabState
} from '@shared/browser'
import type { AgentConfig } from '@shared/types'
import { Clipboard } from './Clipboard'
import { Icon } from './ui/Icon'
import { registerPreviewSlot } from '../state/previewBus'

type PresetId =
  | 'fit'
  | 'iphone-se'
  | 'iphone-14'
  | 'iphone-14-pro-max'
  | 'pixel-7'
  | 'galaxy-s22-ultra'
  | 'ipad-mini'
  | 'ipad-pro-11'
  | 'ipad-pro-13'
  | 'galaxy-tab-s8'
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
  { id: 'iphone-14-pro-max', label: 'iPhone 14 Pro Max', width: 430, height: 932, device: 'phone' },
  { id: 'pixel-7', label: 'Pixel 7', width: 412, height: 915, device: 'phone' },
  { id: 'galaxy-s22-ultra', label: 'Galaxy S22 Ultra', width: 384, height: 824, device: 'phone' },
  { id: 'ipad-mini', label: 'iPad Mini', width: 768, height: 1024, device: 'tablet' },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', width: 834, height: 1194, device: 'tablet' },
  { id: 'ipad-pro-13', label: 'iPad Pro 13"', width: 1024, height: 1366, device: 'tablet' },
  { id: 'galaxy-tab-s8', label: 'Galaxy Tab S8', width: 800, height: 1280, device: 'tablet' },
  { id: 'desktop-sm', label: 'Desktop · 1280', width: 1280, height: 800, device: 'desktop' },
  { id: 'desktop', label: 'Desktop · 1440', width: 1440, height: 900, device: 'desktop' },
  { id: 'desktop-lg', label: 'Desktop · 1920', width: 1920, height: 1080, device: 'desktop' }
]

function findPreset(id: PresetId): Preset | null {
  if (id === 'fit') return null
  return PRESETS.find((p) => p.id === id) ?? null
}

interface TabbedBrowserPaneProps {
  slotId: BrowserSlotId
  agent: AgentConfig | null
  /** All tabs across both slots, broadcast from main. */
  allTabs: TabState[]
}

const DEFAULT_NEW_TAB_URL = 'https://www.google.com'

export function TabbedBrowserPane({
  slotId,
  agent,
  allTabs
}: TabbedBrowserPaneProps): React.JSX.Element {
  const tabs = useMemo(
    () => allTabs.filter((t) => t.slotId === slotId).sort((a, b) => a.position - b.position),
    [allTabs, slotId]
  )
  const activeTab = tabs.find((t) => t.active) ?? null

  // Register with the preview bus so AgentTerminal's ⌘-click on a URL
  // can route into this slot (preferring the slot whose agent matches).
  useEffect(() => {
    return registerPreviewSlot(slotId, agent?.id ?? null)
  }, [slotId, agent?.id])

  // Auto-open a single tab to the agent's previewUrl on first mount of
  // a slot when (a) the agent has one set and (b) there are no tabs yet.
  // Matches the prior iframe-pane bootstrap behaviour. Tracked per
  // (slotId, agentId) so re-binding to a different agent re-bootstraps.
  const bootstrappedRef = useRef<string | null>(null)
  useEffect(() => {
    const key = `${slotId}::${agent?.id ?? ''}::${agent?.previewUrl ?? ''}`
    if (bootstrappedRef.current === key) return
    bootstrappedRef.current = key
    if (agent?.previewUrl && tabs.length === 0) {
      void window.mucka.openBrowserTab({ slotId, url: agent.previewUrl })
    }
    // Intentionally only depends on agent identity + previewUrl, not on
    // `tabs` — we don't want this re-firing after the user closes the
    // bootstrap tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, agent?.id, agent?.previewUrl])

  const [presetId, setPresetId] = useState<PresetId>('fit')
  const [landscape, setLandscape] = useState(false)
  const preset = findPreset(presetId)

  // ESC dismisses device mode — match the muscle memory of the old
  // portal-based device overlay. Only fires when this slot is in a
  // non-fit preset; harmless otherwise.
  useEffect(() => {
    if (presetId === 'fit') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPresetId('fit')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [presetId])
  const deviceW = preset ? (landscape ? preset.height : preset.width) : 0
  const deviceH = preset ? (landscape ? preset.width : preset.height) : 0

  // Bounds reservation: the placeholder div's position drives where
  // main positions the active WebContentsView.
  //
  //   - Fit (no preset): bounds = slot rect, zoom = 1.
  //   - Any device preset: POP OUT. Anchored at the slot's top-left and
  //     shifted left/up to fit the window. Even phones pop out — the
  //     "popping out of the slot" feel is the point, the slot itself
  //     shows a device-info placeholder during the popout.
  //   - Device bigger than the window itself: last-resort scaling via
  //     setZoomFactor, painted into the slot rect.
  const POPOUT_MARGIN = 12
  const placeholderRef = useRef<HTMLDivElement | null>(null)
  const [popoutBounds, setPopoutBounds] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  useLayoutEffect(() => {
    const el = placeholderRef.current
    if (!el) return
    const push = (): void => {
      const rect = el.getBoundingClientRect()
      if (!preset) {
        setPopoutBounds(null)
        void window.mucka.setBrowserBounds({
          slotId,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        })
        void window.mucka.setBrowserZoom(slotId, 1)
        return
      }
      const w = deviceW
      const h = deviceH
      const winW = window.innerWidth
      const winH = window.innerHeight
      const maxW = winW - 2 * POPOUT_MARGIN

      if (w > maxW) {
        // Device wider than the cockpit window — only width triggers the
        // scale-into-slot fallback. Vertical overflow is fine; we'd
        // rather clip the bottom of an iPad portrait than scale it down,
        // because scaling kills the whole point of the preset.
        const scale = maxW / w
        setPopoutBounds(null)
        void window.mucka.setBrowserBounds({
          slotId,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        })
        void window.mucka.setBrowserZoom(slotId, scale)
        return
      }

      // Pop out: anchor at slot's top-left, shift left/up if the device
      // would otherwise spill off-screen. Matches the original
      // BrowserPreview portal positioning.
      let x = Math.round(rect.left)
      let y = Math.round(rect.top)
      const rightEdge = winW - POPOUT_MARGIN
      const bottomEdge = winH - POPOUT_MARGIN
      if (x + w > rightEdge) x = Math.max(POPOUT_MARGIN, rightEdge - w)
      if (y + h > bottomEdge) y = Math.max(POPOUT_MARGIN, bottomEdge - h)
      const bounds = { x, y, width: w, height: h }
      setPopoutBounds(bounds)
      void window.mucka.setBrowserBounds({ slotId, ...bounds })
      void window.mucka.setBrowserZoom(slotId, 1)
    }
    push()
    const ro = new ResizeObserver(push)
    ro.observe(el)
    window.addEventListener('resize', push)
    window.addEventListener('scroll', push, true)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', push)
      window.removeEventListener('scroll', push, true)
    }
  }, [slotId, preset, deviceW, deviceH])

  // When tabs go to 0, push a zero-size bounds so main hides any
  // residual view paint.
  useEffect(() => {
    if (tabs.length === 0) {
      const el = placeholderRef.current
      if (!el) return
      void window.mucka.setBrowserBounds({
        slotId,
        x: 0,
        y: 0,
        width: 0,
        height: 0
      })
    }
  }, [slotId, tabs.length])

  const subtitle = agent ? `${agent.displayName.toLowerCase()} · browser` : 'browser'

  // Bring this slot's WebContentsView to the top of the z-order on any
  // interaction with its chrome. Critical when one slot is popped out
  // to a desktop viewport that overlaps the other slot's area —
  // without raising, clicking the obscured slot leaves it hidden under
  // the other one.
  const raise = (): void => {
    void window.mucka.raiseBrowserSlot(slotId)
  }

  return (
    <Clipboard title="Browser" subtitle={subtitle} paper="plain">
      <div className="flex h-full min-h-0 flex-col" onMouseDownCapture={raise}>
        <TabStrip
          slotId={slotId}
          tabs={tabs}
          fallbackNewUrl={agent?.previewUrl ?? DEFAULT_NEW_TAB_URL}
        />
        {activeTab ? (
          <UrlBar
            tab={activeTab}
            presetId={presetId}
            onPresetChange={setPresetId}
            landscape={landscape}
            onLandscapeToggle={() => setLandscape((v) => !v)}
            deviceLabel={
              preset ? `${deviceW} × ${deviceH}` : null
            }
          />
        ) : null}
        <div ref={placeholderRef} className="relative min-h-0 flex-1 bg-paper-cream">
          {tabs.length === 0 ? (
            <EmptyState slotId={slotId} agent={agent} />
          ) : popoutBounds && preset ? (
            <DevicePlaceholder preset={preset} w={deviceW} h={deviceH} />
          ) : null}
        </div>
      </div>
      {popoutBounds ? (
        <PopoutCloseButton
          bounds={popoutBounds}
          onClose={() => setPresetId('fit')}
        />
      ) : null}
    </Clipboard>
  )
}

function DevicePlaceholder({
  preset,
  w,
  h
}: {
  preset: Preset
  w: number
  h: number
}): React.JSX.Element {
  const DeviceIcon: LucideIcon =
    preset.device === 'phone'
      ? Smartphone
      : preset.device === 'tablet'
        ? Tablet
        : Monitor
  return (
    <div
      className="grid h-full place-items-center px-4"
      style={{ background: 'var(--surface-2, transparent)' }}
    >
      <div className="flex flex-col items-center gap-1 text-center text-ink-soft">
        <Icon
          icon={DeviceIcon}
          size={20}
          strokeWidth={2}
          className="opacity-60"
        />
        <p className="text-[0.78rem] uppercase tracking-[0.16em]">
          {preset.label}
        </p>
        <p className="font-mono text-[0.74rem] text-ink-faint">
          {w} × {h}
        </p>
        <p className="mt-1 text-[0.66rem] text-ink-faint">
          Esc to return to Fit
        </p>
      </div>
    </div>
  )
}

function PopoutCloseButton({
  bounds,
  onClose
}: {
  bounds: { x: number; y: number; width: number; height: number }
  onClose: () => void
}): React.JSX.Element {
  // Centred on the popped-out view's top-right corner. The lower-left
  // quadrant of the button overlaps the view (and is covered by it), but
  // the upper-right ¾ stays outside the bounds and is clickable.
  return createPortal(
    <button
      type="button"
      onClick={onClose}
      title="Close device preview (Esc)"
      aria-label="Close device preview"
      style={{
        position: 'fixed',
        left: bounds.x + bounds.width - 14,
        top: bounds.y - 14,
        zIndex: 80
      }}
      className="grid size-7 place-items-center rounded-full bg-wood-deep text-van-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] hover:bg-charcoal"
    >
      <Icon icon={X} size={14} strokeWidth={2.5} />
    </button>,
    document.body
  )
}

function TabStrip({
  slotId,
  tabs,
  fallbackNewUrl
}: {
  slotId: BrowserSlotId
  tabs: TabState[]
  fallbackNewUrl: string
}): React.JSX.Element {
  const onNewTab = (): void => {
    void window.mucka.openBrowserTab({ slotId, url: fallbackNewUrl })
  }
  return (
    <div className="flex items-stretch gap-0.5 overflow-x-auto border-b border-ink/15 bg-paper-shadow/40 px-1 pt-1">
      {tabs.map((tab) => (
        <TabPill key={tab.id} tab={tab} />
      ))}
      <button
        type="button"
        onClick={onNewTab}
        title="New tab"
        className="ml-1 flex shrink-0 items-center justify-center rounded-t-sm border border-transparent px-2 py-1 text-ink-soft hover:bg-paper-cream/70 hover:text-ink"
      >
        <Icon icon={Plus} size={14} strokeWidth={2.25} />
      </button>
    </div>
  )
}

function TabPill({ tab }: { tab: TabState }): React.JSX.Element {
  const onClick = (): void => {
    if (!tab.active) void window.mucka.switchBrowserTab(tab.id)
  }
  const onClose = (e: React.MouseEvent): void => {
    e.stopPropagation()
    void window.mucka.closeBrowserTab(tab.id)
  }
  const onAuxClick = (e: React.MouseEvent): void => {
    // Middle-click closes — standard browser muscle memory.
    if (e.button === 1) {
      e.preventDefault()
      void window.mucka.closeBrowserTab(tab.id)
    }
  }
  return (
    <div
      onClick={onClick}
      onAuxClick={onAuxClick}
      title={tab.url}
      className={
        'group flex max-w-[200px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-sm border-x border-t px-2 py-1 text-[0.75rem] ' +
        (tab.active
          ? 'border-ink/20 bg-paper-cream text-ink'
          : 'border-transparent bg-paper-cream/40 text-ink-soft hover:bg-paper-cream/70')
      }
    >
      <TabFavicon tab={tab} />
      <span className="min-w-0 flex-1 truncate font-sans">
        {tab.title || tab.url}
      </span>
      <button
        type="button"
        onClick={onClose}
        title="Close tab"
        className="flex shrink-0 items-center justify-center rounded-sm p-0.5 opacity-0 hover:bg-ink/10 group-hover:opacity-100"
      >
        <Icon icon={X} size={11} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function TabFavicon({ tab }: { tab: TabState }): React.JSX.Element {
  if (tab.loading) {
    return (
      <span className="size-3 shrink-0 animate-pulse rounded-full bg-mucka/70" />
    )
  }
  if (tab.faviconUrl) {
    return (
      <img
        src={tab.faviconUrl}
        alt=""
        className="size-3.5 shrink-0"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
        }}
      />
    )
  }
  return <span className="size-3 shrink-0 rounded-sm bg-ink/15" />
}

function UrlBar({
  tab,
  presetId,
  onPresetChange,
  landscape,
  onLandscapeToggle,
  deviceLabel
}: {
  tab: TabState
  presetId: PresetId
  onPresetChange: (id: PresetId) => void
  landscape: boolean
  onLandscapeToggle: () => void
  deviceLabel: string | null
}): React.JSX.Element {
  const [value, setValue] = useState(tab.url)
  const lastUrlRef = useRef(tab.url)
  // Sync from upstream when the URL changes externally (page navigation,
  // tab switch), but leave the user's in-flight typing alone.
  useEffect(() => {
    if (tab.url !== lastUrlRef.current) {
      lastUrlRef.current = tab.url
      setValue(tab.url)
    }
  }, [tab.url])

  const onSubmit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    const url = trimmed.includes('://') ? trimmed : `https://${trimmed}`
    void window.mucka.navigateBrowserTab(tab.id, url)
  }

  return (
    <div className="flex items-center gap-1 border-b border-ink/10 bg-paper-cream/85 px-2 py-1">
      <NavButton
        icon={ChevronLeft}
        title="Back"
        disabled={!tab.canGoBack}
        onClick={() => void window.mucka.browserBack(tab.id)}
      />
      <NavButton
        icon={ChevronRight}
        title="Forward"
        disabled={!tab.canGoForward}
        onClick={() => void window.mucka.browserForward(tab.id)}
      />
      <NavButton
        icon={RotateCw}
        title="Reload"
        onClick={() => void window.mucka.browserReload(tab.id)}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
          if (e.key === 'Escape') setValue(tab.url)
        }}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="min-w-0 flex-1 rounded-sm border border-ink/15 bg-paper-cream px-2 py-0.5 font-mono text-[0.78rem] text-ink focus:border-mucka focus:outline-none"
      />
      <ViewportSelect value={presetId} onChange={onPresetChange} />
      <NavButton
        icon={RotateCw}
        title={landscape ? 'Portrait' : 'Landscape'}
        disabled={presetId === 'fit'}
        onClick={onLandscapeToggle}
      />
      {deviceLabel ? (
        <span className="ml-0.5 shrink-0 font-mono text-[0.66rem] text-ink-faint">
          {deviceLabel}
        </span>
      ) : null}
    </div>
  )
}

function ViewportSelect({
  value,
  onChange
}: {
  value: PresetId
  onChange: (id: PresetId) => void
}): React.JSX.Element {
  const current = value === 'fit' ? 'fit' : findPreset(value)?.device ?? 'fit'
  const iconFor = (device: DeviceClass | 'fit'): LucideIcon => {
    if (device === 'phone') return Smartphone
    if (device === 'tablet') return Tablet
    if (device === 'desktop') return Monitor
    return Monitor
  }
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PresetId)}
        title="Viewport size"
        className="appearance-none rounded-sm border border-ink/20 bg-paper-cream py-0.5 pl-6 pr-2 font-sans text-[0.72rem] text-ink hover:bg-paper-shadow focus:outline-none"
      >
        <option value="fit">Fit</option>
        <optgroup label="Phones">
          {PRESETS.filter((p) => p.device === 'phone').map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Tablets">
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
      <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-ink-soft">
        <Icon icon={iconFor(current)} size={12} strokeWidth={2.25} />
      </span>
    </div>
  )
}

function NavButton({
  icon,
  title,
  disabled,
  onClick
}: {
  icon: LucideIcon
  title: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-soft hover:bg-paper-shadow/50 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon icon={icon} size={14} strokeWidth={2.25} />
    </button>
  )
}

function EmptyState({
  slotId,
  agent
}: {
  slotId: BrowserSlotId
  agent: AgentConfig | null
}): React.JSX.Element {
  const onOpen = (): void => {
    void window.mucka.openBrowserTab({
      slotId,
      url: agent?.previewUrl ?? DEFAULT_NEW_TAB_URL
    })
  }
  return (
    <div className="grid h-full place-items-center px-4 text-center">
      <div>
        <p className="t-heading-md text-ink">No tabs open</p>
        <p className="mt-1 t-body-sm text-ink-soft">
          {agent?.previewUrl
            ? `Open ${agent.displayName}'s preview, or type any URL.`
            : 'Open a new tab with the + button above.'}
        </p>
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 rounded-sm border border-ink/30 bg-paper-cream px-3 py-1 font-sans text-[0.8rem] text-ink hover:bg-paper-shadow"
        >
          {agent?.previewUrl ? `Open ${agent.displayName}'s preview` : 'New tab'}
        </button>
      </div>
    </div>
  )
}

/** Renderer-side container — subscribes to browser:state and threads
 *  through to the two TabbedBrowserPane instances. Mount once near the
 *  root of the right column.
 */
export function useBrowserTabs(): TabState[] {
  const [tabs, setTabs] = useState<TabState[]>([])
  useEffect(() => {
    void window.mucka.listBrowserTabs().then(setTabs)
    return window.mucka.onBrowserState((next) => setTabs(next))
  }, [])
  return tabs
}

export type { TabState }
