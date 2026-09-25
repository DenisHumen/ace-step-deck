// AceDeck MCP server — lets Claude (Desktop / Code) drive ACE-Step through the AceDeck app.
// Runs under Node or `ELECTRON_RUN_AS_NODE=1 AceDeck.exe server.cjs`; talks to the app's
// local automation API described in %APPDATA%\AceDeck\control.json.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const APP_DIR = join(process.env.APPDATA ?? join(os.homedir(), 'AppData', 'Roaming'), 'AceDeck')
const CONTROL_FILE = process.env.ACEDECK_CONTROL_FILE ?? join(APP_DIR, 'control.json')
const APP_FILE = join(APP_DIR, 'app.json')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Control {
  port: number
  token: string
}

function readControl(): Control | null {
  try {
    return JSON.parse(readFileSync(CONTROL_FILE, 'utf8'))
  } catch {
    return null
  }
}

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const c = await ensureApp()
  const res = await fetch(`http://127.0.0.1:${c.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
  if (!json.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json.data as T
}

async function ping(c: Control): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${c.port}/status`, { headers: { Authorization: `Bearer ${c.token}` } })
    return r.ok
  } catch {
    return false
  }
}

/** Make sure the AceDeck app is running (launch it if needed) and return its control endpoint. */
async function ensureApp(): Promise<Control> {
  let c = readControl()
  if (c && (await ping(c))) return c
  let exe: string | null = null
  let args: string[] = []
  if (/acedeck/i.test(process.execPath) && process.env.ELECTRON_RUN_AS_NODE) exe = process.execPath
  if (!exe) {
    try {
      const info = JSON.parse(readFileSync(APP_FILE, 'utf8'))
      exe = info.exe
      args = info.args ?? []
    } catch {
      exe = null
    }
  }
  if (!exe || !existsSync(exe)) throw new Error('AceDeck is not running. Please start the AceDeck app.')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(exe, args, { detached: true, stdio: 'ignore', env }).unref()
  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    c = readControl()
    if (c && (await ping(c))) return c
  }
  throw new Error('Launched AceDeck but its automation API did not come up (is it enabled in Settings → Claude?)')
}

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] })

function summarizeJob(j: any) {
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    progress: Math.round((j.progress ?? 0) * 100) + '%',
    stage: j.stage,
    songs: `${j.songsDone}/${j.spec?.count}`,
    eta_seconds: j.etaSeconds ? Math.round(j.etaSeconds) : null,
    error: j.error ?? undefined,
    tracks: (j.tracks ?? []).map((t: any) => ({ id: t.id, title: t.title, file: t.file, bpm: t.bpm, key: t.keyscale, duration: t.durationSec })),
  }
}

async function waitJob(id: string, timeoutSec: number) {
  const end = Date.now() + timeoutSec * 1000
  for (;;) {
    const j = await call('GET', `/jobs/${id}`)
    if (['done', 'failed', 'cancelled'].includes(j.status) || Date.now() > end) return summarizeJob(j)
    await sleep(2000)
  }
}

const server = new McpServer({ name: 'acedeck', version: '1.0.1' })

server.registerTool(
  'acedeck_status',
  {
    title: 'AceDeck status',
    description: 'Engine state (ACE-Step 1.5 API), GPU/VRAM, queue summary and library size.',
    inputSchema: {},
  },
  async () => text(await call('GET', '/status')),
)

server.registerTool(
  'engine_control',
  {
    title: 'Start / stop / restart the ACE-Step engine',
    description: 'Controls the local ACE-Step 1.5 inference server managed by AceDeck. Starting loads the models (~30-60 s).',
    inputSchema: { action: z.enum(['start', 'stop', 'restart']) },
  },
  async ({ action }) => text(await call('POST', `/engine/${action}`)),
)

const common = {
  count: z.number().int().min(1).max(100).optional().describe('How many songs to generate (default 1)'),
  variants_per_run: z.number().int().min(1).max(8).optional().describe('Songs rendered per engine pass (batch size, default 1)'),
  format: z.enum(['mp3', 'flac', 'wav', 'opus', 'aac']).optional(),
  title: z.string().optional().describe('Title for the job/tracks'),
  wait: z.boolean().optional().describe('Wait until finished and return file paths (default true)'),
  timeout_sec: z.number().optional().describe('Max seconds to wait (default 1800)'),
}

