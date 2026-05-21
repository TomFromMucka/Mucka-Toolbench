import { randomUUID } from 'node:crypto'
import { BrowserWindow, WebContentsView, type WebContents } from 'electron'
import type {
  BrowserSlotId,
  OpenTabInput,
  SetSlotBoundsInput,
  TabId,
  TabState
} from '@shared/browser'
import { installInputContextMenu } from '../contextMenu/InputMenu'

/**
 * Main-process owner of every tab across both preview slots.
 *
 * Each tab is a `WebContentsView` attached to the cockpit window's
 * `contentView`. Only one tab per slot is positioned over its
 * placeholder rectangle at a time (the active tab); inactive tabs are
 * hidden via `setVisible(false)` so they don't fight for paint cycles
 * but their `webContents` keeps running (scroll, JS, video, etc. stay
 * alive).
 *
 * The renderer sends bounds via `browser:set-bounds` whenever its tab
 * pane resizes; main positions the active view to match. State (titles,
 * favicons, loading, history) is broadcast on `browser:state` for the
 * renderer's tab strip to render off.
 */

const SLOT_IDS: BrowserSlotId[] = ['left', 'right']

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

interface Tab {
  id: TabId
  view: WebContentsView
  slotId: BrowserSlotId
  url: string
  title: string
  faviconUrl: string | null
  loading: boolean
}

interface SlotState {
  tabs: Tab[]
  activeTabId: TabId | null
  bounds: Bounds | null
  zoomFactor: number
}

const slots: Record<BrowserSlotId, SlotState> = {
  left: { tabs: [], activeTabId: null, bounds: null, zoomFactor: 1 },
  right: { tabs: [], activeTabId: null, bounds: null, zoomFactor: 1 }
}

let parentWindow: BrowserWindow | null = null
let broadcaster: WebContents | null = null

export function bindBrowserManager(window: BrowserWindow): void {
  parentWindow = window
  broadcaster = window.webContents
}

export function unbindBrowserManager(): void {
  // The 'closed' event fires AFTER the native window is destroyed, so
  // anything that touches parentWindow.contentView here will throw
  // "Object has been destroyed". Just drop our references and let GC
  // collect the views — the underlying BrowserWindow's contentView
  // tree is already being torn down.
  parentWindow = null
  broadcaster = null
  for (const slotId of SLOT_IDS) {
    slots[slotId].tabs = []
    slots[slotId].activeTabId = null
  }
}

function snapshot(): TabState[] {
  const states: TabState[] = []
  for (const slotId of SLOT_IDS) {
    const slot = slots[slotId]
    slot.tabs.forEach((tab, idx) => {
      const history = tab.view.webContents.navigationHistory
      states.push({
        id: tab.id,
        slotId,
        position: idx,
        url: tab.url,
        title: tab.title,
        faviconUrl: tab.faviconUrl,
        loading: tab.loading,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        active: slot.activeTabId === tab.id
      })
    })
  }
  return states
}

function emit(): void {
  if (!broadcaster || broadcaster.isDestroyed()) return
  broadcaster.send('browser:state', snapshot())
}

function applyBounds(slotId: BrowserSlotId): void {
  const slot = slots[slotId]
  for (const tab of slot.tabs) {
    if (tab.id === slot.activeTabId && slot.bounds) {
      tab.view.setBounds(slot.bounds)
      tab.view.setVisible(true)
    } else {
      tab.view.setVisible(false)
    }
  }
}

/**
 * Pull a slot's active view to the top of the cockpit window's
 * `contentView` z-order. Used when a slot pops out beyond its
 * placeholder rect (a desktop preset rendered larger than the slot can
 * overlap the other slot), and on user interaction so whatever the
 * operator clicks comes forward.
 *
 * Electron's contentView has no `raise` API — children render in
 * insertion order, so we remove and re-add to put the view last.
 */
export function raiseSlot(slotId: BrowserSlotId): void {
  if (!parentWindow) return
  const slot = slots[slotId]
  const active = slot.tabs.find((t) => t.id === slot.activeTabId)
  if (!active) return
  try {
    parentWindow.contentView.removeChildView(active.view)
    parentWindow.contentView.addChildView(active.view)
  } catch {
    /* view already detached */
  }
}

function wireEvents(tab: Tab): void {
  const wc = tab.view.webContents
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title
    emit()
  })
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.faviconUrl = favicons[0] ?? null
    emit()
  })
  wc.on('did-start-loading', () => {
    tab.loading = true
    emit()
  })
  wc.on('did-stop-loading', () => {
    tab.loading = false
    emit()
  })
  wc.on('did-navigate', (_e, url) => {
    tab.url = url
    emit()
  })
  wc.on('did-navigate-in-page', (_e, url) => {
    tab.url = url
    emit()
  })
  wc.on('did-fail-load', (_e, _errorCode, _errorDescription, validatedURL) => {
    tab.loading = false
    tab.url = validatedURL || tab.url
    emit()
  })
  // window.open / target=_blank / Cmd-click on a link → spawn another
  // tab in the SAME slot so the user stays inside the cockpit.
  wc.setWindowOpenHandler((details) => {
    openTab({ slotId: tab.slotId, url: details.url, activate: true })
    return { action: 'deny' }
  })
}

