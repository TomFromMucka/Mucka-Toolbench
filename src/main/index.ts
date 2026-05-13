import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getAgentConfigs } from './config/agents'
import { PtyManager } from './pty/PtyManager'
import type {
  AgentId,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest
} from '@shared/types'

let ptyManager: PtyManager | null = null

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

  ptyManager = new PtyManager(mainWindow.webContents)

  mainWindow.on('closed', () => {
    ptyManager?.killAll()
    ptyManager = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
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

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ptyManager?.killAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
