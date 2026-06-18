// Boot-time setup MUST run before the rest of main loads its modules so
// .env is loaded and process.env is populated before getAgentConfigs /
// Mucka.ts / MuckaTextAgent.ts etc. read it.
import './bootstrap'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import {
  deleteCardAttachments,
  installAttachmentProtocol,
  registerAttachmentScheme,
  saveImage as attachmentsSaveImage
} from './attachments/Attachments'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ensureSeeded, getAgentConfig, getAgentConfigs } from './config/agents'
import { upsertAgent, listAgents as listAgentsFromDb } from './db/agents'
import { closeDb } from './db/index'
import { appendValue, getValue, setValue } from './db/kv'
import {
  forgetMemory,
  getMemory,
  listMemories,
  rememberMemory
} from './db/memories'
import {
  createFile as fsCreateFile,
  createFolder as fsCreateFolder,
  deletePath as fsDelete,
  listDir as fsListDir,
  openPathInOs,
  readFilePreview as fsReadFilePreview,
  renamePath as fsRename,
  revealInOs,
  writeTextFile as fsWriteTextFile
} from './fs/index'
import {
  bindEventsBroadcaster,
  listEvents,
  logEvent,
  unbindEventsBroadcaster
} from './events/Events'
import {
  extractDocSection,
  listDocSections,
  readCockpitDoc
} from './doc/CockpitDoc'
import {
  extractProductSection,
  listProductSections,
  readProductDoc
} from './doc/ProductDoc'
import { mirrorToMarkdown, readRoadmapSection } from './doc/RoadmapMirror'
import {
  createCard as roadmapCreate,
  deleteCard as roadmapDelete,
  listCards as roadmapList,
  moveCard as roadmapMove,
  seedFromRoadmapMarkdown as roadmapSeed,
  updateCard as roadmapUpdate
} from './db/roadmap'
import { GitService } from './git/GitService'
import { mintSignedUrl, getStatus as muckaStatus } from './mucka/Mucka'
import {
  acceptToolResult as muckaTextAcceptToolResult,
  appendVoiceMessage as muckaTextAppendVoice,
  bindMuckaTextBroadcaster,
  clearHistory as muckaTextClearHistory,
  getStatus as muckaTextStatus,
  listHistory as muckaTextListHistory,
  searchHistory as muckaTextSearchHistory,
  sendMessage as muckaTextSendMessage,
  unbindMuckaTextBroadcaster
} from './mucka/MuckaTextAgent'
import { PtyManager } from './pty/PtyManager'
import { scrollback } from './scrollback/Scrollback'
import { getStatus as vercelStatus } from './vercel/Vercel'
import { VercelPoller } from './vercel/VercelPoller'
import {
  fetchPrDiff,
  getStatus as githubStatus,
  submitPrReview,
  type ReviewEvent
} from './github/GitHub'
import {
  bindUpdaterBroadcaster,
  checkForUpdates as updaterCheck,
  downloadUpdate as updaterDownload,
  getVersion as updaterVersion,
  installUpdate as updaterInstall,
  unbindUpdaterBroadcaster
} from './updater/Updater'
import { GitHubPoller } from './github/GitHubPoller'
import {
  clearSecret,
  initSecrets,
  listSecretStatuses,
  setSecret,
  testSecret
} from './secrets/Secrets'
import type { SecretId } from '@shared/secrets'
import {
  createCredential,
  deleteCredential,
  listCredentials,
  updateCredential
} from './credentials/Credentials'
import type {
  CredentialCreateInput,
  CredentialUpdateInput
} from '@shared/credentials'
import { installInputContextMenu } from './contextMenu/InputMenu'
import {
  bindFsWatcherBroadcaster,
  shutdownAllWatchers,
  unbindFsWatcherBroadcaster,
  unwatchPath as fsUnwatch,
  watchPath as fsWatch
} from './fs/Watcher'
import {
  bindBrowserManager,
  closeTab as browserCloseTab,
  goBack as browserGoBack,
  goForward as browserGoForward,
  listTabs as browserListTabs,
  navigateTab as browserNavigate,
  openTab as browserOpenTab,
  raiseSlot as browserRaiseSlot,
  reloadTab as browserReload,
  setSlotBounds as browserSetBounds,
  setSlotZoom as browserSetZoom,
  switchTab as browserSwitch,
  unbindBrowserManager
} from './browser/BrowserManager'
import type {
  BrowserSlotId,
  OpenTabInput as BrowserOpenTabInput,
  SetSlotBoundsInput as BrowserSetSlotBoundsInput,
  TabId as BrowserTabId
} from '@shared/browser'
import type {
  MemoryListQuery,
  MemoryWriteInput,
  MicAccess,
  MuckaTextToolResult,
  PrReviewContext,
  PrReviewSubmission,
  PrReviewSubmitted,
  RoadmapCreateInput,
  RoadmapMoveInput,
  RoadmapUpdateInput,
  VoiceTranscriptInput
} from '@shared/types'
import type {
  AgentId,
  AgentUpdate,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest,
  TerminalId
} from '@shared/types'

