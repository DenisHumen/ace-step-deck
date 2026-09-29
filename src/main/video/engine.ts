// Lifecycle of the local ComfyUI server that renders video (Wan 2.1).
import type { ChildProcess } from 'node:child_process'
import { existsSync, promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LogLine } from '@shared/types'
import type { VideoEngineStatus } from '@shared/video'
import { getSettings } from '../settings'
import { emit, findPidByPort, killTree, run, sleep } from '../util'
import { ComfyApi } from './comfy-api'

const MAX_LOG = 3000

export interface ComfyInspection {
  path: string
  /** main.py + comfy/ + nodes.py are present. */
  source: boolean
  /** Python that runs this ComfyUI (.venv, venv or the portable build's python_embeded). */
  python: string | null
  version: string | null
  isGit: boolean
}

export async function inspectComfy(raw: string): Promise<ComfyInspection> {
  const path = resolve(raw)
  const source = existsSync(join(path, 'main.py')) && existsSync(join(path, 'nodes.py')) && existsSync(join(path, 'comfy'))
  const python =
    [join(path, '.venv', 'Scripts', 'python.exe'), join(path, 'venv', 'Scripts', 'python.exe'), join(path, '..', 'python_embeded', 'python.exe')].find((p) => existsSync(p)) ?? null
  let version: string | null = null
  try {
    version = /__version__\s*=\s*["']([^"']+)/.exec(await fsp.readFile(join(path, 'comfyui_version.py'), 'utf8'))?.[1] ?? null
  } catch {
    /* older checkouts */
  }
  return { path, source, python, version, isGit: existsSync(join(path, '.git')) }
}

export class VideoEngineManager {
  readonly api = new ComfyApi(() => getSettings().videoPort)
  private child: ChildProcess | null = null
  private logs: LogLine[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private stopping = false
  private busy = false
  private op: Promise<unknown> | null = null
  inspection: ComfyInspection | null = null

  status: VideoEngineStatus = {
    state: 'not-installed',
    installed: false,
    installPath: null,
    python: null,
    pid: null,
    external: false,
    port: 8188,
    startedAt: null,
    lastError: null,
    version: null,
    torch: null,
    musicPaused: false,
  }

  private set(patch: Partial<VideoEngineStatus>): void {
    this.status = { ...this.status, ...patch, port: getSettings().videoPort }
    emit('video:status', this.status)
  }

  log(text: string, stream: LogLine['stream'] = 'sys'): void {
    const line: LogLine = { t: Date.now(), stream, text: text.replace(/\x1b\[[0-9;]*m/g, '') }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG)
    emit('video:log', line)
  }

  getLogs(): LogLine[] {
    return this.logs
  }

  clearLogs(): void {
    this.logs = []
  }

  get running(): boolean {
    return ['starting', 'loading', 'ready', 'busy'].includes(this.status.state)
  }

  get ready(): boolean {
    return this.status.state === 'ready' || this.status.state === 'busy'
  }

  setBusy(b: boolean): void {
    if (this.busy === b) return
    this.busy = b
    const next = b ? 'busy' : 'ready'
    if (this.ready && this.status.state !== next) this.set({ state: next })
  }

  setMusicPaused(musicPaused: boolean): void {
    if (this.status.musicPaused !== musicPaused) this.set({ musicPaused })
  }

  async refreshInstall(): Promise<void> {
    const path = getSettings().videoInstallPath
    this.inspection = path ? await inspectComfy(path) : null
    const installed = !!(this.inspection?.source && this.inspection.python)
    const patch: Partial<VideoEngineStatus> = {
      installed,
      installPath: path,
      python: this.inspection?.python ?? null,
      version: this.inspection?.version ?? this.status.version,
    }
    if (!this.running && this.status.state !== 'stopping') patch.state = installed ? 'stopped' : 'not-installed'
    this.set(patch)
  }

  start(): Promise<void> {
    if (this.op) return this.op.then(() => undefined)
    this.op = this.doStart().finally(() => (this.op = null))
    return this.op as Promise<void>
  }

  stop(): Promise<void> {
    return this.doStop()
  }

  async restart(): Promise<void> {
    this.log('Restarting ComfyUI…')
    await this.doStop()
    await this.start()
  }

  private async doStart(): Promise<void> {
    await this.refreshInstall()
    const s = getSettings()
    const insp = this.inspection
    if (!insp?.source || !insp.python) {
      this.set({ state: 'not-installed', lastError: 'ComfyUI is not installed' })
      throw new Error('ComfyUI is not installed')
    }
    if (this.running) return

    try {
      await this.api.systemStats(1500)
      const pid = await findPidByPort(s.videoPort)
      this.log(`Found ComfyUI already listening on port ${s.videoPort} (pid ${pid ?? '?'}), attaching to it.`)
      this.set({ state: 'starting', external: true, pid, startedAt: Date.now(), lastError: null })
      await this.afterHealthy()
      return
    } catch {
      /* port is free — launch our own */
    }

    const args = ['-s', 'main.py', '--listen', '127.0.0.1', '--port', String(s.videoPort), '--disable-auto-launch']
    if (s.videoLowVram) args.push('--lowvram')
    this.log(`Starting ComfyUI: ${insp.python} ${args.join(' ')}`)
    this.stopping = false
    const handle = run(insp.python, args, {
      cwd: insp.path,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      onLine: (line, stream) => {
        // tqdm step bars — the queue shows the same progress.
        if (/\d+%\|.*\|\s*\d+\/\d+/.test(line)) return
        this.log(line, stream)
      },
    })
    this.child = handle.child
    this.set({ state: 'starting', pid: handle.child.pid ?? null, external: false, startedAt: Date.now(), lastError: null })

    handle.done.then((code) => {
      const wasStopping = this.stopping
      this.child = null
      this.stopHealth()
      if (wasStopping) {
        this.log(`ComfyUI stopped (exit ${code}).`)
        this.set({ state: this.status.installed ? 'stopped' : 'not-installed', pid: null, startedAt: null })
      } else {
        const tail = this.logs.filter((l) => l.stream !== 'sys').slice(-6).map((l) => l.text).join('\n')
        this.log(`ComfyUI exited unexpectedly (code ${code}).`, 'err')
        this.set({ state: 'error', pid: null, startedAt: null, lastError: `ComfyUI exited with code ${code}\n${tail}` })
      }
    })

    const deadline = Date.now() + 5 * 60 * 1000
    for (;;) {
      if (!this.child) throw new Error(this.status.lastError ?? 'ComfyUI exited during start')
      try {
        await this.api.systemStats(2000)
        break
      } catch {
        if (Date.now() > deadline) {
          await this.doStop()
          this.set({ state: 'error', lastError: 'ComfyUI did not answer within 5 minutes' })
          throw new Error('ComfyUI start timeout')
        }
        await sleep(1000)
      }
    }
    await this.afterHealthy()
  }

  private async afterHealthy(): Promise<void> {
    const st = await this.api.systemStats().catch(() => null)
    if (st) {
      this.set({ version: st.system.comfyui_version ?? this.status.version, torch: st.system.pytorch_version ?? null })
      const dev = st.devices?.[0]
      if (dev) this.log(`ComfyUI ${st.system.comfyui_version ?? ''} ready · PyTorch ${st.system.pytorch_version} · ${dev.name}`)
    }
    this.startHealth()
    if (this.running || this.status.external) this.set({ state: this.busy ? 'busy' : 'ready' })
  }

  private startHealth(): void {
    this.stopHealth()
    this.healthTimer = setInterval(() => void this.pollHealth(), 5000)
  }

  private stopHealth(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  private async pollHealth(): Promise<void> {
    try {
      await this.api.systemStats()
    } catch {
      if (this.status.external && this.running && !this.stopping) {
        this.stopHealth()
        this.log('External ComfyUI is no longer reachable.', 'err')
        this.set({ state: 'stopped', external: false, pid: null, startedAt: null })
      }
    }
  }

  private async doStop(): Promise<void> {
    const port = getSettings().videoPort
    if (!this.running && !this.child) {
      const pid = await findPidByPort(port)
      if (pid && this.status.external) await killTree(pid)
      return
    }
    this.stopping = true
    this.set({ state: 'stopping' })
    this.log('Stopping ComfyUI…')
    this.stopHealth()
    const pid = this.child?.pid ?? this.status.pid ?? (await findPidByPort(port))
    if (pid) await killTree(pid)
    for (let i = 0; i < 30; i++) {
      try {
        await this.api.systemStats(800)
        await sleep(500)
      } catch {
        break
      }
    }
    if (this.status.external) {
      this.log('External ComfyUI stopped.')
      this.set({ state: 'stopped', external: false, pid: null, startedAt: null })
    }
    for (let i = 0; i < 20 && this.child; i++) await sleep(250)
    if (this.child === null && this.status.state === 'stopping') this.set({ state: this.status.installed ? 'stopped' : 'not-installed', pid: null })
  }

  /** Ask ComfyUI to unload its models (it processes the flag between prompts). */
  async freeVram(): Promise<boolean> {
    if (!this.ready) return false
    try {
      await this.api.free()
      return true
    } catch {
      return false
    }
  }

  async waitReady(timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) {
      if (this.ready) return true
      if (this.status.state === 'error' || this.status.state === 'stopped' || this.status.state === 'not-installed') return false
      await sleep(500)
    }
    return this.ready
  }
}

export const videoEngine = new VideoEngineManager()
