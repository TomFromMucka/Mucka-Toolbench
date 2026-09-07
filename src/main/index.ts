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
  listWorktreeDir,
  readWorktreeDiff,
  readWorktreeFile,
  readWorktreeLog
} from './worktree/WorktreeRead'
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
  unbindMuckaTextBroadcaster,
  abortTurn as muckaTextAbortTurn
} from './mucka/MuckaTextAgent'
import { PtyManager } from './pty/PtyManager'
import { ClaudeStateWatcher } from './claude/ClaudeStateWatcher'
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
import { SentryPoller } from './sentry/SentryPoller'
import {
  archiveIssue as sentryArchiveIssue,
  getIssue as sentryGetIssue,
  getStatus as sentryGetStatus
} from './sentry/Sentry'
import {
  ackStatusChange as ackSentryStatusChange,
  getTriage as getSentryTriage,
  listPendingStatusChanges as listSentryStatusChanges,
  listUntriaged as listUntriagedSentry,
  recordTriage as recordSentryTriage
} from './db/sentry'
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
  PREVIEW_PARTITION,
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
  SentryVerdict,
  MuckaTextToolResult,
  PrReviewContext,
  PrReviewSubmission,
  PrReviewSubmitted,
  RoadmapCreateInput,
  RoadmapMoveInput,
  RoadmapUpdateInput,
  VoiceTranscriptInput,
  WorktreeDiffScope
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
let claudeStateWatcher: ClaudeStateWatcher | null = null
let gitService: GitService | null = null
let vercelPoller: VercelPoller | null = null
let githubPoller: GitHubPoller | null = null
let sentryPoller: SentryPoller | null = null
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

/**
 * `shell.openExternal` hands the URL to the OS, which will happily run a
 * `file:` or custom-scheme handler. Web and mail links are all the cockpit
 * ever needs to hand off.
 */
function isExternallyOpenable(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
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
      sandbox: true,
      contextIsolation: true
    }
  })

  mainWindowRef = mainWindow
  installInputContextMenu(mainWindow.webContents)
  ptyManager = new PtyManager(mainWindow.webContents)
  // Claude Code reports its own activity + model + context usage through
  // ~/.claude/mucka-agent-state.sh; the stream can't be read reliably.
  claudeStateWatcher = new ClaudeStateWatcher(
    (event) => {
      if (mainWindow.webContents.isDestroyed()) return
      mainWindow.webContents.send('agent:status', event)
    },
    getAgentConfigs,
    (terminalId) => ptyManager?.hasTerminal(terminalId) ?? false
  )
  claudeStateWatcher.start()
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
  sentryPoller = new SentryPoller({ webContents: mainWindow.webContents })

  mainWindow.webContents.on('did-finish-load', () => {
    gitService?.start()
    vercelPoller?.start()
    githubPoller?.start()
    sentryPoller?.start()
    logEvent({ source: 'system', kind: 'boot', message: 'Cockpit started.', tone: 'normal' })
  })

  mainWindow.on('closed', () => {
    gitService?.stop()
    gitService = null
    vercelPoller?.stop()
    vercelPoller = null
    githubPoller?.stop()
    githubPoller = null
    sentryPoller?.stop()
    sentryPoller = null
    unbindEventsBroadcaster()
    unbindMuckaTextBroadcaster()
    unbindUpdaterBroadcaster()
    unbindFsWatcherBroadcaster()
    void shutdownAllWatchers()
    unbindBrowserManager()
    ptyManager?.killAll()
    ptyManager = null
    claudeStateWatcher?.dispose()
    claudeStateWatcher = null
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
    if (isExternallyOpenable(details.url)) void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Every channel below assumes the caller is the cockpit renderer. Only
 * that window has a preload, so nothing else can reach ipcRenderer today
 * — this pins that assumption down so a future view with a preload, or a
 * subframe, can't drive PTY writes or file deletes.
 */
function fromCockpit(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const wc = mainWindowRef?.webContents
  if (!wc || event.sender !== wc) return false
  const frame = event.senderFrame
  return frame === null || frame === wc.mainFrame
}

const guardedHandle: typeof ipcMain.handle = (channel, listener) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromCockpit(event)) throw new Error(`ipc ${channel}: untrusted sender`)
    return listener(event, ...args)
  })

