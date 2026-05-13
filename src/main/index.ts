import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  screen,
  shell
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ensureSeeded, getAgentConfig, getAgentConfigs } from './config/agents'
import { upsertAgent, listAgents as listAgentsFromDb } from './db/agents'
import { closeDb } from './db/index'
import { GitService } from './git/GitService'
import { PtyManager } from './pty/PtyManager'
import type {
  AgentId,
  AgentUpdate,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest
} from '@shared/types'

let ptyManager: PtyManager | null = null
let gitService: GitService | null = null
let mainWindowRef: BrowserWindow | null = null

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
    title: 'Mucka Workstation',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindowRef = mainWindow
  ptyManager = new PtyManager(mainWindow.webContents)
  gitService = new GitService({
    webContents: mainWindow.webContents,
    getAgents: () => getAgentConfigs()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    gitService?.start()
  })

  mainWindow.on('closed', () => {
    gitService?.stop()
    gitService = null
    ptyManager?.killAll()
    ptyManager = null
    mainWindowRef = null
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
    // Push a fresh git status immediately so the new path shows real state.
    void gitService?.refreshOne(updated.id)
    return updated
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

  ipcMain.handle('pty:kill', (_event, agentId: AgentId) => {
    ptyManager?.kill(agentId)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('ai.mucka.workstation')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ensureSeeded()
  registerIpc()
  createWindow()
})

app.on('before-quit', () => {
  ptyManager?.killAll()
  closeDb()
})

// Single-window dev cockpit — closing the window means quitting the app.
// On macOS the default is to leave the process alive in the dock; for a
// tool you launch with `npm run dev`, that leaves a zombie process with
// no dock entry and no obvious way to bring the window back. Quit cleanly.
app.on('window-all-closed', () => {
  app.quit()
})
