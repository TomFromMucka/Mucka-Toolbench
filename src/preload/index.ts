import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentConfig,
  AgentId,
  AgentUpdate,
  GitStatus,
  GitStatusEvent,
  MicAccess,
  MuckaApi,
  MuckaStatus,
  PtyDataEvent,
  PtyExitEvent,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest
} from '@shared/types'

const muckaApi: MuckaApi = {
  listAgents: () => ipcRenderer.invoke('agents:list') as Promise<AgentConfig[]>,
  updateAgent: (patch: AgentUpdate) =>
    ipcRenderer.invoke('agents:update', patch) as Promise<AgentConfig>,
  pickDirectory: (opts?: { defaultPath?: string }) =>
    ipcRenderer.invoke('dialog:pickDirectory', opts) as Promise<string | null>,
  spawnPty: (req: PtySpawnRequest) =>
    ipcRenderer.invoke('pty:spawn', req) as Promise<void>,
  writePty: (req: PtyWriteRequest) => ipcRenderer.send('pty:write', req),
  resizePty: (req: PtyResizeRequest) => ipcRenderer.send('pty:resize', req),
  killPty: (agentId: AgentId) =>
    ipcRenderer.invoke('pty:kill', agentId) as Promise<void>,

  onPtyData: (handler: (event: PtyDataEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: PtyDataEvent) =>
      handler(payload)
    ipcRenderer.on('pty:data', listener)
    return () => ipcRenderer.off('pty:data', listener)
  },

  onPtyExit: (handler: (event: PtyExitEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: PtyExitEvent) =>
      handler(payload)
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.off('pty:exit', listener)
  },

  refreshGit: (agentId: AgentId) =>
    ipcRenderer.invoke('git:refresh', agentId) as Promise<GitStatus>,

  onGitStatus: (handler: (event: GitStatusEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: GitStatusEvent) =>
      handler(payload)
    ipcRenderer.on('git:status', listener)
    return () => ipcRenderer.off('git:status', listener)
  },

  getScrollback: (agentId: AgentId) =>
    ipcRenderer.invoke('pty:scrollback', agentId) as Promise<string>,

  getMuckaStatus: () =>
    ipcRenderer.invoke('mucka:status') as Promise<MuckaStatus>,
  mintMuckaSignedUrl: () =>
    ipcRenderer.invoke('mucka:signedUrl') as Promise<string>,
  requestMicAccess: () =>
    ipcRenderer.invoke('mucka:requestMic') as Promise<MicAccess>,
  openMicSettings: () =>
    ipcRenderer.invoke('mucka:openMicSettings') as Promise<void>
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('mucka', muckaApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore: define in dts
  window.electron = electronAPI
  // @ts-ignore: define in dts
  window.mucka = muckaApi
}
