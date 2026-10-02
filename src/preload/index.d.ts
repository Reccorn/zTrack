import type { ZApi } from '../shared/types'

declare global {
  interface Window {
    api: ZApi
  }
}

export {}
