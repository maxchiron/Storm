import type { StormApi } from '@shared/api'

declare global {
  interface Window {
    storm: StormApi
  }
}

export {}