server.registerTool(
  'generate_music',
  {
    title: 'Generate music',
    description:
      'Queue text-to-music generation in AceDeck. Either give `description` (natural language; the LM writes caption, lyrics, tempo) ' +
      'or `caption` (comma-separated style tags, best in English) plus optional `lyrics` with [Verse]/[Chorus] tags. ' +
      'Omit lyrics or set instrumental=true for instrumentals. Returns the job and, when wait=true, the generated file paths.',
    inputSchema: {
      description: z.string().optional().describe('Simple mode: describe the song in any language'),
      caption: z.string().optional().describe('Style/genre/instruments/mood tags, e.g. "synthwave, female vocal, dreamy"'),
      lyrics: z.string().optional().describe('Lyrics with section tags like [Verse], [Chorus]'),
      instrumental: z.boolean().optional(),
      duration: z.number().min(10).max(600).optional().describe('Seconds; omit for auto'),
      bpm: z.number().int().min(30).max(300).optional(),
      key: z.string().optional().describe('e.g. "A minor"'),
      time_signature: z.enum(['2', '3', '4', '6']).optional(),
      language: z.string().optional().describe('Vocal language code: en, ru, zh, ja, ko, es…'),
      model: z.string().optional().describe('DiT model, e.g. acestep-v15-turbo (default), acestep-v15-sft, acestep-v15-base'),
      thinking: z.boolean().optional().describe('Use the 5Hz LM planner (better structure, default true)'),
      steps: z.number().int().min(1).max(200).optional().describe('Diffusion steps (turbo 8, sft/base 32-64)'),
      seed: z.number().int().min(0).optional().describe('Fixed seed for reproducible output'),
      ...common,
    },
  },
  async (a) => {
    if (!a.description && !a.caption && !a.lyrics) throw new Error('Provide description, caption or lyrics')
    const params: Record<string, unknown> = {
      task_type: 'text2music',
      prompt: a.caption ?? '',
      lyrics: a.lyrics ?? '',
      instrumental: a.instrumental ?? (!a.lyrics && !a.description),
      sample_mode: !!a.description,
      sample_query: a.description ?? '',
      audio_duration: a.duration ?? null,
      bpm: a.bpm ?? null,
      key_scale: a.key ?? '',
      time_signature: a.time_signature ?? '',
      vocal_language: a.language ?? 'unknown',
      thinking: a.thinking ?? true,
      audio_format: a.format ?? 'mp3',
    }
    if (a.model) params.model = a.model
    if (a.steps) params.inference_steps = a.steps
    if (a.seed !== undefined) Object.assign(params, { seed: a.seed, use_random_seed: false })
    const job = await call('POST', '/jobs', { title: a.title, params, count: a.count ?? 1, batchSize: a.variants_per_run ?? 1, source: 'claude' })
    if (a.wait === false) return text({ queued: summarizeJob(job) })
    return text(await waitJob(job.id, a.timeout_sec ?? 1800))
  },
)

server.registerTool(
  'transform_audio',
  {
    title: 'Cover / remix or repaint existing audio',
    description:
      'cover: re-render a source track in the style of `caption` (strength 0..1, lower = freer). ' +
      'repaint: regenerate the section between start and end seconds keeping the rest.',
    inputSchema: {
      mode: z.enum(['cover', 'repaint']),
      source_audio: z.string().describe('Absolute path to a local audio file'),
      caption: z.string().describe('Target style tags'),
      lyrics: z.string().optional(),
      strength: z.number().min(0).max(1).optional().describe('cover: how much of the original to keep (default 0.6)'),
      start: z.number().min(0).optional().describe('repaint: section start, seconds'),
      end: z.number().optional().describe('repaint: section end, seconds (-1 = to the end)'),
      ...common,
    },
  },
  async (a) => {
    if (!existsSync(a.source_audio)) throw new Error(`File not found: ${a.source_audio}`)
    const params: Record<string, unknown> = {
      task_type: a.mode,
      prompt: a.caption,
      lyrics: a.lyrics ?? '',
      src_audio_path: a.source_audio,
      thinking: false,
      audio_format: a.format ?? 'mp3',
    }
    if (a.mode === 'cover') params.audio_cover_strength = a.strength ?? 0.6
    else Object.assign(params, { repainting_start: a.start ?? 0, repainting_end: a.end ?? -1 })
    const job = await call('POST', '/jobs', { title: a.title ?? `${a.mode}: ${a.caption}`, params, count: a.count ?? 1, batchSize: a.variants_per_run ?? 1, source: 'claude' })
    if (a.wait === false) return text({ queued: summarizeJob(job) })
    return text(await waitJob(job.id, a.timeout_sec ?? 1800))
  },
)