const NOTES_KEY = 'notes'

let ptyManager: PtyManager | null = null
let gitService: GitService | null = null
let vercelPoller: VercelPoller | null = null
let githubPoller: GitHubPoller | null = null
let mainWindowRef: BrowserWindow | null = null
let lastAttentionCount = 0

function afterRoadmapMutation(): void {
  try {
    mirrorToMarkdown(roadmapList())
  } catch {
    /* non-fatal */
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('roadmap:update')
  }
}

function applyAttentionToShell(count: number): void {
  const safe = Math.max(0, Math.floor(count))
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setBadge(safe > 0 ? String(safe) : '')
    // Bounce only on a rising edge — repeated bounces while still flagged
    // are annoying. Bounce again whenever the count grows.
    if (safe > lastAttentionCount) {
      app.dock.bounce('informational')
    }
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.flashFrame(safe > lastAttentionCount)
    } catch {
      /* not supported on every platform/window state */
    }
  }
  lastAttentionCount = safe
}

function createWindow(): void {
  const { workArea } = screen.getPrimaryDisplay()

  const mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: 1600,
    minHeight: 900,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1a1612',
    title: app.isPackaged ? 'Mucka Toolbench' : 'Mucka Toolbench [DEV]',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindowRef = mainWindow
  installInputContextMenu(mainWindow.webContents)
  ptyManager = new PtyManager(mainWindow.webContents)
  bindEventsBroadcaster(mainWindow.webContents)
  bindMuckaTextBroadcaster(mainWindow.webContents)
  bindUpdaterBroadcaster(mainWindow.webContents)
  bindFsWatcherBroadcaster(mainWindow.webContents)
  bindBrowserManager(mainWindow)
  gitService = new GitService({
    webContents: mainWindow.webContents,
    getAgents: () => getAgentConfigs()
  })
  vercelPoller = new VercelPoller({
    webContents: mainWindow.webContents,
    getAgents: () => getAgentConfigs()
  })
  githubPoller = new GitHubPoller({
    webContents: mainWindow.webContents,
    getAgents: () => getAgentConfigs()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    gitService?.start()
    vercelPoller?.start()
    githubPoller?.start()
    logEvent({ source: 'system', kind: 'boot', message: 'Cockpit started.', tone: 'normal' })
  })

  mainWindow.on('closed', () => {
    gitService?.stop()
    gitService = null
    vercelPoller?.stop()
    vercelPoller = null
    githubPoller?.stop()
    githubPoller = null
    unbindEventsBroadcaster()
    unbindMuckaTextBroadcaster()
    unbindUpdaterBroadcaster()
    unbindFsWatcherBroadcaster()
    void shutdownAllWatchers()
    unbindBrowserManager()
    ptyManager?.killAll()
    ptyManager = null
    mainWindowRef = null
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge('')
    }
    lastAttentionCount = 0
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    if (is.dev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('agents:list', () => getAgentConfigs())

  ipcMain.handle('agents:update', async (_event, patch: AgentUpdate) => {
    const current = getAgentConfig(patch.id)
    if (!current) throw new Error(`Unknown agent: ${patch.id}`)
    const updated = {
      ...current,
      ...patch,
      args: patch.args ?? current.args
    }
    const ordered = listAgentsFromDb()
    const sortOrder = ordered.findIndex((a) => a.id === updated.id)
    upsertAgent(updated, sortOrder < 0 ? ordered.length : sortOrder)

    // Diff against the prior config to produce useful job-sheet events.
    if (patch.needsAttention !== undefined && patch.needsAttention !== current.needsAttention) {
      if (updated.needsAttention) {
        logEvent({
          source: updated.id,
          kind: 'attention.flag',
          message: `Flagged for attention — ${updated.attentionReason ?? 'no reason'}`,
          tone: 'attention'
        })
      } else {
        logEvent({
          source: updated.id,
          kind: 'attention.clear',
          message: 'Attention cleared.',
          tone: 'normal'
        })
      }
    }
    if (patch.worktreePath !== undefined && patch.worktreePath !== current.worktreePath) {
      logEvent({
        source: updated.id,
        kind: 'agent.worktree',
        message: `Worktree → ${updated.worktreePath}`,
        tone: 'normal'
      })
    }
    if (patch.command !== undefined && patch.command !== current.command) {
      logEvent({
        source: updated.id,
        kind: 'agent.command',
        message: `Command → ${updated.command} ${updated.args.join(' ')}`.trim(),
        tone: 'normal'
      })
    }
    if (patch.previewUrl !== undefined && patch.previewUrl !== current.previewUrl) {
      logEvent({
        source: updated.id,
        kind: 'agent.preview',
        message: updated.previewUrl
          ? `Preview bound → ${updated.previewUrl}`
          : 'Preview cleared.',
        tone: 'normal'
      })
    }

    // Push a fresh git status + Vercel summary so the new config shows real state.
    void gitService?.refreshOne(updated.id)
    void vercelPoller?.refreshOne(updated.id)
    void githubPoller?.refreshOne(updated.id)
    return updated
  })

  ipcMain.handle('agents:start', async (_event, agentId: AgentId) => {
    const current = getAgentConfig(agentId)
    if (!current) throw new Error(`Unknown agent: ${agentId}`)
    if (!current.running) {
      const ordered = listAgentsFromDb()
      const sortOrder = ordered.findIndex((a) => a.id === agentId)
      upsertAgent(
        { ...current, running: true },
        sortOrder < 0 ? ordered.length : sortOrder
      )
      logEvent({
        source: agentId,
        kind: 'agent.start',
        message: 'Started.',
        tone: 'normal'
      })
    }
    return getAgentConfig(agentId)
  })

  ipcMain.handle('agents:stop', async (_event, agentId: AgentId) => {
    const current = getAgentConfig(agentId)
    if (!current) throw new Error(`Unknown agent: ${agentId}`)
    ptyManager?.killByAgent(agentId)
    if (current.running) {
      const ordered = listAgentsFromDb()
      const sortOrder = ordered.findIndex((a) => a.id === agentId)
      upsertAgent(
        { ...current, running: false },
        sortOrder < 0 ? ordered.length : sortOrder
      )
      logEvent({
        source: agentId,
        kind: 'agent.stop',
        message: 'Stopped.',
        tone: 'normal'
      })
    }
    return getAgentConfig(agentId)
  })

  ipcMain.handle('git:refresh', async (_event, agentId: AgentId) => {
    if (!gitService) throw new Error('git service not ready')
    return gitService.refreshOne(agentId)
  })

  ipcMain.handle(
    'dialog:pickDirectory',
    async (_event, opts?: { defaultPath?: string }) => {
      const owner = mainWindowRef
      const result = await (owner
        ? dialog.showOpenDialog(owner, {
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: opts?.defaultPath
          })
        : dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            defaultPath: opts?.defaultPath
          }))
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )

  ipcMain.handle('pty:spawn', (_event, req: PtySpawnRequest) => {
    ptyManager?.spawn(req)
  })

  ipcMain.on('pty:write', (_event, req: PtyWriteRequest) => {
    ptyManager?.write(req)
  })

  ipcMain.on('pty:resize', (_event, req: PtyResizeRequest) => {
    ptyManager?.resize(req)
  })

  ipcMain.handle('pty:kill', (_event, terminalId: TerminalId) => {
    ptyManager?.kill(terminalId)
  })

  ipcMain.handle('pty:scrollback', (_event, terminalId: TerminalId) =>
    scrollback.get(terminalId)
  )

  ipcMain.handle('mucka:status', () => muckaStatus())

  ipcMain.handle('mucka:signedUrl', () => mintSignedUrl())

  ipcMain.handle('mucka:requestMic', async (): Promise<MicAccess> => {
    if (process.platform !== 'darwin') return 'granted'
    try {
      const ok = await systemPreferences.askForMediaAccess('microphone')
      return ok ? 'granted' : 'denied'
    } catch {
      return 'unknown'
    }
  })

  ipcMain.handle('mucka:openMicSettings', async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )
  })

  ipcMain.handle('vercel:status', () => vercelStatus())

  ipcMain.handle('vercel:get', (_event, agentId: AgentId) =>
    vercelPoller?.get(agentId) ?? null
  )

  ipcMain.handle('vercel:getAll', () => vercelPoller?.getAll() ?? {})

  ipcMain.handle('vercel:refresh', (_event, agentId: AgentId) =>
    vercelPoller?.refreshOne(agentId) ?? null
  )

  ipcMain.handle('github:status', () => githubStatus())

  ipcMain.handle('github:get', (_event, agentId: AgentId) =>
    githubPoller?.get(agentId) ?? null
  )

  ipcMain.handle('github:getAll', () => githubPoller?.getAll() ?? {})

  ipcMain.handle('github:refresh', (_event, agentId: AgentId) =>
    githubPoller?.refreshOne(agentId) ?? null
  )

  ipcMain.handle(
    'github:review-context',
    async (_event, agentId: AgentId): Promise<PrReviewContext> => {
      const summary = await (githubPoller?.refreshOne(agentId) ?? Promise.resolve(null))
      if (!summary || !summary.repo) {
        return {
          agentId,
          found: false,
          pr: null,
          repo: null,
          diff: '',
          diffTruncated: false,
          error: 'agent has no GitHub repo linked'
        }
      }
      if (!summary.openPr) {
        return {
          agentId,
          found: false,
          pr: null,
          repo: summary.repo,
          diff: '',
          diffTruncated: false,
          error: `no open PR on ${summary.repo.owner}/${summary.repo.name} for branch ${summary.branch}`
        }
      }
      try {
        const fullDiff = await fetchPrDiff(summary.repo, summary.openPr.number)
        const DIFF_CAP = 40_000
        const truncated = fullDiff.length > DIFF_CAP
        const diff = truncated
          ? fullDiff.slice(0, DIFF_CAP) +
            `\n\n[diff truncated at ${DIFF_CAP} chars — full diff is ${fullDiff.length} chars]`
          : fullDiff
        return {
          agentId,
          found: true,
          pr: summary.openPr,
          repo: summary.repo,
          diff,
          diffTruncated: truncated,
          error: null
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          agentId,
          found: false,
          pr: summary.openPr,
          repo: summary.repo,
          diff: '',
          diffTruncated: false,
          error: message
        }
      }
    }
  )

  ipcMain.handle('updater:version', () => updaterVersion())
  ipcMain.handle('updater:check', () => updaterCheck())
  ipcMain.handle('updater:download', () => updaterDownload())
  ipcMain.handle('updater:install', () => updaterInstall())

  ipcMain.handle(
    'github:review-submit',
    async (_event, input: PrReviewSubmission): Promise<PrReviewSubmitted> => {
      const summary = await (githubPoller?.refreshOne(input.agentId) ??
        Promise.resolve(null))
      if (!summary || !summary.repo || !summary.openPr) {
        throw new Error('agent has no open PR to review')
      }
      const event: ReviewEvent =
        input.verdict === 'approve'
          ? 'APPROVE'
          : input.verdict === 'request-changes'
            ? 'REQUEST_CHANGES'
            : 'COMMENT'
      const result = await submitPrReview(
        summary.repo,
        summary.openPr.number,
        input.body,
        event
      )
      logEvent({
        source: input.agentId,
        kind: 'github.review',
        message: `Mucka ${input.verdict.replace('-', ' ')}d PR #${summary.openPr.number}`,
        tone: input.verdict === 'request-changes' ? 'attention' : 'win'
      })
      return { url: result.url, state: result.state }
    }
  )

  ipcMain.handle('notes:get', () => getValue(NOTES_KEY) ?? '')

  ipcMain.handle('notes:set', (_event, value: string) => {
    setValue(NOTES_KEY, value)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('notes:update', value)
    }
  })

  ipcMain.handle('notes:append', (_event, chunk: string) => {
    const next = appendValue(NOTES_KEY, chunk)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('notes:update', next)
    }
    return next
  })

  ipcMain.handle('events:list', (_event, limit?: number) => listEvents(limit ?? 100))

  ipcMain.handle('mucka:text-status', () => muckaTextStatus())
  ipcMain.handle('mucka:text-history', () => muckaTextListHistory())
  ipcMain.handle('mucka:text-clear', () => muckaTextClearHistory())
  ipcMain.handle('mucka:text-search', (_event, query: string, limit?: number) =>
    muckaTextSearchHistory(typeof query === 'string' ? query : '', limit ?? 20)
  )
  ipcMain.handle('mucka:text-send', async (_event, text: string) => {
    await muckaTextSendMessage(text)
  })
  ipcMain.on('mucka:text-tool-result', (_event, result: MuckaTextToolResult) => {
    muckaTextAcceptToolResult(result)
  })

  ipcMain.on('mucka:voice-transcript', (_event, input: VoiceTranscriptInput) => {
    if (!input || typeof input.text !== 'string') return
    if (input.role !== 'user' && input.role !== 'assistant') return
    muckaTextAppendVoice(input.role, input.text, input.ts)
  })

  ipcMain.on('app:notify-attention', (_event, count: number) => {
    applyAttentionToShell(typeof count === 'number' ? count : 0)
  })

  ipcMain.handle('memory:list', (_event, query?: MemoryListQuery) =>
    listMemories(query ?? {})
  )

  ipcMain.handle('memory:get', (_event, topic: string) => getMemory(topic))

  ipcMain.handle('memory:remember', (_event, input: MemoryWriteInput) =>
    rememberMemory(input)
  )

  ipcMain.handle('memory:forget', (_event, topic: string) => forgetMemory(topic))

  ipcMain.handle('roadmap:list', () => roadmapList())

  ipcMain.handle('roadmap:create', (_event, input: RoadmapCreateInput) => {
    const card = roadmapCreate(input)
    afterRoadmapMutation()
    return card
  })

  ipcMain.handle('roadmap:update', (_event, input: RoadmapUpdateInput) => {
    const card = roadmapUpdate(input)
    afterRoadmapMutation()
    return card
  })

  ipcMain.handle('roadmap:move', (_event, input: RoadmapMoveInput) => {
    const card = roadmapMove(input)
    afterRoadmapMutation()
    return card
  })

  ipcMain.handle('roadmap:delete', (_event, id: string) => {
    const ok = roadmapDelete(id)
    if (ok) {
      void deleteCardAttachments(id)
      afterRoadmapMutation()
    }
    return ok
  })

  ipcMain.handle(
    'roadmap:attachImage',
    async (
      _event,
      input: { cardId: string; name: string; bytes: Uint8Array }
    ) => {
      return attachmentsSaveImage(input.cardId, input.name, input.bytes)
    }
  )

  ipcMain.handle(
    'broadcast:send',
    (_event, input: { text: string; agentIds?: AgentId[] }) => {
      const raw = typeof input?.text === 'string' ? input.text : ''
      if (raw.trim().length === 0) {
        return { sent: [] as AgentId[], skipped: [] as AgentId[] }
      }
      const targets: AgentId[] =
        input?.agentIds && input.agentIds.length > 0
          ? input.agentIds
          : getAgentConfigs()
              .filter((a) => a.running)
              .map((a) => a.id)

      const sent: AgentId[] = []
      const skipped: AgentId[] = []
      for (const id of targets) {
        if (ptyManager?.hasTerminal(id)) {
          ptyManager.write({ terminalId: id, data: raw + '\r' })
          sent.push(id)
        } else {
          skipped.push(id)
        }
      }
      if (sent.length > 0) {
        const preview = raw.replace(/\s+/g, ' ').trim()
        logEvent({
          source: 'system',
          kind: 'broadcast',
          message: `Broadcast → ${sent.join(', ')}: ${preview.slice(0, 100)}${preview.length > 100 ? '…' : ''}`,
          tone: 'normal'
        })
      }
      return { sent, skipped }
    }
  )

  ipcMain.handle('fs:listDir', (_event, path: string) => fsListDir(path))

  ipcMain.handle('fs:reveal', (_event, path: string) => revealInOs(path))

  ipcMain.handle('fs:openPath', (_event, path: string) => openPathInOs(path))

  ipcMain.handle('fs:readFile', (_event, path: string) => fsReadFilePreview(path))
  ipcMain.handle('fs:writeFile', (_event, path: string, content: string) =>
    fsWriteTextFile(path, typeof content === 'string' ? content : '')
  )

  ipcMain.handle(
    'fs:createFile',
    (_event, parentPath: string, name: string) => fsCreateFile(parentPath, name)
  )

  ipcMain.handle(
    'fs:createFolder',
    (_event, parentPath: string, name: string) => fsCreateFolder(parentPath, name)
  )

  ipcMain.handle(
    'fs:rename',
    (_event, fromPath: string, toName: string) => fsRename(fromPath, toName)
  )

  ipcMain.handle('fs:delete', (_event, path: string) => fsDelete(path))

  ipcMain.handle(
    'mucka:cockpit-doc',
    (_event, section?: string): { text: string; sections: string[]; found: boolean } => {
      const doc = readCockpitDoc()
      const sections = doc.found ? listDocSections(doc.text) : []
      if (!doc.found) {
        return { text: '', sections, found: false }
      }
      const wantSection =
        typeof section === 'string' && section.trim().length > 0
          ? section.trim()
          : null
      if (!wantSection) {
        return { text: doc.text, sections, found: true }
      }
      const slice = extractDocSection(doc.text, wantSection)
      return { text: slice, sections, found: slice.length > 0 }
    }
  )

  ipcMain.handle(
    'mucka:product-doc',
    (_event, section?: string): { text: string; sections: string[]; found: boolean } => {
      const doc = readProductDoc()
      const sections = doc.found ? listProductSections(doc.text) : []
      if (!doc.found) {
        return { text: '', sections, found: false }
      }
      const wantSection =
        typeof section === 'string' && section.trim().length > 0
          ? section.trim()
          : null
      if (!wantSection) {
        return { text: doc.text, sections, found: true }
      }
      const slice = extractProductSection(doc.text, wantSection)
      return { text: slice, sections, found: slice.length > 0 }
    }
  )

  ipcMain.handle('secrets:list', () => listSecretStatuses())
  ipcMain.handle('secrets:set', (_event, id: SecretId, value: string) => {
    setSecret(id, value)
    return listSecretStatuses()
  })
  ipcMain.handle('secrets:clear', (_event, id: SecretId) => {
    clearSecret(id)
    return listSecretStatuses()
  })
  ipcMain.handle('secrets:test', (_event, id: SecretId) => testSecret(id))

  ipcMain.handle('credentials:list', () => listCredentials())
  ipcMain.handle('credentials:create', (_event, input: CredentialCreateInput) => {
    createCredential(input)
    return listCredentials()
  })
  ipcMain.handle('credentials:update', (_event, input: CredentialUpdateInput) => {
    updateCredential(input)
    return listCredentials()
  })
  ipcMain.handle('credentials:delete', (_event, id: string) => {
    deleteCredential(id)
    return listCredentials()
  })

  ipcMain.handle('fs:watch', (_event, path: string) => fsWatch(path))
  ipcMain.handle('fs:unwatch', (_event, path: string) => fsUnwatch(path))

  ipcMain.handle('browser:list', () => browserListTabs())
  ipcMain.handle('browser:open', (_event, input: BrowserOpenTabInput) =>
    browserOpenTab(input)
  )
  ipcMain.handle('browser:close', (_event, tabId: BrowserTabId) =>
    browserCloseTab(tabId)
  )
  ipcMain.handle('browser:switch', (_event, tabId: BrowserTabId) =>
    browserSwitch(tabId)
  )
  ipcMain.handle('browser:navigate', (_event, tabId: BrowserTabId, url: string) =>
    browserNavigate(tabId, url)
  )
  ipcMain.handle('browser:back', (_event, tabId: BrowserTabId) =>
    browserGoBack(tabId)
  )
  ipcMain.handle('browser:forward', (_event, tabId: BrowserTabId) =>
    browserGoForward(tabId)
  )
  ipcMain.handle('browser:reload', (_event, tabId: BrowserTabId) =>
    browserReload(tabId)
  )
  ipcMain.handle('browser:set-bounds', (_event, input: BrowserSetSlotBoundsInput) =>
    browserSetBounds(input)
  )
  ipcMain.handle(
    'browser:set-zoom',
    (_event, slotId: BrowserSlotId, factor: number) => browserSetZoom(slotId, factor)
  )
  ipcMain.handle('browser:raise', (_event, slotId: BrowserSlotId) =>
    browserRaiseSlot(slotId)
  )
}

