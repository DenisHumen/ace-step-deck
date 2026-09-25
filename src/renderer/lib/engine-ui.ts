import type { EngineState } from '@shared/types'

export function engineTone(state: EngineState | undefined): 'mint' | 'amber' | 'rose' | 'dim' | 'cyan' | 'magenta' {
  switch (state) {
    case 'ready':
      return 'mint'
    case 'busy':
      return 'magenta'
    case 'starting':
    case 'loading':
    case 'stopping':
      return 'amber'
    case 'error':
      return 'rose'
    case 'stopped':
      return 'dim'
    default:
      return 'dim'
  }
}

export const isTransitional = (s: EngineState | undefined) => s === 'starting' || s === 'loading' || s === 'stopping'
export const isUp = (s: EngineState | undefined) => s === 'ready' || s === 'busy'
