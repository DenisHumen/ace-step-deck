// Video studio: Wan 2.1 text-to-video rendered by a local ComfyUI server.
// Shared by the main process and the renderer; everything here is pure (unit-tested in tests/video.test.ts).
import type { EngineState, InstallState, JobStatus } from './types'

export const COMFY_REPO_GIT = 'https://github.com/comfyanonymous/ComfyUI.git'
export const COMFY_REPO_ZIP = 'https://github.com/comfyanonymous/ComfyUI/archive/refs/heads/master.zip'
/** torch venv (~6 GB) + text encoder, VAE and one 1.3B checkpoint (~10 GB) + headroom. */
export const VIDEO_REQUIRED_DISK_GB = 20
/** Below this much free VRAM AceDeck pauses the music engine while a video renders. */
export const VIDEO_MIN_FREE_VRAM_MB = 9000

export const WAN_TEXT_ENCODER = 'umt5_xxl_fp8_e4m3fn_scaled.safetensors'
export const WAN_VAE = 'wan_2.1_vae.safetensors'
export const WAN_T2V_1_3B = 'wan2.1_t2v_1.3B_bf16.safetensors'

// ─── Models ──────────────────────────────────────────────────────────────────
export type VideoModelKind = 'diffusion' | 'lora' | 'text_encoder' | 'vae'

/** ComfyUI `models/` sub-folder for each kind. */
export const VIDEO_MODEL_DIRS: Record<VideoModelKind, string> = {
  diffusion: 'diffusion_models',
  lora: 'loras',
  text_encoder: 'text_encoders',
  vae: 'vae',
}

export interface VideoModelEntry {
  file: string
  kind: VideoModelKind
  url: string | null
  approxGB: number
}

const REPACK = 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files'

/** Downloaded by the installer; everything else is added by the user (Hugging Face link or a local file). */
export const VIDEO_MODEL_CATALOG: VideoModelEntry[] = [
  { file: WAN_TEXT_ENCODER, kind: 'text_encoder', url: `${REPACK}/text_encoders/${WAN_TEXT_ENCODER}`, approxGB: 6.7 },
  { file: WAN_VAE, kind: 'vae', url: `${REPACK}/vae/${WAN_VAE}`, approxGB: 0.25 },
  { file: WAN_T2V_1_3B, kind: 'diffusion', url: `${REPACK}/diffusion_models/${WAN_T2V_1_3B}`, approxGB: 2.8 },
]

export interface VideoModelInfo extends VideoModelEntry {
  /** Part of the base install (catalog). */
  bundled: boolean
  /** Added by the user from a link; can be re-downloaded. */
  custom: boolean
  installed: boolean
  sizeBytes: number
  downloading: boolean
  progress: number | null
  error: string | null
}

/**
 * Turns a Hugging Face page / download link (or any direct https link to a .safetensors file)
 * into a direct download URL and a safe file name. Returns null for anything else.
 */
export function parseModelUrl(raw: string): { url: string; file: string } | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  u.hash = ''
  if (u.hostname === 'huggingface.co' || u.hostname === 'www.huggingface.co' || u.hostname === 'hf.co') {
    u.hostname = 'huggingface.co'
    // /<org>/<repo>/blob/<rev>/<path> → /<org>/<repo>/resolve/<rev>/<path>
    const parts = u.pathname.split('/')
    if (parts.length < 6 || (parts[3] !== 'blob' && parts[3] !== 'resolve')) return null
    parts[3] = 'resolve'
    u.pathname = parts.join('/')
    u.search = ''
  }
  const last = decodeURIComponent(u.pathname.split('/').pop() ?? '')
  if (!/\.safetensors$/i.test(last)) return null
  const file = last.replace(/[\\/:*?"<>|]+/g, '_')
  if (!file || file.startsWith('.')) return null
  return { url: u.toString(), file }
}

// ─── Generation params ───────────────────────────────────────────────────────
export interface VideoLora {
  file: string
  strength: number
}

export interface VideoParams {
  prompt: string
  negative: string
  /** Diffusion model file in models/diffusion_models. */
  model: string
  loras: VideoLora[]
  width: number
  height: number
  /** Number of frames; Wan wants 4n+1. */
  frames: number
  fps: number
  steps: number
  cfg: number
  /** ModelSamplingSD3 shift. */
  shift: number
  sampler: string
  scheduler: string
  seed: number
  randomSeed: boolean
}

/** Wan 2.1's own default negative prompt (the model was tuned with it). */
export const WAN_NEGATIVE =
  '色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走'

export const DEFAULT_VIDEO_PARAMS: VideoParams = {
  prompt: '',
  negative: WAN_NEGATIVE,
  model: WAN_T2V_1_3B,
  loras: [],
  width: 832,
  height: 480,
  frames: 81,
  fps: 16,
  steps: 30,
  cfg: 6,
  shift: 8,
  sampler: 'uni_pc',
  scheduler: 'simple',
  seed: -1,
  randomSeed: true,
}

export const VIDEO_SIZES: { w: number; h: number; id: string }[] = [
  { w: 832, h: 480, id: '16:9' },
  { w: 480, h: 832, id: '9:16' },
  { w: 624, h: 624, id: '1:1' },
  { w: 640, h: 368, id: '16:9 fast' },
  { w: 368, h: 640, id: '9:16 fast' },
]

/** Clip lengths offered in the UI, in frames at 16 fps (1…7 s). */
export const VIDEO_FRAME_OPTIONS = [17, 33, 49, 65, 81, 97, 113]
export const VIDEO_SAMPLERS = ['uni_pc', 'uni_pc_bh2', 'euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_sde', 'ddim']
export const VIDEO_SCHEDULERS = ['simple', 'normal', 'sgm_uniform', 'karras', 'beta', 'ddim_uniform']

const clampNum = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
}