server.registerTool(
  'draft_song',
  {
    title: 'Draft caption + lyrics with the LM',
    description: 'Ask ACE-Step\'s language model to turn a description into a caption, lyrics, BPM, key and duration without rendering audio.',
    inputSchema: {
      description: z.string(),
      instrumental: z.boolean().optional(),
      language: z.string().optional(),
    },
  },
  async (a) => text(await call('POST', '/ai/sample', { query: a.description, instrumental: a.instrumental ?? false, language: a.language ?? 'unknown' })),
)

server.registerTool(
  'list_queue',
  { title: 'List generation queue', description: 'All jobs with status, progress, ETA.', inputSchema: {} },
  async () => {
    const q = await call('GET', '/jobs')
    return text({ paused: q.paused, jobs: q.jobs.map(summarizeJob) })
  },
)

server.registerTool(
  'get_job',
  {
    title: 'Get job',
    description: 'Status of one job; optionally wait for it to finish.',
    inputSchema: { id: z.string(), wait: z.boolean().optional(), timeout_sec: z.number().optional() },
  },
  async (a) => text(a.wait ? await waitJob(a.id, a.timeout_sec ?? 1800) : summarizeJob(await call('GET', `/jobs/${a.id}`))),
)

server.registerTool(
  'job_control',
  {
    title: 'Cancel / retry a job',
    description: 'cancel a pending or running job, or retry a failed/cancelled one.',
    inputSchema: { id: z.string(), action: z.enum(['cancel', 'retry']) },
  },
  async (a) => text(summarizeJob(await call('POST', `/jobs/${a.id}/${a.action}`))),
)

server.registerTool(
  'queue_control',
  {
    title: 'Pause / resume the queue',
    description: 'pause, resume, or clear finished jobs from the queue.',
    inputSchema: { action: z.enum(['pause', 'resume', 'clear']) },
  },
  async (a) => {
    const q = await call('POST', `/queue/${a.action}`)
    return text({ paused: q.paused, jobs: q.jobs.length })
  },
)

server.registerTool(
  'list_tracks',
  {
    title: 'List generated tracks',
    description: 'Library of generated songs (newest first) with file paths and metadata.',
    inputSchema: { query: z.string().optional(), favorites_only: z.boolean().optional(), limit: z.number().int().min(1).max(500).optional() },
  },
  async (a) => {
    const qs = new URLSearchParams()
    if (a.query) qs.set('q', a.query)
    if (a.favorites_only) qs.set('favorite', 'true')
    qs.set('limit', String(a.limit ?? 30))
    const tracks = await call<any[]>('GET', `/tracks?${qs}`)
    return text(
      tracks.map((t) => ({ id: t.id, title: t.title, file: t.file, created: new Date(t.createdAt).toISOString(), caption: t.caption, bpm: t.bpm, key: t.keyscale, duration: t.durationSec, seed: t.seed, favorite: t.favorite })),
    )
  },
)

server.registerTool(
  'run_diagnostics',
  {
    title: 'Stability check',
    description: 'Checks GPU, drivers, install, engine health and (full mode) runs several test generations measuring speed, VRAM peak and leaks.',
    inputSchema: { mode: z.enum(['quick', 'full']).optional(), wait: z.boolean().optional() },
  },
  async (a) => {
    await call('POST', '/diagnostics/run', { mode: a.mode ?? 'quick' })
    if (a.wait === false) return text({ started: true })
    for (let i = 0; i < 900; i++) {
      await sleep(2000)
      const d = await call('GET', '/diagnostics')
      if (!d.running) return text({ verdict: d.verdict, score: d.score, checks: d.checks, samples: d.samples })
    }
    return text({ running: true })
  },
)

server.registerTool(
  'engine_logs',
  { title: 'Engine logs', description: 'Last lines of the ACE-Step engine log.', inputSchema: { limit: z.number().int().min(1).max(1000).optional() } },
  async (a) => {
    const lines = await call<any[]>('GET', `/engine/logs?limit=${a.limit ?? 100}`)
    return text(lines.map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.stream === 'err' ? '!' : ' '} ${l.text}`).join('\n'))
  },
)

server.connect(new StdioServerTransport()).catch((e) => {
  console.error('AceDeck MCP failed to start:', e)
  process.exit(1)
})