const guardedOn: typeof ipcMain.on = (channel, listener) =>
  ipcMain.on(channel, (event, ...args) => {
    if (!fromCockpit(event)) return
    listener(event, ...args)
  })

function registerIpc(): void {
  guardedHandle('agents:list', () => getAgentConfigs())

  guardedHandle('agents:update', async (_event, patch: AgentUpdate) => {
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

  guardedHandle('agents:start', async (_event, agentId: AgentId) => {
    const current = getAgentConfig(agentId)
    if (!current) throw new Error(`Unknown agent: ${agentId}`)
    // A previous session's last state ("waiting on Tom") would otherwise
    // hang over the fresh shell until Claude writes its own.
    claudeStateWatcher?.clear(agentId)
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

  /**
   * Explicit restart: kill the agent's shells and mark it running, so the
   * renderer's remount spawns fresh ones. Spawn reattaches to a matching
   * live shell, so a remount alone no longer restarts anything — anybody
   * who wants a fresh process has to come through here.
   */
  guardedHandle('agents:restart', async (_event, agentId: AgentId) => {
    const current = getAgentConfig(agentId)
    if (!current) throw new Error(`Unknown agent: ${agentId}`)
    ptyManager?.killByAgent(agentId)
    claudeStateWatcher?.clear(agentId)
    const ordered = listAgentsFromDb()
    const sortOrder = ordered.findIndex((a) => a.id === agentId)
    upsertAgent(
      { ...current, running: true },
      sortOrder < 0 ? ordered.length : sortOrder
    )
    logEvent({
      source: agentId,
      kind: 'agent.restart',
      message: 'Shell restarted.',
      tone: 'normal'
    })
    return getAgentConfig(agentId)
  })

  /**
   * Block until the Claude launched by the last start/restart reports in
   * through the statusline hook, or the timeout passes. The renderer used
   * to pattern-match the PTY stream for a prompt — which matched the dead
   * session's prompt still in scrollback and pasted tickets into a shell
   * that was still booting.
   */
  guardedHandle(
    'agents:await-claude',
    async (_event, agentId: AgentId, timeoutMs: number): Promise<boolean> => {
      if (!claudeStateWatcher) return false
      const bounded = Math.min(60_000, Math.max(1_000, Math.floor(timeoutMs)))
      const ready = await claudeStateWatcher.waitForFreshSession(agentId, bounded)
      if (!ready) {
        logEvent({
          source: agentId,
          kind: 'agent.ready_timeout',
          message:
            'Claude never reported ready — is ~/.claude/statusline-command.sh feeding mucka-agent-state.sh? Sent the prompt anyway.',
          tone: 'attention'
        })
      }
      return ready
    }
  )

  guardedHandle('agents:stop', async (_event, agentId: AgentId) => {
    const current = getAgentConfig(agentId)
    if (!current) throw new Error(`Unknown agent: ${agentId}`)
    ptyManager?.killByAgent(agentId)
    claudeStateWatcher?.clear(agentId)
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

  // Mucka's read-only window into a worktree. Main resolves the agent's
  // root and refuses anything that escapes it, so a path the model picked
  // up from a diff or a Sentry title can't reach the rest of the disk.
  const worktreeOf = (agentId: AgentId): string => {
    const cfg = getAgentConfig(agentId)
    if (!cfg) throw new Error(`Unknown agent: ${agentId}`)
    return cfg.worktreePath
  }
  guardedHandle(
    'worktree:read-file',
    (_event, agentId: AgentId, path: string, startLine?: number, maxLines?: number) =>
      readWorktreeFile(worktreeOf(agentId), String(path ?? ''), startLine, maxLines)
  )
  guardedHandle('worktree:list-dir', (_event, agentId: AgentId, path: string) =>
    listWorktreeDir(worktreeOf(agentId), String(path ?? ''))
  )
  guardedHandle(
    'worktree:diff',
    (_event, agentId: AgentId, scope: WorktreeDiffScope, path: string | null) =>
      readWorktreeDiff(
        worktreeOf(agentId),
        scope === 'staged' || scope === 'branch' ? scope : 'working',
        typeof path === 'string' ? path : null
      )
  )
  guardedHandle(
    'worktree:log',
    (_event, agentId: AgentId, limit: number, branchOnly: boolean) =>
      readWorktreeLog(worktreeOf(agentId), Number(limit) || 20, branchOnly === true)
  )

  guardedHandle('git:refresh', async (_event, agentId: AgentId) => {
    if (!gitService) throw new Error('git service not ready')
    return gitService.refreshOne(agentId)
  })

  guardedHandle(
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

  guardedHandle('pty:spawn', (_event, req: PtySpawnRequest) => {
    ptyManager?.spawn(req)
  })

  guardedOn('pty:write', (_event, req: PtyWriteRequest) => {
    ptyManager?.write(req)
  })

  guardedOn('pty:resize', (_event, req: PtyResizeRequest) => {
    ptyManager?.resize(req)
  })

  guardedHandle('pty:kill', (_event, terminalId: TerminalId) => {
    ptyManager?.kill(terminalId)
  })

  guardedHandle('pty:scrollback', (_event, terminalId: TerminalId) =>
    scrollback.get(terminalId)
  )

  guardedHandle('mucka:status', () => muckaStatus())

  guardedHandle('mucka:signedUrl', () => mintSignedUrl())

  guardedHandle('mucka:requestMic', async (): Promise<MicAccess> => {
    if (process.platform !== 'darwin') return 'granted'
    try {
      const ok = await systemPreferences.askForMediaAccess('microphone')
      return ok ? 'granted' : 'denied'
    } catch {
      return 'unknown'
    }
  })

  guardedHandle('mucka:openMicSettings', async () => {
    if (process.platform !== 'darwin') return
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
    )
  })

  guardedHandle('vercel:status', () => vercelStatus())

  guardedHandle('vercel:get', (_event, agentId: AgentId) =>
    vercelPoller?.get(agentId) ?? null
  )

  guardedHandle('vercel:getAll', () => vercelPoller?.getAll() ?? {})

  guardedHandle('vercel:refresh', (_event, agentId: AgentId) =>
    vercelPoller?.refreshOne(agentId) ?? null
  )

  guardedHandle('github:status', () => githubStatus())

  guardedHandle('github:get', (_event, agentId: AgentId) =>
    githubPoller?.get(agentId) ?? null
  )

  guardedHandle('github:getAll', () => githubPoller?.getAll() ?? {})

  guardedHandle('github:refresh', (_event, agentId: AgentId) =>
    githubPoller?.refreshOne(agentId) ?? null
  )

  guardedHandle('sentry:status', () => sentryGetStatus())

  guardedHandle('sentry:list', () => sentryPoller?.getAll() ?? [])

  guardedHandle('sentry:refresh', () => sentryPoller?.refresh() ?? [])

  guardedHandle('sentry:get', (_event, issueId: string) => sentryGetIssue(issueId))

  guardedHandle('sentry:untriaged', () => listUntriagedSentry())

  guardedHandle('sentry:status-changes', () => listSentryStatusChanges())

  guardedHandle('sentry:ack-status', (_event, issueId: string) => {
    ackSentryStatusChange(issueId)
  })

  guardedHandle('sentry:health', () =>
    sentryPoller?.getHealth() ?? { hasPolled: false, lastError: null, count: 0 }
  )

  guardedHandle('sentry:archive', async (_event, issueId: string) => {
    await sentryArchiveIssue(issueId)
  })

  guardedHandle(
    'sentry:triage',
    (
      _event,
      input: {
        issueId: string
        verdict: SentryVerdict
        reason: string
        cardId?: string | null
        count?: number
        userCount?: number
      }
    ) => {
      recordSentryTriage(input)
      const record = getSentryTriage(input.issueId)
      const label = record ? `${record.shortId} ${record.title.slice(0, 70)}` : input.issueId
      logEvent({
        source: 'mucka',
        kind: `sentry.${input.verdict}`,
        message:
          input.verdict === 'noise'
            ? `Sentry ${label} — archived as noise: ${input.reason}`
            : input.verdict === 'ticket'
              ? `Sentry ${label} — ticket written: ${input.reason}`
              : `Sentry ${label} — watching: ${input.reason}`,
        tone: input.verdict === 'ticket' ? 'attention' : 'normal'
      })
    }
  )

  guardedHandle(
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

  guardedHandle('updater:version', () => updaterVersion())
  guardedHandle('updater:check', () => updaterCheck())
  guardedHandle('updater:download', () => updaterDownload())
  guardedHandle('updater:install', () => updaterInstall())

  guardedHandle(
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

  guardedHandle('notes:get', () => getValue(NOTES_KEY) ?? '')

  guardedHandle('notes:set', (_event, value: string) => {
    setValue(NOTES_KEY, value)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('notes:update', value)
    }
  })

  guardedHandle('notes:append', (_event, chunk: string) => {
    const next = appendValue(NOTES_KEY, chunk)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('notes:update', next)
    }
    return next
  })

  guardedHandle('events:list', (_event, limit?: number) => listEvents(limit ?? 100))

  guardedHandle('mucka:text-status', () => muckaTextStatus())
  guardedHandle('mucka:text-history', () => muckaTextListHistory())
  guardedHandle('mucka:text-clear', () => muckaTextClearHistory())
  guardedHandle('mucka:text-search', (_event, query: string, limit?: number) =>
    muckaTextSearchHistory(typeof query === 'string' ? query : '', limit ?? 20)
  )
  guardedHandle('mucka:text-abort', () => muckaTextAbortTurn())
  guardedHandle('mucka:text-send', async (_event, text: string) => {
    await muckaTextSendMessage(text)
  })
  guardedOn('mucka:text-tool-result', (_event, result: MuckaTextToolResult) => {
    muckaTextAcceptToolResult(result)
  })

  guardedOn('mucka:voice-transcript', (_event, input: VoiceTranscriptInput) => {
    if (!input || typeof input.text !== 'string') return
    if (input.role !== 'user' && input.role !== 'assistant') return
    muckaTextAppendVoice(input.role, input.text, input.ts)
  })

  guardedOn('app:notify-attention', (_event, count: number) => {
    applyAttentionToShell(typeof count === 'number' ? count : 0)
  })

  guardedHandle('memory:list', (_event, query?: MemoryListQuery) =>
    listMemories(query ?? {})
  )

  guardedHandle('memory:get', (_event, topic: string) => getMemory(topic))

  guardedHandle('memory:remember', (_event, input: MemoryWriteInput) =>
    rememberMemory(input)
  )

  guardedHandle('memory:forget', (_event, topic: string) => forgetMemory(topic))

  guardedHandle('roadmap:list', () => roadmapList())

  guardedHandle('roadmap:create', (_event, input: RoadmapCreateInput) => {
    const card = roadmapCreate(input)
    afterRoadmapMutation()
    return card
  })

  guardedHandle('roadmap:update', (_event, input: RoadmapUpdateInput) => {
    const card = roadmapUpdate(input)
    afterRoadmapMutation()
    return card
  })

  guardedHandle('roadmap:move', (_event, input: RoadmapMoveInput) => {
    const card = roadmapMove(input)
    afterRoadmapMutation()
    return card
  })

  guardedHandle('roadmap:delete', (_event, id: string) => {
    const ok = roadmapDelete(id)
    if (ok) {
      void deleteCardAttachments(id)
      afterRoadmapMutation()
    }
    return ok
  })

  guardedHandle(
    'roadmap:attachImage',
    async (
      _event,
      input: { cardId: string; name: string; bytes: Uint8Array }
    ) => {
      return attachmentsSaveImage(input.cardId, input.name, input.bytes)
    }
  )

  guardedHandle(
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

  guardedHandle('fs:listDir', (_event, path: string) => fsListDir(path))

  guardedHandle('fs:reveal', (_event, path: string) => revealInOs(path))

  guardedHandle('fs:openPath', (_event, path: string) => openPathInOs(path))

  guardedHandle('fs:readFile', (_event, path: string) => fsReadFilePreview(path))
  guardedHandle('fs:writeFile', (_event, path: string, content: string) =>
    fsWriteTextFile(path, typeof content === 'string' ? content : '')
  )

  guardedHandle(
    'fs:createFile',
    (_event, parentPath: string, name: string) => fsCreateFile(parentPath, name)
  )

  guardedHandle(
    'fs:createFolder',
    (_event, parentPath: string, name: string) => fsCreateFolder(parentPath, name)
  )

  guardedHandle(
    'fs:rename',
    (_event, fromPath: string, toName: string) => fsRename(fromPath, toName)
  )

  guardedHandle('fs:delete', (_event, path: string) => fsDelete(path))

  guardedHandle(
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

  guardedHandle(
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

  guardedHandle('secrets:list', () => listSecretStatuses())
  guardedHandle('secrets:set', (_event, id: SecretId, value: string) => {
    setSecret(id, value)
    return listSecretStatuses()
  })
  guardedHandle('secrets:clear', (_event, id: SecretId) => {
    clearSecret(id)
    return listSecretStatuses()
  })
  guardedHandle('secrets:test', (_event, id: SecretId) => testSecret(id))

  guardedHandle('credentials:list', () => listCredentials())
  guardedHandle('credentials:create', (_event, input: CredentialCreateInput) => {
    createCredential(input)
    return listCredentials()
  })
  guardedHandle('credentials:update', (_event, input: CredentialUpdateInput) => {
    updateCredential(input)
    return listCredentials()
  })
  guardedHandle('credentials:delete', (_event, id: string) => {
    deleteCredential(id)
    return listCredentials()
  })

  guardedHandle('fs:watch', (_event, path: string) => fsWatch(path))
  guardedHandle('fs:unwatch', (_event, path: string) => fsUnwatch(path))

  guardedHandle('browser:list', () => browserListTabs())
  guardedHandle('browser:open', (_event, input: BrowserOpenTabInput) =>
    browserOpenTab(input)
  )
  guardedHandle('browser:close', (_event, tabId: BrowserTabId) =>
    browserCloseTab(tabId)
  )
  guardedHandle('browser:switch', (_event, tabId: BrowserTabId) =>
    browserSwitch(tabId)
  )
  guardedHandle('browser:navigate', (_event, tabId: BrowserTabId, url: string) =>
    browserNavigate(tabId, url)
  )
  guardedHandle('browser:back', (_event, tabId: BrowserTabId) =>
    browserGoBack(tabId)
  )
  guardedHandle('browser:forward', (_event, tabId: BrowserTabId) =>
    browserGoForward(tabId)
  )
  guardedHandle('browser:reload', (_event, tabId: BrowserTabId) =>
    browserReload(tabId)
  )
  guardedHandle('browser:set-bounds', (_event, input: BrowserSetSlotBoundsInput) =>
    browserSetBounds(input)
  )
  guardedHandle(
    'browser:set-zoom',
    (_event, slotId: BrowserSlotId, factor: number) => browserSetZoom(slotId, factor)
  )
  guardedHandle('browser:raise', (_event, slotId: BrowserSlotId) =>
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

  // Preview tabs live on their own partition, and a session with no
  // handler grants every request — so a page in a preview could take the
  // mic, camera or location without a prompt. Nothing previewed needs any
  // of it; deny outright.
  const previews = session.fromPartition(PREVIEW_PARTITION)
  previews.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  previews.setPermissionCheckHandler(() => false)
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
