// Pure helpers shared by the main process and tests (no Electron imports here).
import type { JobSpec, SampleResult } from './types'

/**
 * ACE-Step reports coarse milestones (0.01 → 0.25 → 0.5 → 0.57…0.8 → 0.99) and stays flat
 * during the long LM phases. Creep towards the next milestone so the bar never looks frozen,
 * but never reach it before the engine does.
 */
export const MILESTONES = [0.01, 0.25, 0.5, 0.8, 0.99, 1]
export function smoothProgress(apiProgress: number, secondsSinceChange: number): number {
  const p = Math.max(0, Math.min(1, apiProgress))
  const next = MILESTONES.find((m) => m > p + 1e-6) ?? 1
  return p + (next - p) * 0.9 * (1 - Math.exp(-Math.max(0, secondsSinceChange) / 18))
}

export function jobTitle(spec: JobSpec): string {
  const p = spec.params
  const raw = spec.title || p.sample_query || p.prompt || (p.task_type && p.task_type !== 'text2music' ? p.task_type : '') || 'Untitled'
  const s = raw.replace(/\s+/g, ' ').trim()
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

/** The sample endpoints disagree on key names (keyscale/key_scale, language/vocal_language…). */
export function normalizeSample(raw: any): SampleResult {
  const num = (v: unknown) => (v === null || v === undefined || v === '' || v === 'N/A' ? null : Number(v))
  return {
    caption: String(raw?.caption ?? raw?.prompt ?? ''),
    lyrics: String(raw?.lyrics ?? ''),
    bpm: num(raw?.bpm),
    key_scale: String(raw?.key_scale ?? raw?.keyscale ?? raw?.keyScale ?? ''),
    time_signature: String(raw?.time_signature ?? raw?.timesignature ?? raw?.timeSignature ?? ''),
    duration: num(raw?.duration ?? raw?.audio_duration),
    vocal_language: String(raw?.vocal_language ?? raw?.language ?? ''),
  }
}

export function slugify(s: string, max = 40): string {
  const out = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return out || 'track'
}
