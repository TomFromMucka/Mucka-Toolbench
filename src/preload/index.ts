import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AgentConfig,
  AgentId,
  AgentStatusEvent,
  AgentUpdate,
  CockpitDocPayload,
  Memory,
  MemoryListItem,
  MemoryListQuery,
  MemoryWriteInput,
  GitStatus,
  GitStatusEvent,
  JobEvent,
  MicAccess,
  MuckaApi,
  MuckaStatus,
  MuckaTextMessage,
  MuckaTextStatus,
  MuckaTextStreamEvent,
  MuckaTextToolCall,
  MuckaTextToolResult,
  VoiceTranscriptInput,
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
  startAgent: (agentId: AgentId) =>
    ipcRenderer.invoke('agents:start', agentId) as Promise<AgentConfig>,
  stopAgent: (agentId: AgentId) =>
    ipcRenderer.invoke('agents:stop', agentId) as Promise<AgentConfig>,
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

  onAgentStatus: (handler: (event: AgentStatusEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: AgentStatusEvent) =>
      handler(payload)
    ipcRenderer.on('agent:status', listener)
    return () => ipcRenderer.off('agent:status', listener)
  },

  getScrollback: (terminalId: TerminalId) =>
    ipcRenderer.invoke('pty:scrollback', terminalId) as Promise<string>,

  notifyAttention: (count: number) =>
    ipcRenderer.send('app:notify-attention', count),

  getMuckaStatus: () =>
    ipcRenderer.invoke('mucka:status') as Promise<MuckaStatus>,
  mintMuckaSignedUrl: () =>
    ipcRenderer.invoke('mucka:signedUrl') as Promise<string>,
  requestMicAccess: () =>
    ipcRenderer.invoke('mucka:requestMic') as Promise<MicAccess>,
  openMicSettings: () =>
    ipcRenderer.invoke('mucka:openMicSettings') as Promise<void>,

  getMuckaTextStatus: () =>
    ipcRenderer.invoke('mucka:text-status') as Promise<MuckaTextStatus>,
  listChatHistory: () =>
    ipcRenderer.invoke('mucka:text-history') as Promise<MuckaTextMessage[]>,
  sendChatMessage: (text: string) =>
    ipcRenderer.invoke('mucka:text-send', text) as Promise<void>,
  clearChatHistory: () =>
    ipcRenderer.invoke('mucka:text-clear') as Promise<void>,
  sendChatToolResult: (result: MuckaTextToolResult) =>
    ipcRenderer.send('mucka:text-tool-result', result),
  appendVoiceTranscript: (input: VoiceTranscriptInput) =>
    ipcRenderer.send('mucka:voice-transcript', input),
  getCockpitDoc: (section?: string) =>
    ipcRenderer.invoke('mucka:cockpit-doc', section) as Promise<CockpitDocPayload>,

  listMemories: (query?: MemoryListQuery) =>
    ipcRenderer.invoke('memory:list', query) as Promise<MemoryListItem[]>,
  getMemory: (topic: string) =>
    ipcRenderer.invoke('memory:get', topic) as Promise<Memory | null>,
  rememberMemory: (input: MemoryWriteInput) =>
    ipcRenderer.invoke('memory:remember', input) as Promise<Memory>,
  forgetMemory: (topic: string) =>
    ipcRenderer.invoke('memory:forget', topic) as Promise<boolean>,
  onChatStream: (handler: (event: MuckaTextStreamEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: MuckaTextStreamEvent) =>
      handler(payload)
    ipcRenderer.on('mucka:text-stream', listener)
    return () => ipcRenderer.off('mucka:text-stream', listener)
  },
  onChatToolCall: (handler: (call: MuckaTextToolCall) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: MuckaTextToolCall) =>
      handler(payload)
    ipcRenderer.on('mucka:text-tool-call', listener)
    return () => ipcRenderer.off('mucka:text-tool-call', listener)
  },
  onChatMessage: (handler: (message: MuckaTextMessage) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: MuckaTextMessage) =>
      handler(payload)
    ipcRenderer.on('mucka:text-message', listener)
    return () => ipcRenderer.off('mucka:text-message', listener)
  },

  getNote: () => ipcRenderer.invoke('notes:get') as Promise<string>,
  setNote: (value: string) =>
    ipcRenderer.invoke('notes:set', value) as Promise<void>,
  appendNote: (chunk: string) =>
    ipcRenderer.invoke('notes:append', chunk) as Promise<string>,
  onNoteUpdate: (handler: (value: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: string) =>
      handler(payload)
    ipcRenderer.on('notes:update', listener)
    return () => ipcRenderer.off('notes:update', listener)
  },

  listEvents: (limit?: number) =>
    ipcRenderer.invoke('events:list', limit) as Promise<JobEvent[]>,
  onEventAppend: (handler: (event: JobEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: JobEvent) =>
      handler(payload)
    ipcRenderer.on('events:append', listener)
    return () => ipcRenderer.off('events:append', listener)
  },

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
