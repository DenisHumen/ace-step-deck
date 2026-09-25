// Contract shared by the Electron main process, the renderer and the MCP server.

export type Lang = 'en' | 'ru'

// ─── Engine ──────────────────────────────────────────────────────────────────
export type EngineState =
  | 'not-installed'
  | 'stopped'
  | 'starting'
  | 'loading'
  | 'ready'
  | 'busy'
  | 'stopping'
  | 'error'

export interface EngineStatus {
  state: EngineState
  installed: boolean
  installPath: string | null
  pid: number | null
  external: boolean
  port: number
  startedAt: number | null
  modelsInitialized: boolean
  llmInitialized: boolean
  loadedModel: string | null
  loadedLm: string | null
  lastError: string | null
  revision: string | null
}

export interface LogLine {
  t: number
  stream: 'out' | 'err' | 'sys'
  text: string
}

// ─── System ──────────────────────────────────────────────────────────────────
export interface GpuInfo {
  name: string
  memoryTotalMB: number
  memoryUsedMB: number
  utilization: number
  temperature: number
  driver: string
}

export interface SystemInfo {
  gpus: GpuInfo[]
  ramGB: number
  diskFreeGB: number | null
  diskPath: string | null
  os: string
  hasGit: boolean
  hasUv: boolean
}

// ─── Generation ──────────────────────────────────────────────────────────────
export type TaskType = 'text2music' | 'cover' | 'repaint' | 'extract' | 'lego' | 'complete'
export type AudioFormat = 'mp3' | 'flac' | 'wav' | 'wav32' | 'opus' | 'aac'

/** Mirrors the ACE-Step REST `/release_task` body (only the fields AceDeck exposes). */
export interface GenerationParams {
  task_type: TaskType
  prompt: string
  lyrics: string
  instrumental: boolean
  sample_mode: boolean
  sample_query: string
  use_format: boolean
  model?: string
  thinking: boolean
  bpm?: number | null
  key_scale: string
  time_signature: string
  vocal_language: string
  audio_duration?: number | null
  inference_steps: number
  guidance_scale: number
  use_random_seed: boolean
  seed: number
  batch_size?: number
  src_audio_path?: string | null
  reference_audio_path?: string | null
  repainting_start: number
  repainting_end?: number | null
  repaint_mode?: 'conservative' | 'balanced' | 'aggressive'
  repaint_strength?: number
  audio_cover_strength: number
  cover_noise_strength?: number
  track_name?: string | null
  track_classes?: string[] | null
  global_caption?: string
  infer_method: 'ode' | 'sde'
  shift?: number
  use_adg: boolean
  cfg_interval_start: number
  cfg_interval_end: number
  audio_format: AudioFormat
  lm_model_path?: string | null
  lm_backend?: 'vllm' | 'pt'
  lm_temperature: number
  lm_cfg_scale: number
  lm_top_k?: number | null
  lm_top_p?: number | null
  lm_repetition_penalty: number
  lm_negative_prompt: string
  use_cot_caption: boolean
  use_cot_language: boolean
  constrained_decoding: boolean
}

export interface JobSpec {
  title?: string
  params: Partial<GenerationParams>
  /** Total number of songs to produce. */
  count: number
  /** Songs rendered per engine pass (ACE-Step batch_size). */
  batchSize: number
  source?: 'ui' | 'claude' | 'diagnostics'
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled'

export interface Job {
  id: string
  title: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  status: JobStatus
  spec: JobSpec
  runsTotal: number
  runsDone: number
  songsDone: number
  /** Overall job progress 0..1 */
  progress: number
  /** Progress of the current engine pass 0..1 */
  runProgress: number
  stage: string
  progressText: string
  taskId: string | null
  trackIds: string[]
  error: string | null
  cancelRequested: boolean
  etaSeconds: number | null
}

export interface QueueState {
  jobs: Job[]
  paused: boolean
  activeJobId: string | null
  avgRunSeconds: number | null
}

export interface Track {
  id: string
  jobId: string | null
  title: string
  file: string
  format: string
  sizeBytes: number
  durationSec: number | null
  createdAt: number
  caption: string
  lyrics: string
  bpm: number | null
  keyscale: string
  timesignature: string
  genres: string
  language: string
  seed: string
  model: string
  lmModel: string
  taskType: TaskType
  favorite: boolean
  params: Partial<GenerationParams>
}

// ─── Installer ───────────────────────────────────────────────────────────────
export type InstallStepId = 'system' | 'uv' | 'source' | 'deps' | 'models' | 'config' | 'verify'
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped'

export interface InstallStep {
  id: InstallStepId
  status: StepStatus
  /** null = indeterminate */
  progress: number | null
  detail: string
  error?: string
}

export interface InstallState {
  running: boolean
  finished: boolean
  cancelled: boolean
  targetPath: string | null
  steps: InstallStep[]
  overall: number
  error: string | null
  startedAt: number | null
  log: LogLine[]
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────
export type CheckStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail' | 'skip'

export interface DiagCheck {
  id: string
  group: 'system' | 'install' | 'engine' | 'stress'
  status: CheckStatus
  value?: string
  detail?: string
  durationMs?: number
}

export interface DiagSample {
  index: number
  ok: boolean
  seconds: number
  vramPeakMB: number | null
  error?: string
}

export interface DiagnosticsState {
  running: boolean
  mode: 'quick' | 'full' | null
  checks: DiagCheck[]
  samples: DiagSample[]
  verdict: 'stable' | 'unstable' | 'failed' | null
  score: number | null
  startedAt: number | null
  finishedAt: number | null
}

// ─── Models ──────────────────────────────────────────────────────────────────
export interface ModelInfo {
  name: string
  kind: 'core' | 'dit' | 'lm'
  repo: string
  approxGB: number
  installed: boolean
  downloading: boolean
  progress: number | null
  bundled: boolean
}

// ─── Settings ────────────────────────────────────────────────────────────────
export interface Settings {
  language: Lang
  installPath: string | null
  outputDir: string
  port: number
  ditModel: string
  lmModel: string
  lmBackend: 'auto' | 'pt' | 'vllm'
  initLlm: 'auto' | 'true' | 'false'
  offload: 'auto' | 'on' | 'off'
  preloadModels: boolean
  autoStartEngine: boolean
  stopEngineOnExit: boolean
  controlApiEnabled: boolean
  controlApiPort: number
  notifyOnFinish: boolean
  onboarded: boolean
}

export interface AppInfo {
  version: string
  platform: string
  userData: string
  exePath: string
  mcpServerPath: string
  controlFile: string
  isPackaged: boolean
}

export interface SampleResult {
  caption: string
  lyrics: string
  bpm?: number | null
  key_scale?: string
  time_signature?: string
  duration?: number | null
  vocal_language?: string
}

export type PageId = 'create' | 'queue' | 'library' | 'engine' | 'diagnostics' | 'models' | 'setup' | 'settings' | 'claude'

export interface EventMap {
  'engine:status': EngineStatus
  'engine:log': LogLine
  'queue:update': QueueState
  'library:update': Track[]
  'install:update': InstallState
  'diag:update': DiagnosticsState
  'models:update': ModelInfo[]
  'settings:update': Settings
  'system:update': SystemInfo
  'ui:navigate': PageId
}
