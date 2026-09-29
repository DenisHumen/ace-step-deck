import { create } from 'zustand'
import type {
  DiagnosticsState,
  EngineStatus,
  GenerationParams,
  InstallState,
  LogLine,
  ModelInfo,
  PageId,
  QueueState,
  Settings,
  SystemInfo,
  Track,
  UpdateStatus,
} from '@shared/types'
import type { VideoClip, VideoEngineStatus, VideoInstallState, VideoModelInfo, VideoParams, VideoQueueState } from '@shared/video'
import { api } from './api'
import { translate } from '../i18n'

export interface Toast {
  id: number
  kind: 'ok' | 'err' | 'info'
  text: string
}

/** Prefill handed from Library/Queue to the Create page. */
export interface CreatePrefill {
  mode: 'simple' | 'custom' | 'cover' | 'repaint'
  params: Partial<GenerationParams>
  nonce: number
}

interface AppState {
  page: PageId
  settings: Settings | null
  engine: EngineStatus | null
  logs: LogLine[]
  system: SystemInfo | null
  queue: QueueState
  tracks: Track[]
  install: InstallState | null
  diag: DiagnosticsState | null
  models: ModelInfo[]
  update: UpdateStatus | null
  toasts: Toast[]
  search: string
  player: { trackId: string | null; playing: boolean; queueIds: string[] }
  prefill: CreatePrefill | null
  videoEngine: VideoEngineStatus | null
  videoLogs: LogLine[]
  videoQueue: VideoQueueState
  clips: VideoClip[]
  videoInstall: VideoInstallState | null
  videoModels: VideoModelInfo[]
  /** Library → "Reuse settings" for the video studio. */
  videoPrefill: { params: VideoParams; nonce: number } | null
  go: (p: PageId) => void
  toast: (text: string, kind?: Toast['kind']) => void
  play: (id: string, list?: string[]) => void
  setPlaying: (b: boolean) => void
  setSearch: (s: string) => void
  setPrefill: (p: Omit<CreatePrefill, 'nonce'>) => void
  setVideoPrefill: (params: VideoParams) => void
}

let toastId = 0

export const useApp = create<AppState>((set, get) => ({
  page: 'create',
  settings: null,
  engine: null,
  logs: [],
  system: null,
  queue: { jobs: [], paused: false, activeJobId: null, avgRunSeconds: null },
  tracks: [],
  install: null,
  diag: null,
  models: [],
  update: null,
  toasts: [],
  search: '',
  player: { trackId: null, playing: false, queueIds: [] },
  prefill: null,
  videoEngine: null,
  videoLogs: [],
  videoQueue: { jobs: [], paused: false, activeJobId: null, secondsPerCost: null },
  clips: [],
  videoInstall: null,
  videoModels: [],
  videoPrefill: null,
  go: (page) => set({ page }),
  toast: (text, kind = 'info') => {
    const id = ++toastId
    set({ toasts: [...get().toasts, { id, kind, text }] })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'err' ? 6500 : 3500)
  },
  play: (id, list) => set({ player: { trackId: id, playing: true, queueIds: list ?? get().player.queueIds } }),
  setPlaying: (playing) => set({ player: { ...get().player, playing } }),
  setSearch: (search) => set({ search }),
  setPrefill: (p) => set({ prefill: { ...p, nonce: Date.now() }, page: 'create' }),
  setVideoPrefill: (params) => set({ videoPrefill: { params, nonce: Date.now() }, page: 'video' }),
}))

/** Initial fetch + live subscriptions to main-process events. */
export async function bootstrap(): Promise<void> {
  const [settings, engine, logs, queue, tracks, install, diag, models, system, update] = await Promise.all([
    api.settings(),
    api.engineStatus(),
    api.engineLogs(),
    api.queueState(),
    api.library(),
    api.installState(),
    api.diagState(),
    api.models(),
    api.systemInfo(),
    api.updateStatus(),
  ])
  useApp.setState({ settings, engine, logs: logs.slice(-1500), queue, tracks, install, diag, models, system, update })
  const [videoEngine, videoLogs, videoQueue, clips, videoInstall, videoModels] = await Promise.all([
    api.videoStatus(),
    api.videoLogs(),
    api.videoQueueState(),
    api.clips(),
    api.videoInstallState(),
    api.videoModels(),
  ])
  useApp.setState({ videoEngine, videoLogs: videoLogs.slice(-1500), videoQueue, clips, videoInstall, videoModels })
  if (!engine.installed && !install.running) useApp.setState({ page: 'setup' })

  api.on('settings:update', (settings) => useApp.setState({ settings }))
  api.on('engine:status', (engine) => useApp.setState({ engine }))
  api.on('engine:log', (line) => {
    const logs = useApp.getState().logs
    const next = logs.length > 1500 ? logs.slice(-1200) : logs.slice()
    next.push(line)
    useApp.setState({ logs: next })
  })
  api.on('queue:update', (queue) => useApp.setState({ queue }))
  api.on('library:update', (tracks) => useApp.setState({ tracks }))
  api.on('install:update', (install) => useApp.setState({ install }))
  api.on('diag:update', (diag) => useApp.setState({ diag }))
  api.on('models:update', (models) => useApp.setState({ models }))
  api.on('system:update', (system) => useApp.setState({ system }))
  api.on('ui:navigate', (page) => useApp.setState({ page }))
  api.on('video:status', (videoEngine) => useApp.setState({ videoEngine }))
  api.on('video:log', (line) => {
    const logs = useApp.getState().videoLogs
    const next = logs.length > 1500 ? logs.slice(-1200) : logs.slice()
    next.push(line)
    useApp.setState({ videoLogs: next })
  })
  api.on('video:queue', (videoQueue) => useApp.setState({ videoQueue }))
  api.on('video:library', (clips) => useApp.setState({ clips }))
  api.on('video:install', (videoInstall) => useApp.setState({ videoInstall }))
  api.on('video:models', (videoModels) => useApp.setState({ videoModels }))
  api.on('update:status', (update) => {
    const prev = useApp.getState().update
    useApp.setState({ update })
    if (update.state === 'available' && (prev?.state !== 'available' || prev.latest !== update.latest)) {
      useApp.getState().toast(translate(useApp.getState().settings?.language ?? 'en', 'update.toast', { v: update.latest ?? '' }), 'info')
    }
  })
}

/** Run an action and surface failures as a toast. */
export async function attempt<T>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> {
  try {
    const r = await fn()
    if (okText) useApp.getState().toast(okText, 'ok')
    return r
  } catch (e: any) {
    useApp.getState().toast(e?.message ?? String(e), 'err')
    return undefined
  }
}