/** Clamp every field into what Wan / ComfyUI accept (sizes ÷16, frames 4n+1). */
export function normalizeVideoParams(p: Partial<VideoParams>): VideoParams {
  const d = DEFAULT_VIDEO_PARAMS
  const to16 = (v: unknown, fb: number) => Math.round(clampNum(v, 128, 1280, fb) / 16) * 16
  const frames = Math.round(clampNum(p.frames, 5, 161, d.frames))
  return {
    prompt: String(p.prompt ?? '').trim(),
    negative: String(p.negative ?? d.negative),
    model: String(p.model || d.model),
    loras: (Array.isArray(p.loras) ? p.loras : [])
      .filter((l) => l && typeof l.file === 'string' && l.file)
      .slice(0, 4)
      .map((l) => ({ file: l.file, strength: Math.round(clampNum(l.strength, -2, 2, 1) * 100) / 100 })),
    width: to16(p.width, d.width),
    height: to16(p.height, d.height),
    frames: Math.floor((frames - 1) / 4) * 4 + 1,
    fps: Math.round(clampNum(p.fps, 4, 60, d.fps)),
    steps: Math.round(clampNum(p.steps, 1, 100, d.steps)),
    cfg: Math.round(clampNum(p.cfg, 1, 20, d.cfg) * 10) / 10,
    shift: Math.round(clampNum(p.shift, 0, 20, d.shift) * 10) / 10,
    sampler: VIDEO_SAMPLERS.includes(String(p.sampler)) ? String(p.sampler) : d.sampler,
    scheduler: VIDEO_SCHEDULERS.includes(String(p.scheduler)) ? String(p.scheduler) : d.scheduler,
    seed: Math.floor(clampNum(p.seed, -1, Number.MAX_SAFE_INTEGER, -1)),
    randomSeed: p.randomSeed ?? d.randomSeed,
  }
}

export const clipSeconds = (frames: number, fps: number) => (frames - 1) / Math.max(1, fps)

// ─── ComfyUI workflow ────────────────────────────────────────────────────────
export type ComfyNode = { class_type: string; inputs: Record<string, unknown>; _meta?: { title: string } }
export type ComfyWorkflow = Record<string, ComfyNode>

/** Node ids AceDeck uses to map ComfyUI progress to stages. */
export const WF = {
  unet: '1',
  clip: '2',
  vae: '3',
  sampling: '4',
  positive: '5',
  negative: '6',
  latent: '7',
  sampler: '8',
  decode: '9',
  video: '20',
  save: '21',
  loraBase: 100,
} as const

export type VideoStage = 'queued' | 'waiting' | 'gpu' | 'starting' | 'loading' | 'encoding' | 'sampling' | 'decoding' | 'saving' | 'done' | 'failed' | 'cancelled'

export function stageForNode(node: string | null | undefined): VideoStage | null {
  if (!node) return null
  if (node === WF.unet || node === WF.clip || node === WF.vae || Number(node) >= WF.loraBase) return 'loading'
  if (node === WF.positive || node === WF.negative || node === WF.sampling || node === WF.latent) return 'encoding'
  if (node === WF.sampler) return 'sampling'
  if (node === WF.decode) return 'decoding'
  if (node === WF.video || node === WF.save) return 'saving'
  return null
}

/** Overall clip progress 0..1 from the current stage and the sampler step. */
export function clipProgress(stage: VideoStage, step: number, steps: number): number {
  switch (stage) {
    case 'loading':
      return 0.04
    case 'encoding':
      return 0.1
    case 'sampling':
      return 0.12 + 0.78 * (steps > 0 ? Math.min(1, step / steps) : 0)
    case 'decoding':
      return 0.92
    case 'saving':
      return 0.98
    case 'done':
      return 1
    default:
      return 0
  }
}

/**
 * Wan 2.1 T2V graph in ComfyUI API format:
 * UNETLoader → (LoRAs) → ModelSamplingSD3 → KSampler ← CLIPTextEncode ×2 (umt5) ← EmptyHunyuanLatentVideo
 * → VAEDecode → CreateVideo → SaveVideo (H.264 MP4).
 */
