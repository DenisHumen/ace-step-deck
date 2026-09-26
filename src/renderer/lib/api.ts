import type {
  AppInfo,
  DiagnosticsState,
  EngineStatus,
  EventMap,
  InstallState,
  Job,
  JobSpec,
  LogLine,
  ModelInfo,
  QueueState,
  SampleResult,
  UpdateStatus,
  Settings,
  SystemInfo,
  Track,
} from '@shared/types'

interface Bridge {
  invoke: (method: string, ...args: unknown[]) => Promise<any>
  on: (channel: string, cb: (payload: any) => void) => () => void
}

declare global {
  interface Window {
    acedeck: Bridge
  }
}

const b = () => window.acedeck
const call = <T,>(method: string, ...args: unknown[]) => b().invoke(method, ...args) as Promise<T>

export interface InstallInspection {
  path: string
  source: boolean
  venv: boolean
  mainModels: boolean
  hasTriton: boolean
  isGit: boolean
  revision: string | null
}

export interface McpConfig {
  command: string
  args: string[]
  env: Record<string, string>
  claudeCodeCommand: string
  desktopJson: string
  desktopConfigPath: string
  desktopInstalled: boolean
}

export const api = {
  on: <K extends keyof EventMap>(channel: K, cb: (payload: EventMap[K]) => void) => b().on(channel, cb),

  appInfo: () => call<AppInfo>('app.info'),
  openExternal: (url: string) => call('app.openExternal', url),
  createShortcut: () => call<string>('app.createShortcut'),
  updateStatus: () => call<UpdateStatus>('update.status'),
  updateCheck: () => call<UpdateStatus>('update.check'),
  updateDownload: () => call<UpdateStatus>('update.download'),
  updateInstall: () => call<void>('update.install'),
  updateOpenPage: () => call<void>('update.openPage'),
  openPath: (p: string) => call('app.openPath', p),
  mcpConfig: () => call<McpConfig>('app.mcpConfig'),
  installClaudeDesktop: () => call<string>('app.installClaudeDesktop'),

  settings: () => call<Settings>('settings.get'),
  setSettings: (patch: Partial<Settings>) => call<Settings>('settings.set', patch),

  engineStatus: () => call<EngineStatus>('engine.status'),
  engineStart: () => call<void>('engine.start'),
  engineStop: () => call<void>('engine.stop'),
  engineRestart: () => call<void>('engine.restart'),
  engineLogs: () => call<LogLine[]>('engine.logs'),
  engineClearLogs: () => call<void>('engine.clearLogs'),
  engineUpdate: () => call<string>('engine.update'),
  engineDetect: () => call<InstallInspection[]>('engine.detect'),
  engineUseInstall: (path: string) => call<InstallInspection>('engine.useInstall', path),
  engineInspect: () => call<InstallInspection | null>('engine.inspect'),

  systemInfo: () => call<SystemInfo>('system.info'),

  installState: () => call<InstallState>('install.state'),
  installStart: (path: string) => call<boolean>('install.start', path),
  installCancel: () => call<void>('install.cancel'),
  installDefaultPath: () => call<string>('install.defaultPath'),

  queueState: () => call<QueueState>('queue.state'),
  queueAdd: (spec: JobSpec) => call<Job>('queue.add', spec),
  queueCancel: (id: string) => call('queue.cancel', id),
  queueRemove: (id: string) => call('queue.remove', id),
  queueMove: (id: string, dir: 'up' | 'down' | 'top') => call('queue.move', id, dir),
  queueRetry: (id: string) => call('queue.retry', id),
  queueDuplicate: (id: string) => call('queue.duplicate', id),
  queuePause: () => call('queue.pause'),
  queueResume: () => call('queue.resume'),
  queueClearFinished: () => call('queue.clearFinished'),

  library: () => call<Track[]>('library.list'),
  trackUpdate: (id: string, patch: Partial<Pick<Track, 'title' | 'favorite'>>) => call<Track>('library.update', id, patch),
  trackRemove: (id: string) => call('library.remove', id),
  trackSaveAs: (id: string) => call<string | null>('library.saveAs', id),
  trackReveal: (id: string) => call('library.reveal', id),
  openLibraryFolder: () => call('library.openFolder'),

  models: () => call<ModelInfo[]>('models.list'),
  modelDownload: (name: string) => call('models.download', name),

  diagState: () => call<DiagnosticsState>('diag.state'),
  diagRun: (mode: 'quick' | 'full') => call('diag.run', mode),
  diagCancel: () => call('diag.cancel'),

  aiCreateSample: (query: string, instrumental: boolean, lang: string) => call<SampleResult>('ai.createSample', query, instrumental, lang),
  aiFormat: (caption: string, lyrics: string, meta: Record<string, unknown>) => call<SampleResult>('ai.formatInput', caption, lyrics, meta),
  aiRandom: (type: 'simple_mode' | 'custom_mode') => call<SampleResult>('ai.randomSample', type),

  pickFolder: (defaultPath?: string) => call<string | null>('dialog.pickFolder', defaultPath),
  pickAudio: () => call<string | null>('dialog.pickAudio'),
}

export const trackUrl = (id: string) => `acedeck-media://track/${encodeURIComponent(id)}`
export const fileUrl = (path: string) => `acedeck-media://file/${encodeURIComponent(path)}`
