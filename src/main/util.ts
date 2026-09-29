import { spawn, execFile, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { createWriteStream, existsSync, promises as fsp } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { EventMap } from '@shared/types'

// ─── Event bus → all renderer windows ────────────────────────────────────────
type Listener<K extends keyof EventMap> = (payload: EventMap[K]) => void
const listeners = new Map<keyof EventMap, Set<Listener<any>>>()

export function emit<K extends keyof EventMap>(channel: K, payload: EventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  listeners.get(channel)?.forEach((fn) => fn(payload))
}

export function on<K extends keyof EventMap>(channel: K, fn: Listener<K>): () => void {
  if (!listeners.has(channel)) listeners.set(channel, new Set())
  listeners.get(channel)!.add(fn)
  return () => listeners.get(channel)?.delete(fn)
}

/** Coalesce frequent updates (progress ticks) into at most one emit per `ms`. */
export function throttle<T extends (...a: any[]) => void>(fn: T, ms: number): T {
  let last = 0
  let timer: NodeJS.Timeout | null = null
  let pending: any[] | null = null
  return ((...args: any[]) => {
    const now = Date.now()
    const run = () => {
      last = Date.now()
      timer = null
      const a = pending ?? args
      pending = null
      fn(...a)
    }
    if (now - last >= ms) run()
    else {
      pending = args
      if (!timer) timer = setTimeout(run, ms - (now - last))
    }
  }) as T
}

// ─── Misc ────────────────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
export const uid = (n = 8) => randomBytes(n).toString('hex')

export function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** Atomic JSON write (tmp + rename) so a crash never leaves a half-written file. */
export async function writeJson(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${uid(4)}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rename(tmp, file)
}

/** Recursive directory size in bytes (follows no symlinks, ignores errors). */
export async function dirSize(path: string): Promise<number> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(path, { withFileTypes: true })
  } catch {
    return 0
  }
  // Sum after Promise.all — `total += await …` inside concurrent callbacks loses updates.
  const sizes = await Promise.all(
    entries.map(async (e) => {
      const p = join(path, e.name)
      if (e.isDirectory()) return dirSize(p)
      if (!e.isFile()) return 0
      try {
        return (await fsp.stat(p)).size
      } catch {
        return 0 // file vanished (renamed by the downloader)
      }
    }),
  )
  return sizes.reduce((a, b) => a + b, 0)
}

// ─── Processes ───────────────────────────────────────────────────────────────
export interface RunOptions extends SpawnOptions {
  onLine?: (line: string, stream: 'out' | 'err') => void
  /** Called with the raw chunk; progress bars from git/uv/tqdm use \r without \n. */
  onChunk?: (chunk: string, stream: 'out' | 'err') => void
}

export interface RunHandle {
  child: ChildProcess
  done: Promise<number>
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): RunHandle {
  const child = spawn(cmd, args, { windowsHide: true, ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  const wire = (stream: NodeJS.ReadableStream | null, name: 'out' | 'err') => {
    if (!stream) return
    let buf = ''
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk: string) => {
      opts.onChunk?.(chunk, name)
      buf += chunk
      const parts = buf.split(/\r?\n|\r/)
      buf = parts.pop() ?? ''
      for (const p of parts) if (p.trim()) opts.onLine?.(p, name)
    })
    stream.on('end', () => {
      if (buf.trim()) opts.onLine?.(buf, name)
    })
  }
  wire(child.stdout, 'out')
  wire(child.stderr, 'err')
  const done = new Promise<number>((resolve) => {
    child.on('error', (err) => {
      opts.onLine?.(`[spawn error] ${err.message}`, 'err')
      resolve(-1)
    })
    child.on('close', (code) => resolve(code ?? -1))
  })
  return { child, done }
}

export function execText(cmd: string, args: string[], timeoutMs = 15000, cwd?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : -1) : 0
      resolve({ code, out: String(stdout ?? ''), err: String(stderr ?? '') })
    })
  })
}

/** Kill a process and all of its children (uv → python → workers). */
export async function killTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await execText('taskkill', ['/PID', String(pid), '/T', '/F'], 15000)
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
}

export async function findPidByPort(port: number): Promise<number | null> {
  if (process.platform !== 'win32') return null
  const { out } = await execText('netstat', ['-ano', '-p', 'TCP'])
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) {
      const pid = Number(cols[4])
      if (pid > 0) return pid
    }
  }
  return null
}

export async function which(bin: string): Promise<string | null> {
  const { code, out } = await execText(process.platform === 'win32' ? 'where' : 'which', [bin])
  if (code !== 0) return null
  const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return first && existsSync(first) ? first : null
}

// ─── Downloads ───────────────────────────────────────────────────────────────
export interface DownloadProgress {
  received: number
  total: number | null
  bytesPerSec: number
}

export async function download(
  url: string,
  dest: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true })
  const res = await fetch(url, { redirect: 'follow', signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const total = Number(res.headers.get('content-length')) || null
  const out = createWriteStream(dest)
  let received = 0
  const started = Date.now()
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      const secs = Math.max(0.001, (Date.now() - started) / 1000)
      onProgress({ received, total, bytesPerSec: received / secs })
    }
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
}

/**
 * Download into `<dest>.part`, continuing a previous partial download with an HTTP Range request,
 * and rename to `dest` only when complete. Used for multi-GB model files.
 */
export async function downloadResumable(
  url: string,
  dest: string,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  await fsp.mkdir(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const have = existsSync(part) ? (await fsp.stat(part)).size : 0
  const res = await fetch(url, { redirect: 'follow', signal, headers: have ? { Range: `bytes=${have}-` } : {} })
  if (res.status === 416 && have) {
    // Already complete (the server has nothing past our last byte).
    await fsp.rename(part, dest)
    return
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
  const resumed = res.status === 206
  const start = resumed ? have : 0
  const length = Number(res.headers.get('content-length')) || null
  const total = length !== null ? start + length : null
  const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
  let received = start
  const started = Date.now()
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      const secs = Math.max(0.001, (Date.now() - started) / 1000)
      onProgress({ received, total, bytesPerSec: (received - start) / secs })
    }
  } finally {
    await new Promise<void>((r) => out.end(r))
  }
  if (total !== null && received < total) throw new Error(`Download interrupted at ${formatBytes(received)} of ${formatBytes(total)}`)
  await fsp.rename(part, dest)
}

/** Extract a .zip with the tar.exe that ships with Windows 10+ (bsdtar). */
export async function extractZip(zip: string, destDir: string): Promise<void> {
  await fsp.mkdir(destDir, { recursive: true })
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  const { code, err } = await execText(tar, ['-xf', zip, '-C', destDir], 10 * 60 * 1000)
  if (code !== 0) throw new Error(`Extract failed (${code}): ${err.slice(-400)}`)
}
