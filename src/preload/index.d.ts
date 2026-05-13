import { ElectronAPI } from '@electron-toolkit/preload'
import type { MuckaApi } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    mucka: MuckaApi
  }
}

export {}
