// Thin client for the ACE-Step 1.5 REST API (acestep-api). See docs/en/API.md in ACE-Step.
import { createWriteStream, promises as fsp } from 'node:fs'
import { basename, dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { GenerationParams, SampleResult } from '@shared/types'
import { normalizeSample } from '@shared/logic'

interface Envelope<T> {
  data: T
  code: number
  error: string | null
}

export interface HealthData {
  status: string
  models_initialized: boolean
  llm_initialized: boolean
  loaded_model: string | null
  loaded_lm_model: string | null
}

export interface QueryItem {
  task_id: string
  status: number // 0 running/queued, 1 ok, 2 failed
  result: string
  progress_text?: string
}

export interface ResultEntry {
  file?: string
  status?: number
  progress?: number
  stage?: string
  error?: string | null
  prompt?: string
  lyrics?: string
  metas?: { bpm?: number | null; duration?: number | null; genres?: string; keyscale?: string; timesignature?: string }
  seed_value?: string
  lm_model?: string
  dit_model?: string
  generation_info?: string
}

export class AceStepApi {
  constructor(private readonly port: () => number) {}

  get base(): string {
    return `http://127.0.0.1:${this.port()}`
  }

  private async req<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000)
    try {
      const res = await fetch(this.base + path, { ...init, signal: ctrl.signal })
      const text = await res.text()
      let body: Envelope<T> | any
      try {
        body = JSON.parse(text)
      } catch {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
      }
      if (!res.ok) throw new Error(body?.detail ? String(body.detail) : `HTTP ${res.status}: ${text.slice(0, 300)}`)
      if (body && typeof body === 'object' && 'code' in body && body.code !== 200) {
        throw new Error(body.error || `API error ${body.code}`)
      }
      return (body?.data ?? body) as T
    } finally {
      clearTimeout(timer)
    }
  }

  private post<T>(path: string, json: unknown, timeoutMs?: number): Promise<T> {
    return this.req<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(json),
      timeoutMs,
    })
  }

  health(timeoutMs = 2500): Promise<HealthData> {
    return this.req<HealthData>('/health', { timeoutMs })
  }

  stats(): Promise<{ jobs: Record<string, number>; queue_size: number; avg_job_seconds: number }> {
    return this.req('/v1/stats')
  }

  models(): Promise<{ models: { name: string; is_default: boolean; is_loaded?: boolean }[]; default_model: string; lm_models?: any[] }> {
    return this.req('/v1/models')
  }

  init(body: { model?: string; init_llm?: boolean; lm_model_path?: string }): Promise<any> {
    return this.post('/v1/init', body, 30 * 60 * 1000)
  }

  async releaseTask(params: Partial<GenerationParams>): Promise<string> {
    const { src_audio_path, reference_audio_path, ...rest } = params
    let data: { task_id: string }
    if (src_audio_path || reference_audio_path) {
      // ACE-Step rejects absolute paths outside its temp dir, so local audio is uploaded as
      // multipart. All other fields travel in `param_obj` (JSON keeps bools/numbers/lists typed).
      const form = new FormData()
      form.append('param_obj', JSON.stringify(rest))
      const attach = async (field: string, path: string) => {
        const buf = await fsp.readFile(path)
        form.append(field, new Blob([buf]), basename(path))
      }
      if (src_audio_path) await attach('src_audio', src_audio_path)
      if (reference_audio_path) await attach('reference_audio', reference_audio_path)
      data = await this.req<{ task_id: string }>('/release_task', { method: 'POST', body: form, timeoutMs: 120000 })
    } else {
      data = await this.post<{ task_id: string }>('/release_task', rest, 60000)
    }
    if (!data?.task_id) throw new Error('No task_id returned')
    return data.task_id
  }

  async query(taskId: string): Promise<{ item: QueryItem; entries: ResultEntry[] }> {
    const list = await this.post<QueryItem[]>('/query_result', { task_id_list: [taskId] }, 20000)
    const item = list?.[0] ?? { task_id: taskId, status: 0, result: '[]' }
    let entries: ResultEntry[] = []
    try {
      const parsed = JSON.parse(item.result || '[]')
      entries = Array.isArray(parsed) ? parsed : []
    } catch {
      entries = []
    }
    return { item, entries }
  }

  async downloadAudio(fileUrl: string, dest: string): Promise<void> {
    await fsp.mkdir(dirname(dest), { recursive: true })
    const res = await fetch(this.base + fileUrl)
    if (!res.ok || !res.body) throw new Error(`Audio download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest))
  }

  async createSample(query: string, instrumental: boolean, vocal_language: string): Promise<SampleResult> {
    return normalizeSample(await this.post('/v1/create_sample', { query, instrumental, vocal_language }, 10 * 60 * 1000))
  }

  async formatInput(prompt: string, lyrics: string, meta: Record<string, unknown>): Promise<SampleResult> {
    return normalizeSample(await this.post('/format_input', { prompt, lyrics, param_obj: JSON.stringify(meta) }, 10 * 60 * 1000))
  }

  async randomSample(sample_type: 'simple_mode' | 'custom_mode'): Promise<SampleResult> {
    return normalizeSample(await this.post('/create_random_sample', { sample_type }, 60000))
  }
}

