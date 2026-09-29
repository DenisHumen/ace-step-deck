// Thin client for the ComfyUI HTTP + websocket API (server.py).
import { createWriteStream, promises as fsp } from 'node:fs'
import { dirname } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ComfyWorkflow } from '@shared/video'

export interface SystemStats {
  system: { os: string; comfyui_version?: string; python_version: string; pytorch_version: string; embedded_python?: boolean }
  devices: { name: string; type: string; vram_total: number; vram_free: number; torch_vram_total: number; torch_vram_free: number }[]
}

export interface OutputFile {
  filename: string
  subfolder: string
  type: string
}

export interface HistoryEntry {
  status?: { status_str: 'success' | 'error'; completed: boolean; messages: [string, any][] }
  outputs: Record<string, Record<string, unknown>>
}

export type ComfyMessage =
  | { type: 'progress'; data: { value: number; max: number; prompt_id: string; node: string } }
  | { type: 'executing'; data: { node: string | null; prompt_id: string } }
  | { type: 'execution_start' | 'execution_success' | 'execution_cached'; data: { prompt_id: string } }
  | { type: 'execution_error'; data: { prompt_id: string; node_type?: string; exception_message?: string } }
  | { type: 'execution_interrupted'; data: { prompt_id: string } }
  | { type: string; data: any }

export class ComfyApi {
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
      if (!res.ok) throw new Error(comfyError(text) ?? `HTTP ${res.status}: ${text.slice(0, 300)}`)
      return (text ? JSON.parse(text) : null) as T
    } finally {
      clearTimeout(timer)
    }
  }

  private post<T>(path: string, json: unknown, timeoutMs?: number): Promise<T> {
    return this.req<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), timeoutMs })
  }

  systemStats(timeoutMs = 2500): Promise<SystemStats> {
    return this.req<SystemStats>('/system_stats', { timeoutMs })
  }

  async queuePrompt(prompt: ComfyWorkflow, clientId: string): Promise<string> {
    const r = await this.post<{ prompt_id: string; node_errors?: Record<string, unknown> }>('/prompt', { prompt, client_id: clientId }, 60000)
    if (!r?.prompt_id) throw new Error('ComfyUI did not return a prompt id')
    return r.prompt_id
  }

  async history(promptId: string): Promise<HistoryEntry | null> {
    const h = await this.req<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(promptId)}`)
    return h?.[promptId] ?? null
  }

  async interrupt(promptId: string): Promise<void> {
    await this.post('/interrupt', { prompt_id: promptId }).catch(() => {})
    await this.post('/queue', { delete: [promptId] }).catch(() => {})
  }

  free(): Promise<unknown> {
    return this.post('/free', { unload_models: true, free_memory: true })
  }

  async download(file: OutputFile, dest: string): Promise<void> {
    await fsp.mkdir(dirname(dest), { recursive: true })
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder, type: file.type })
    const res = await fetch(`${this.base}/view?${q}`)
    if (!res.ok || !res.body) throw new Error(`Video download failed: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as any), createWriteStream(dest))
  }

  /** Subscribe to execution events. Returns a close function; `onClose` fires if the socket drops. */
  listen(clientId: string, onMessage: (m: ComfyMessage) => void, onClose?: () => void): () => void {
    const ws = new WebSocket(`ws://127.0.0.1:${this.port()}/ws?clientId=${encodeURIComponent(clientId)}`)
    let closed = false
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return // binary latent previews
      try {
        onMessage(JSON.parse(e.data))
      } catch {
        /* ignore malformed frames */
      }
    })
    ws.addEventListener('close', () => {
      if (!closed) onClose?.()
    })
    ws.addEventListener('error', () => {
      /* close follows */
    })
    return () => {
      closed = true
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    }
  }
}

/** ComfyUI answers a rejected /prompt with {error:{message,details}, node_errors:{id:{errors:[…]}}}. */
export function comfyError(text: string): string | null {
  try {
    const j = JSON.parse(text)
    const nodeErrors = Object.values(j?.node_errors ?? {}) as any[]
    const first = nodeErrors.flatMap((n) => (n?.errors ?? []).map((e: any) => `${n.class_type ?? ''}: ${e.message}${e.details ? ` (${e.details})` : ''}`))[0]
    if (first) return first
    if (j?.error?.message) return `${j.error.message}${j.error.details ? `: ${j.error.details}` : ''}`
  } catch {
    /* not JSON */
  }
  return null
}

/** Every file a finished prompt produced (SaveVideo reports its mp4 under "images"). */
export function outputFiles(entry: HistoryEntry): OutputFile[] {
  const files: OutputFile[] = []
  for (const out of Object.values(entry.outputs ?? {})) {
    for (const list of Object.values(out ?? {})) {
      if (!Array.isArray(list)) continue
      for (const f of list) if (f && typeof f.filename === 'string') files.push({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })
    }
  }
  return files
}
