import type { GenerationParams, Settings } from './types'

export const ACE_STEP_REPO_GIT = 'https://github.com/ace-step/ACE-Step-1.5.git'
export const ACE_STEP_REPO_ZIP = 'https://github.com/ace-step/ACE-Step-1.5/archive/refs/heads/main.zip'
export const UV_ZIP_URL = 'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip'
export const PROJECT_URL = 'https://github.com/DenisHumen/ace-step-deck'

/** Minimum free disk space recommended for a full install (deps + main models). */
export const REQUIRED_DISK_GB = 25

export interface CatalogModel {
  name: string
  kind: 'core' | 'dit' | 'lm'
  repo: string
  approxGB: number
  bundled: boolean
}

/** Mirrors acestep/model_downloader.py (MAIN_MODEL_COMPONENTS + SUBMODEL_REGISTRY). */
export const MODEL_CATALOG: CatalogModel[] = [
  { name: 'acestep-v15-turbo', kind: 'dit', repo: 'ACE-Step/Ace-Step1.5', approxGB: 4.5, bundled: true },
  { name: 'acestep-5Hz-lm-1.7B', kind: 'lm', repo: 'ACE-Step/Ace-Step1.5', approxGB: 3.5, bundled: true },
  { name: 'Qwen3-Embedding-0.6B', kind: 'core', repo: 'ACE-Step/Ace-Step1.5', approxGB: 1.1, bundled: true },
  { name: 'vae', kind: 'core', repo: 'ACE-Step/Ace-Step1.5', approxGB: 0.3, bundled: true },
  { name: 'acestep-v15-sft', kind: 'dit', repo: 'ACE-Step/acestep-v15-sft', approxGB: 4.5, bundled: false },
  { name: 'acestep-v15-base', kind: 'dit', repo: 'ACE-Step/acestep-v15-base', approxGB: 4.5, bundled: false },
  { name: 'acestep-v15-turbo-shift3', kind: 'dit', repo: 'ACE-Step/acestep-v15-turbo-shift3', approxGB: 4.5, bundled: false },
  { name: 'acestep-v15-turbo-shift1', kind: 'dit', repo: 'ACE-Step/acestep-v15-turbo-shift1', approxGB: 4.5, bundled: false },
  { name: 'acestep-v15-turbo-continuous', kind: 'dit', repo: 'ACE-Step/acestep-v15-turbo-continuous', approxGB: 4.5, bundled: false },
  { name: 'acestep-v15-xl-turbo', kind: 'dit', repo: 'ACE-Step/acestep-v15-xl-turbo', approxGB: 9.5, bundled: false },
  { name: 'acestep-v15-xl-sft', kind: 'dit', repo: 'ACE-Step/acestep-v15-xl-sft', approxGB: 9.5, bundled: false },
  { name: 'acestep-v15-xl-base', kind: 'dit', repo: 'ACE-Step/acestep-v15-xl-base', approxGB: 9.5, bundled: false },
  { name: 'acestep-5Hz-lm-0.6B', kind: 'lm', repo: 'ACE-Step/acestep-5Hz-lm-0.6B', approxGB: 1.3, bundled: false },
  { name: 'acestep-5Hz-lm-4B', kind: 'lm', repo: 'ACE-Step/acestep-5Hz-lm-4B', approxGB: 8.0, bundled: false },
]

export const DEFAULT_SETTINGS: Omit<Settings, 'outputDir' | 'language'> = {
  installPath: null,
  port: 8001,
  ditModel: 'acestep-v15-turbo',
  lmModel: 'acestep-5Hz-lm-1.7B',
  lmBackend: 'auto',
  initLlm: 'auto',
  offload: 'auto',
  preloadModels: true,
  autoStartEngine: false,
  stopEngineOnExit: true,
  controlApiEnabled: true,
  controlApiPort: 47815,
  notifyOnFinish: true,
  onboarded: false,
  autoCheckUpdates: true,
  desktopShortcutDone: false,
}

export const DEFAULT_PARAMS: GenerationParams = {
  task_type: 'text2music',
  prompt: '',
  lyrics: '',
  instrumental: false,
  sample_mode: false,
  sample_query: '',
  use_format: false,
  thinking: true,
  bpm: null,
  key_scale: '',
  time_signature: '',
  vocal_language: 'unknown',
  audio_duration: null,
  inference_steps: 8,
  guidance_scale: 7.0,
  use_random_seed: true,
  seed: -1,
  repainting_start: 0,
  repainting_end: -1,
  repaint_mode: 'balanced',
  repaint_strength: 0.5,
  audio_cover_strength: 1.0,
  cover_noise_strength: 0,
  infer_method: 'ode',
  use_adg: false,
  cfg_interval_start: 0,
  cfg_interval_end: 1,
  audio_format: 'mp3',
  lm_temperature: 0.85,
  lm_cfg_scale: 2.5,
  lm_top_k: null,
  lm_top_p: 0.9,
  lm_repetition_penalty: 1.0,
  lm_negative_prompt: 'NO USER INPUT',
  use_cot_caption: false,
  use_cot_language: true,
  constrained_decoding: true,
}

export const VOCAL_LANGUAGES = [
  'unknown', 'en', 'ru', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'it', 'pt', 'uk', 'pl', 'nl', 'tr', 'ar', 'hi', 'bn', 'th', 'vi', 'id',
] as const

export const KEYS = [
  'C major', 'C minor', 'C# major', 'C# minor', 'D major', 'D minor', 'Eb major', 'Eb minor', 'E major', 'E minor',
  'F major', 'F minor', 'F# major', 'F# minor', 'G major', 'G minor', 'Ab major', 'Ab minor', 'A major', 'A minor',
  'Bb major', 'Bb minor', 'B major', 'B minor',
]

export const TRACK_CLASSES = [
  'vocals', 'backing_vocals', 'drums', 'bass', 'guitar', 'keyboard', 'percussion', 'strings', 'synth', 'fx', 'brass', 'woodwinds',
] as const

export const STYLE_PRESETS: Record<string, string[]> = {
  genre: [
    'pop', 'rock', 'hip hop', 'lo-fi', 'synthwave', 'edm', 'house', 'techno', 'trap', 'drum and bass', 'jazz', 'blues',
    'r&b', 'soul', 'funk', 'metal', 'punk', 'indie', 'folk', 'country', 'reggae', 'k-pop', 'cinematic', 'orchestral', 'ambient', 'phonk',
  ],
  mood: ['uplifting', 'melancholic', 'dreamy', 'energetic', 'dark', 'romantic', 'epic', 'chill', 'nostalgic', 'aggressive', 'happy', 'sad'],
  instruments: [
    'piano', 'acoustic guitar', 'electric guitar', 'analog synths', 'strings', 'saxophone', '808 bass', 'drum machine', 'violin',
    'brass section', 'choir', 'pads', 'vinyl crackle',
  ],
  vocals: ['female vocal', 'male vocal', 'duet', 'choir vocals', 'rap vocals', 'breathy vocal', 'powerful vocal', 'no vocals'],
}

export const LYRIC_TAGS = ['[Intro]', '[Verse]', '[Pre-Chorus]', '[Chorus]', '[Bridge]', '[Drop]', '[Solo]', '[Outro]', '[Instrumental]']