function configureMediaPermissions(): void {
  // Electron 28+ needs both the request handler (one-shot grant) and the
  // check handler (per-call re-validation). Without the check handler, the
  // second getUserMedia call after a quick restart silently fails.
  const allow = (permission: string): boolean =>
    permission === 'media' || permission === 'microphone'

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allow(permission))
    }
  )

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => allow(permission)
  )
}

// Privileged schemes must be registered BEFORE app is ready.
registerAttachmentScheme()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('ai.mucka.toolbench')
  installAttachmentProtocol()

  // safeStorage isn't available before app.whenReady(); now it is, so
  // we can apply any encrypted-store overrides to process.env. .env
  // values already loaded by bootstrap.ts remain for keys the store
  // doesn't set.
  initSecrets()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ensureSeeded()
  // First-launch import: lift the existing ## Roadmap markdown into the
  // sqlite kanban so Tom's current notes survive the migration.
  try {
    const md = readRoadmapSection()
    if (md.length > 0) roadmapSeed(md)
  } catch {
    /* non-fatal — kanban just starts empty */
  }
  // Primary terminalId === agentId, so we restore the same buffers we wrote.
  scrollback.loadFromDisk(getAgentConfigs().map((a) => a.id))
  configureMediaPermissions()
  registerIpc()
  createWindow()
})

app.on('before-quit', () => {
  ptyManager?.killAll()
  // Only persist the primary terminal per agent; split terminals are session-only.
  scrollback.flushToDisk(getAgentConfigs().map((a) => a.id))
  closeDb()
})

// Single-window dev cockpit — closing the window means quitting the app.
// On macOS the default is to leave the process alive in the dock; for a
// tool you launch with `npm run dev`, that leaves a zombie process with
// no dock entry and no obvious way to bring the window back. Quit cleanly.
app.on('window-all-closed', () => {
  app.quit()
})