export function openTab(input: OpenTabInput): TabId | null {
  if (!parentWindow) return null
  const view = new WebContentsView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Default persistent session — cookies + localStorage survive
      // cockpit restarts, same as the iframe approach had.
      partition: 'persist:browser'
    }
  })
  const tab: Tab = {
    id: randomUUID(),
    view,
    slotId: input.slotId,
    url: input.url,
    title: input.url,
    faviconUrl: null,
    loading: true
  }
  wireEvents(tab)
  // Each tab's webContents gets the same context-menu treatment as the
  // main window — Cut/Copy/Paste/Select All plus the Credentials
  // library's Insert username/password submenu when right-clicking
  // inside an input. Without this, right-click in a tab does nothing.
  installInputContextMenu(view.webContents)
  parentWindow.contentView.addChildView(view)
  // Inherit the slot's current viewport zoom (so opening a new tab
  // while in a Desktop · 1440 viewport doesn't reset to 1.0). Apply
  // after the first commit so the zoom sticks past loadURL's reset.
  view.webContents.once('did-finish-load', () => {
    try {
      view.webContents.setZoomFactor(slots[input.slotId].zoomFactor)
    } catch {
      /* tab gone */
    }
  })
  view.webContents
    .loadURL(input.url)
    .catch(() => { /* did-fail-load handles surface */ })

  const slot = slots[input.slotId]
  slot.tabs.push(tab)
  if (input.activate !== false || slot.tabs.length === 1) {
    slot.activeTabId = tab.id
  }
  applyBounds(input.slotId)
  raiseSlot(input.slotId)
  emit()
  return tab.id
}

export function closeTab(tabId: TabId): void {
  for (const slotId of SLOT_IDS) {
    const slot = slots[slotId]
    const idx = slot.tabs.findIndex((t) => t.id === tabId)
    if (idx < 0) continue
    const [removed] = slot.tabs.splice(idx, 1)
    if (parentWindow) parentWindow.contentView.removeChildView(removed.view)
    try {
      removed.view.webContents.close()
    } catch {
      /* already closed */
    }
    if (slot.activeTabId === tabId) {
      // Activate the neighbour to the left, falling back to right.
      const next = slot.tabs[Math.max(0, idx - 1)] ?? null
      slot.activeTabId = next?.id ?? null
    }
    applyBounds(slotId)
    emit()
    return
  }
}

export function switchTab(tabId: TabId): void {
  for (const slotId of SLOT_IDS) {
    const slot = slots[slotId]
    if (slot.tabs.some((t) => t.id === tabId)) {
      if (slot.activeTabId !== tabId) {
        slot.activeTabId = tabId
        applyBounds(slotId)
        emit()
      }
      raiseSlot(slotId)
      return
    }
  }
}

function findTab(tabId: TabId): { tab: Tab; slotId: BrowserSlotId } | null {
  for (const slotId of SLOT_IDS) {
    const tab = slots[slotId].tabs.find((t) => t.id === tabId)
    if (tab) return { tab, slotId }
  }
  return null
}

export function navigateTab(tabId: TabId, url: string): void {
  const found = findTab(tabId)
  if (!found) return
  found.tab.view.webContents.loadURL(url).catch(() => { /* did-fail-load handles */ })
}

export function goBack(tabId: TabId): void {
  const found = findTab(tabId)
  if (!found) return
  const history = found.tab.view.webContents.navigationHistory
  if (history.canGoBack()) history.goBack()
}

export function goForward(tabId: TabId): void {
  const found = findTab(tabId)
  if (!found) return
  const history = found.tab.view.webContents.navigationHistory
  if (history.canGoForward()) history.goForward()
}

export function reloadTab(tabId: TabId): void {
  const found = findTab(tabId)
  if (!found) return
  found.tab.view.webContents.reload()
}

export function setSlotZoom(slotId: BrowserSlotId, factor: number): void {
  // Per-slot zoom — applied to every tab in the slot so switching tabs
  // doesn't reset the viewport mode. Clamp to Electron's accepted
  // range (roughly 0.25–5).
  const safe = Math.max(0.25, Math.min(5, factor))
  slots[slotId].zoomFactor = safe
  for (const tab of slots[slotId].tabs) {
    try {
      tab.view.webContents.setZoomFactor(safe)
    } catch {
      /* tab being destroyed */
    }
  }
}

export function setSlotBounds(input: SetSlotBoundsInput): void {
  const slot = slots[input.slotId]
  slot.bounds = {
    x: Math.round(input.x),
    y: Math.round(input.y),
    width: Math.max(0, Math.round(input.width)),
    height: Math.max(0, Math.round(input.height))
  }
  applyBounds(input.slotId)
  // Bounds changes are the popout trigger — auto-raise so a popped-out
  // desktop viewport in one slot covers the other slot's body rather
  // than being clipped under it.
  raiseSlot(input.slotId)
}

export function listTabs(): TabState[] {
  return snapshot()
}
