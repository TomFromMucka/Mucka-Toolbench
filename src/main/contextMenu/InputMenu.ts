import { BrowserWindow, Menu, MenuItem, type WebContents, type WebFrameMain } from 'electron'
import { getPassword, getUsername, hasCredential, listCredentials } from '../credentials/Credentials'

/**
 * Right-click context menu for the cockpit window.
 *
 * Electron doesn't ship a default context menu — apps build their own.
 * We give every editable area a sensible Cut / Copy / Paste / Select
 * All set, then append credential-insertion items when the right-click
 * lands inside an input. The credential-insert path uses
 * `WebFrameMain.executeJavaScript()` to set the input's value, which
 * works inside cross-origin iframes (the preview panes) — the
 * same-origin policy doesn't restrict main-process JS injection.
 *
 * Last-used credential floats to the top so a username→password fill
 * is two right-clicks with the matching credential pre-selected.
 */

let lastUsedCredentialId: string | null = null

function findFrame(webContents: WebContents, url: string): WebFrameMain | null {
  const frames = webContents.mainFrame.framesInSubtree
  return frames.find((f) => f.url === url) ?? null
}

function buildInjection(value: string): string {
  // The native setter dance keeps React/Vue change-tracking happy —
  // assigning to el.value directly bypasses their internal trackers.
  return `(function(){
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    const setter = desc && desc.set;
    const v = ${JSON.stringify(value)};
    if (setter) setter.call(el, v); else el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })();`
}

async function injectValue(
  webContents: WebContents,
  frameURL: string,
  value: string
): Promise<void> {
  const frame = findFrame(webContents, frameURL)
  if (!frame) return
  try {
    await frame.executeJavaScript(buildInjection(value))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[contextmenu] injection failed',
      err instanceof Error ? err.message : err
    )
  }
}

type FieldKind = 'username' | 'password' | null

// Electron's formControlType lists every HTML input variant. Map them
// down to the two we care about — anything that takes a password gets
// the password menu; text-like fields (text/email/search/url/tel/textarea)
// get the username menu. Numeric/date/checkbox/etc. → no credential menu.
function classifyInput(formControlType: string | undefined): FieldKind {
  if (formControlType === 'input-password') return 'password'
  if (
    formControlType === 'input-text' ||
    formControlType === 'input-email' ||
    formControlType === 'input-search' ||
    formControlType === 'input-url' ||
    formControlType === 'input-telephone' ||
    formControlType === 'text-area'
  ) {
    return 'username'
  }
  return null
}

function sortLastUsedFirst<T extends { id: string }>(items: T[]): T[] {
  if (!lastUsedCredentialId) return items
  const idx = items.findIndex((i) => i.id === lastUsedCredentialId)
  if (idx <= 0) return items
  const reordered = items.slice()
  const [pinned] = reordered.splice(idx, 1)
  reordered.unshift(pinned)
  return reordered
}

function buildCredentialItems(
  kind: FieldKind,
  webContents: WebContents,
  frameURL: string
): MenuItem[] {
  if (kind === null) return []
  const all = listCredentials()
  if (all.length === 0) return []
  const sorted = sortLastUsedFirst(all)

  const items: MenuItem[] = []
  items.push(new MenuItem({ type: 'separator' }))
  items.push(
    new MenuItem({
      label: kind === 'password' ? 'Insert password' : 'Insert username',
      enabled: false
    })
  )
  for (const cred of sorted) {
    const isLast = cred.id === lastUsedCredentialId
    items.push(
      new MenuItem({
        label: `${isLast ? '· ' : '  '}${cred.label} — ${cred.username || '(no username)'}`,
        click: async () => {
          const value =
            kind === 'password' ? getPassword(cred.id) : getUsername(cred.id)
          if (value === null || value === '') return
          if (!hasCredential(cred.id)) return
          await injectValue(webContents, frameURL, value)
          lastUsedCredentialId = cred.id
        }
      })
    )
  }
  return items
}

function buildEditingItems(): MenuItem[] {
  return [
    new MenuItem({ role: 'cut' }),
    new MenuItem({ role: 'copy' }),
    new MenuItem({ role: 'paste' }),
    new MenuItem({ type: 'separator' }),
    new MenuItem({ role: 'selectAll' })
  ]
}

function buildBrowseItems(hasSelection: boolean): MenuItem[] {
  const items: MenuItem[] = []
  if (hasSelection) items.push(new MenuItem({ role: 'copy' }))
  items.push(new MenuItem({ role: 'selectAll' }))
  return items
}

export function installInputContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const isEditable = params.isEditable === true
    const kind = isEditable ? classifyInput(params.formControlType) : null

    const items: MenuItem[] = isEditable
      ? buildEditingItems()
      : buildBrowseItems(params.selectionText.length > 0)

    if (kind !== null) {
      items.push(...buildCredentialItems(kind, webContents, params.frameURL))
    }

    if (items.length === 0) return
    const menu = Menu.buildFromTemplate(items)
    const ownerWindow = BrowserWindow.fromWebContents(webContents)
    menu.popup(ownerWindow ? { window: ownerWindow } : undefined)
  })
}