export function buildWanWorkflow(p: VideoParams, seed: number, filenamePrefix: string): ComfyWorkflow {
  const wf: ComfyWorkflow = {
    [WF.unet]: { class_type: 'UNETLoader', inputs: { unet_name: p.model, weight_dtype: 'default' } },
    [WF.clip]: { class_type: 'CLIPLoader', inputs: { clip_name: WAN_TEXT_ENCODER, type: 'wan', device: 'default' } },
    [WF.vae]: { class_type: 'VAELoader', inputs: { vae_name: WAN_VAE } },
  }
  let model: [string, number] = [WF.unet, 0]
  p.loras.forEach((l, i) => {
    const id = String(WF.loraBase + i)
    wf[id] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: l.file, strength_model: l.strength } }
    model = [id, 0]
  })
  wf[WF.sampling] = { class_type: 'ModelSamplingSD3', inputs: { model, shift: p.shift } }
  wf[WF.positive] = { class_type: 'CLIPTextEncode', inputs: { text: p.prompt, clip: [WF.clip, 0] } }
  wf[WF.negative] = { class_type: 'CLIPTextEncode', inputs: { text: p.negative, clip: [WF.clip, 0] } }
  wf[WF.latent] = { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: p.width, height: p.height, length: p.frames, batch_size: 1 } }
  wf[WF.sampler] = {
    class_type: 'KSampler',
    inputs: {
      model: [WF.sampling, 0],
      seed,
      steps: p.steps,
      cfg: p.cfg,
      sampler_name: p.sampler,
      scheduler: p.scheduler,
      positive: [WF.positive, 0],
      negative: [WF.negative, 0],
      latent_image: [WF.latent, 0],
      denoise: 1,
    },
  }
  wf[WF.decode] = { class_type: 'VAEDecode', inputs: { samples: [WF.sampler, 0], vae: [WF.vae, 0] } }
  wf[WF.video] = { class_type: 'CreateVideo', inputs: { images: [WF.decode, 0], fps: p.fps } }
  wf[WF.save] = { class_type: 'SaveVideo', inputs: { video: [WF.video, 0], filename_prefix: filenamePrefix, format: 'mp4', codec: 'h264' } }
  return wf
}

/** Transformer tokens of a Wan clip: VAE ÷8 in space, ÷4 in time, then 2×2 patches. */
const wanTokens = (w: number, h: number, frames: number) => (w / 16) * (h / 16) * (Math.floor((frames - 1) / 4) + 1)
/** Per-step time ∝ T + T²/k (MLP + attention); k fitted on an RTX 5060 Ti (1.1 s/step at 640×368×17, 16.3 s at 832×480×81). */
const stepCost = (tokens: number) => tokens + (tokens * tokens) / 21500
const REF_COST = stepCost(wanTokens(832, 480, 81)) * 30

/** Render time of a clip relative to 832×480×81 at 30 steps; ETA = measured seconds-per-cost × this. */
export function clipCost(p: Pick<VideoParams, 'width' | 'height' | 'frames' | 'steps'>): number {
  return (stepCost(wanTokens(p.width, p.height, p.frames)) * p.steps) / REF_COST
}

export function videoJobTitle(p: Pick<VideoParams, 'prompt'>, title?: string): string {
  const src = (title || p.prompt || 'Untitled clip').replace(/\s+/g, ' ').trim()
  return src.length > 60 ? `${src.slice(0, 59).trimEnd()}…` : src
}

// ─── Engine, queue, library ──────────────────────────────────────────────────
export interface VideoEngineStatus {
  state: EngineState
  installed: boolean
  installPath: string | null
  python: string | null
  pid: number | null
  external: boolean
  port: number
  startedAt: number | null
  lastError: string | null
  version: string | null
  torch: string | null
  /** The music engine was stopped to free VRAM for video and will be restarted afterwards. */
  musicPaused: boolean
}

export type VideoInstallStepId = 'system' | 'uv' | 'source' | 'deps' | 'models' | 'verify'
export type VideoInstallState = InstallState<VideoInstallStepId>

export interface VideoJobSpec {
  title?: string
  params: Partial<VideoParams>
  /** Number of clips (each with its own seed). */
  count: number
  source?: 'ui' | 'claude'
}

export interface VideoJob {
  id: string
  title: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  status: JobStatus
  spec: VideoJobSpec
  clipsDone: number
  /** Overall job progress 0..1 */
  progress: number
  /** Progress of the current clip 0..1 */
  clipProgress: number
  stage: VideoStage
  step: number
  steps: number
  promptId: string | null
  clipIds: string[]
  error: string | null
  cancelRequested: boolean
  etaSeconds: number | null
}

export interface VideoQueueState {
  jobs: VideoJob[]
  paused: boolean
  activeJobId: string | null
  /** Seconds per clip of cost 1 (see clipCost), exponentially averaged. */
  secondsPerCost: number | null
}

export interface VideoClip {
  id: string
  jobId: string | null
  title: string
  file: string
  sizeBytes: number
  createdAt: number
  seed: number
  renderSeconds: number | null
  favorite: boolean
  params: VideoParams
}
