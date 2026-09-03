import type { MuckaApi } from '@shared/types'

declare global {
  interface Window {
    mucka: MuckaApi
  }
}

export {}
