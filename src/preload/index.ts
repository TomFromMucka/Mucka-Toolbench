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
  BroadcastResult,
  MemoryListQuery,
  MemoryWriteInput,
  FilePreview,
  FsListing,
  RoadmapAttachment,
  RoadmapCard,
  RoadmapCreateInput,
  RoadmapMoveInput,
  RoadmapUpdateInput,
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
  GitHubUpdateEvent,
  PrReviewContext,
  PrReviewSubmission,
  PrReviewSubmitted,
  UpdaterStatus
} from '@shared/types'
import type { SecretId, SecretStatus, SecretTestResult } from '@shared/secrets'
import type {
  CredentialCreateInput,
  CredentialSummary,
  CredentialUpdateInput
} from '@shared/credentials'
import type {
  BrowserSlotId,
  OpenTabInput as BrowserOpenTabInput,
  SetSlotBoundsInput as BrowserSetSlotBoundsInput,
  TabId as BrowserTabId,
  TabState as BrowserTabState
} from '@shared/browser'

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
  searchHistory: (query: string, limit?: number) =>
    ipcRenderer.invoke('mucka:text-search', query, limit) as Promise<string>,
  sendChatToolResult: (result: MuckaTextToolResult) =>
    ipcRenderer.send('mucka:text-tool-result', result),
  appendVoiceTranscript: (input: VoiceTranscriptInput) =>
    ipcRenderer.send('mucka:voice-transcript', input),
  getCockpitDoc: (section?: string) =>
    ipcRenderer.invoke('mucka:cockpit-doc', section) as Promise<CockpitDocPayload>,
  getProductDoc: (section?: string) =>
    ipcRenderer.invoke('mucka:product-doc', section) as Promise<CockpitDocPayload>,

  listMemories: (query?: MemoryListQuery) =>
    ipcRenderer.invoke('memory:list', query) as Promise<MemoryListItem[]>,
  getMemory: (topic: string) =>
    ipcRenderer.invoke('memory:get', topic) as Promise<Memory | null>,
  rememberMemory: (input: MemoryWriteInput) =>
    ipcRenderer.invoke('memory:remember', input) as Promise<Memory>,
  forgetMemory: (topic: string) =>
    ipcRenderer.invoke('memory:forget', topic) as Promise<boolean>,

  listRoadmap: () =>
    ipcRenderer.invoke('roadmap:list') as Promise<RoadmapCard[]>,
  createRoadmapCard: (input: RoadmapCreateInput) =>
    ipcRenderer.invoke('roadmap:create', input) as Promise<RoadmapCard>,
  updateRoadmapCard: (input: RoadmapUpdateInput) =>
    ipcRenderer.invoke('roadmap:update', input) as Promise<RoadmapCard>,
  moveRoadmapCard: (input: RoadmapMoveInput) =>
    ipcRenderer.invoke('roadmap:move', input) as Promise<RoadmapCard>,
  deleteRoadmapCard: (id: string) =>
    ipcRenderer.invoke('roadmap:delete', id) as Promise<boolean>,
  onRoadmapUpdate: (handler: () => void) => {
    const listener = (): void => handler()
    ipcRenderer.on('roadmap:update', listener)
    return () => ipcRenderer.off('roadmap:update', listener)
  },
  attachRoadmapImage: (input: { cardId: string; name: string; bytes: Uint8Array }) =>
    ipcRenderer.invoke('roadmap:attachImage', input) as Promise<RoadmapAttachment>,

  broadcastToAgents: (input: { text: string; agentIds?: AgentId[] }) =>
    ipcRenderer.invoke('broadcast:send', input) as Promise<BroadcastResult>,

  listDir: (path: string) =>
    ipcRenderer.invoke('fs:listDir', path) as Promise<FsListing>,
  readFilePreview: (path: string) =>
    ipcRenderer.invoke('fs:readFile', path) as Promise<FilePreview>,
  revealInOs: (path: string) =>
    ipcRenderer.invoke('fs:reveal', path) as Promise<void>,
  openPathInOs: (path: string) =>
    ipcRenderer.invoke('fs:openPath', path) as Promise<void>,
  createFile: (parentPath: string, name: string) =>
    ipcRenderer.invoke('fs:createFile', parentPath, name) as Promise<string>,
  createFolder: (parentPath: string, name: string) =>
    ipcRenderer.invoke('fs:createFolder', parentPath, name) as Promise<string>,
  renamePath: (fromPath: string, toName: string) =>
    ipcRenderer.invoke('fs:rename', fromPath, toName) as Promise<string>,
  deletePath: (path: string) =>
    ipcRenderer.invoke('fs:delete', path) as Promise<void>,
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
  },

  fetchPrReviewContext: (agentId: AgentId) =>
    ipcRenderer.invoke('github:review-context', agentId) as Promise<PrReviewContext>,
  submitPrReview: (input: PrReviewSubmission) =>
    ipcRenderer.invoke('github:review-submit', input) as Promise<PrReviewSubmitted>,

  getCurrentAppVersion: () => {
    // ipcRenderer.invoke is async; the type contract is `string`, so we
    // surface a synchronous fallback via the bridge — main has already
    // set this at startup.
    return (window as unknown as { __muckaVersion?: string }).__muckaVersion ?? ''
  },
  checkForUpdates: () =>
    ipcRenderer.invoke('updater:check') as Promise<UpdaterStatus>,
  downloadUpdate: () =>
    ipcRenderer.invoke('updater:download') as Promise<void>,
  installUpdate: () =>
    ipcRenderer.invoke('updater:install') as Promise<void>,
  onUpdaterStatus: (handler: (status: UpdaterStatus) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: UpdaterStatus) =>
      handler(payload)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.off('updater:status', listener)
  },
  listSecrets: () =>
    ipcRenderer.invoke('secrets:list') as Promise<SecretStatus[]>,
  setSecret: (id: SecretId, value: string) =>
    ipcRenderer.invoke('secrets:set', id, value) as Promise<SecretStatus[]>,
  clearSecret: (id: SecretId) =>
    ipcRenderer.invoke('secrets:clear', id) as Promise<SecretStatus[]>,
  testSecret: (id: SecretId) =>
    ipcRenderer.invoke('secrets:test', id) as Promise<SecretTestResult>,
  listCredentials: () =>
    ipcRenderer.invoke('credentials:list') as Promise<CredentialSummary[]>,
  createCredential: (input: CredentialCreateInput) =>
    ipcRenderer.invoke('credentials:create', input) as Promise<CredentialSummary[]>,
  updateCredential: (input: CredentialUpdateInput) =>
    ipcRenderer.invoke('credentials:update', input) as Promise<CredentialSummary[]>,
  deleteCredential: (id: string) =>
    ipcRenderer.invoke('credentials:delete', id) as Promise<CredentialSummary[]>,
  watchDir: (path: string) =>
    ipcRenderer.invoke('fs:watch', path) as Promise<void>,
  unwatchDir: (path: string) =>
    ipcRenderer.invoke('fs:unwatch', path) as Promise<void>,
  onFsChange: (handler: (event: { path: string }) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      payload: { path: string }
    ): void => handler(payload)
    ipcRenderer.on('fs:changed', listener)
    return () => ipcRenderer.off('fs:changed', listener)
  },
  listBrowserTabs: () =>
    ipcRenderer.invoke('browser:list') as Promise<BrowserTabState[]>,
  openBrowserTab: (input: BrowserOpenTabInput) =>
    ipcRenderer.invoke('browser:open', input) as Promise<BrowserTabId | null>,
  closeBrowserTab: (tabId: BrowserTabId) =>
    ipcRenderer.invoke('browser:close', tabId) as Promise<void>,
  switchBrowserTab: (tabId: BrowserTabId) =>
    ipcRenderer.invoke('browser:switch', tabId) as Promise<void>,
  navigateBrowserTab: (tabId: BrowserTabId, url: string) =>
    ipcRenderer.invoke('browser:navigate', tabId, url) as Promise<void>,
  browserBack: (tabId: BrowserTabId) =>
    ipcRenderer.invoke('browser:back', tabId) as Promise<void>,
  browserForward: (tabId: BrowserTabId) =>
    ipcRenderer.invoke('browser:forward', tabId) as Promise<void>,
  browserReload: (tabId: BrowserTabId) =>
    ipcRenderer.invoke('browser:reload', tabId) as Promise<void>,
  setBrowserBounds: (input: BrowserSetSlotBoundsInput) =>
    ipcRenderer.invoke('browser:set-bounds', input) as Promise<void>,
  setBrowserZoom: (slotId: BrowserSlotId, factor: number) =>
    ipcRenderer.invoke('browser:set-zoom', slotId, factor) as Promise<void>,
  raiseBrowserSlot: (slotId: BrowserSlotId) =>
    ipcRenderer.invoke('browser:raise', slotId) as Promise<void>,
  onBrowserState: (handler: (tabs: BrowserTabState[]) => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      tabs: BrowserTabState[]
    ): void => handler(tabs)
    ipcRenderer.on('browser:state', listener)
    return () => ipcRenderer.off('browser:state', listener)
  }
}

// Resolve the app version once at preload boot so the renderer can read
// it synchronously through MuckaApi.getCurrentAppVersion.
ipcRenderer
  .invoke('updater:version')
  .then((v: string) => {
    ;(window as unknown as { __muckaVersion?: string }).__muckaVersion = v
  })
  .catch(() => {
    /* fallback to empty string */
  })

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
