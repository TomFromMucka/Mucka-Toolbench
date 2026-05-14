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
  Notice,
  NoticeInput,
  PtyDataEvent,
  PtyExitEvent,
  PtyResizeRequest,
  PtySpawnRequest,
  PtyWriteRequest,
  TerminalId,
  VercelAgentSummary,
  VercelStatus,
  VercelUpdateEvent,
  GitHubAgentSummary,
  GitHubStatus,
  GitHubUpdateEvent
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
  killPty: (terminalId: TerminalId) =>
    ipcRenderer.invoke('pty:kill', terminalId) as Promise<void>,

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

  getScrollback: (terminalId: TerminalId) =>
    ipcRenderer.invoke('pty:scrollback', terminalId) as Promise<string>,

  getMuckaStatus: () =>
    ipcRenderer.invoke('mucka:status') as Promise<MuckaStatus>,
  mintMuckaSignedUrl: () =>
    ipcRenderer.invoke('mucka:signedUrl') as Promise<string>,
  requestMicAccess: () =>
    ipcRenderer.invoke('mucka:requestMic') as Promise<MicAccess>,
  openMicSettings: () =>
    ipcRenderer.invoke('mucka:openMicSettings') as Promise<void>,

  listNotices: () => ipcRenderer.invoke('notices:list') as Promise<Notice[]>,
  addNotice: (input: NoticeInput) =>
    ipcRenderer.invoke('notices:add', input) as Promise<Notice>,
  removeNotice: (id: string) =>
    ipcRenderer.invoke('notices:remove', id) as Promise<boolean>,
  removeNoticeByTitle: (title: string) =>
    ipcRenderer.invoke('notices:removeByTitle', title) as Promise<number>,

  getVercelStatus: () =>
    ipcRenderer.invoke('vercel:status') as Promise<VercelStatus>,
  listVercelDeployments: (agentId: AgentId) =>
    ipcRenderer.invoke('vercel:get', agentId) as Promise<VercelAgentSummary>,
  listAllVercelDeployments: () =>
    ipcRenderer.invoke('vercel:getAll') as Promise<
      Record<AgentId, VercelAgentSummary>
    >,
  refreshVercel: (agentId: AgentId) =>
    ipcRenderer.invoke('vercel:refresh', agentId) as Promise<VercelAgentSummary>,
  onVercelUpdate: (handler: (event: VercelUpdateEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: VercelUpdateEvent) =>
      handler(payload)
    ipcRenderer.on('vercel:update', listener)
    return () => ipcRenderer.off('vercel:update', listener)
  },

  getGitHubStatus: () =>
    ipcRenderer.invoke('github:status') as Promise<GitHubStatus>,
  listGitHubSummary: (agentId: AgentId) =>
    ipcRenderer.invoke('github:get', agentId) as Promise<GitHubAgentSummary>,
  listAllGitHubSummaries: () =>
    ipcRenderer.invoke('github:getAll') as Promise<
      Record<AgentId, GitHubAgentSummary>
    >,
  refreshGitHub: (agentId: AgentId) =>
    ipcRenderer.invoke('github:refresh', agentId) as Promise<GitHubAgentSummary>,
  onGitHubUpdate: (handler: (event: GitHubUpdateEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: GitHubUpdateEvent) =>
      handler(payload)
    ipcRenderer.on('github:update', listener)
    return () => ipcRenderer.off('github:update', listener)
  }
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
