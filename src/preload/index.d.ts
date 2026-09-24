import type { GpApi } from '../shared/api'

declare global {
  interface Window {
    gp: GpApi
  }
}

export {}
