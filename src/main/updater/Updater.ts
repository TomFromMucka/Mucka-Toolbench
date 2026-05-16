import { app, type WebContents } from 'electron'
import pkg from 'electron-updater'
import type { UpdaterStatus } from '@shared/types'

/**
 * Thin wrapper around electron-updater. Manual-trigger only — no
 * automatic polling on launch or on a timer; Tom presses "Check for
 * updates" in the Updates tab of the Settings sheet.
 *
 * Publishes to GitHub Releases (config in electron-builder.yml). The
 * release is signed but not notarised, which is fine for personal
 * installs but means macOS may prompt the first time after an update.
 */

const { autoUpdater } = pkg

let webContents: WebContents | null = null
let latestStatus: UpdaterStatus = { kind: 'idle' }
let wired = false

export function bindUpdaterBroadcaster(wc: WebContents): void {
  webContents = wc
}

export function unbindUpdaterBroadcaster(): void {
  webContents = null
}

function emit(status: UpdaterStatus): void {
  latestStatus = status
  if (!webContents || webContents.isDestroyed()) return
  webContents.send('updater:status', status)
}

export function getStatus(): UpdaterStatus {
  return latestStatus
}

export function getVersion(): string {
  return app.getVersion()
}

function ensureWired(): boolean {
  if (wired) return true
  if (!app.isPackaged) {
    latestStatus = {
      kind: 'unsupported',
      reason:
        'Updates only run in the installed app — you are currently in dev (npm run dev). Use `npm run install:mac` from the cockpit project to ship the latest build.'
    }
    return false
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    emit({ kind: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    emit({
      kind: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('update-not-available', () => {
    emit({ kind: 'not-available', currentVersion: app.getVersion() })
  })

  autoUpdater.on('download-progress', (progress) => {
    emit({
      kind: 'downloading',
      version: latestStatus.kind === 'available' ? latestStatus.version : '',
      percent: progress.percent ?? 0,
      bytesPerSecond: progress.bytesPerSecond ?? 0,
      transferred: progress.transferred ?? 0,
      total: progress.total ?? 0
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emit({
      kind: 'downloaded',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
    })
  })

  autoUpdater.on('error', (err: Error) => {
    emit({ kind: 'error', message: err.message })
  })

  wired = true
  return true
}

export async function checkForUpdates(): Promise<UpdaterStatus> {
  if (!ensureWired()) return latestStatus
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
  return latestStatus
}

export async function downloadUpdate(): Promise<void> {
  if (!ensureWired()) return
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    emit({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

export async function installUpdate(): Promise<void> {
  if (!ensureWired()) return
  // Hands control off to the bundled Squirrel.Mac updater which quits
  // the app, swaps in the new .app, and relaunches. We don't return.
  autoUpdater.quitAndInstall(false, true)
}
