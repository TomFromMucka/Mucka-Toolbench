/**
 * Cross-process types for the in-cockpit tabbed browser. Each preview
 * slot in the right column hosts its own stack of tabs; each tab is a
 * real Electron `WebContentsView` (full browser semantics — back/forward
 * history, cookies, devtools, cross-origin).
 *
 * The renderer side is "headless" — it draws the tab strip, URL bar, and
 * a placeholder rectangle for where the active tab's view should land.
 * Main process owns every `WebContentsView` and positions it over the
 * placeholder via `setBounds`.
 */

export type BrowserSlotId = 'left' | 'right'
export type TabId = string

/** Renderer-visible state for one tab — everything the UI needs. */
export interface TabState {
  id: TabId
  slotId: BrowserSlotId
  /** Index within the slot's tab list, 0-based leftmost first. */
  position: number
  /** Current URL — updates on every did-navigate. */
  url: string
  /** Live page title; falls back to a slice of the URL when none. */
  title: string
  /** First favicon URL from page-favicon-updated; null until first emission. */
  faviconUrl: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Whether this tab is the visible one in its slot. */
  active: boolean
}

export interface OpenTabInput {
  slotId: BrowserSlotId
  url: string
  /** Default true — newly opened tab becomes the active one. */
  activate?: boolean
}

export interface NavigateTabInput {
  tabId: TabId
  url: string
}

export interface SetSlotBoundsInput {
  slotId: BrowserSlotId
  /** CSS-pixel coordinates relative to the cockpit window's content area. */
  x: number
  y: number
  width: number
  height: number
}
