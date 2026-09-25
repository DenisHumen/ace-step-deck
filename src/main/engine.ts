import type { ChildProcess } from 'node:child_process'
import type { EngineStatus, LogLine } from '@shared/types'
import { AceStepApi } from './acestep-api'
import { inspectInstall, type InstallInspection } from './install-detect'
import { getSettings } from './settings'
import { findUv, gpuInfo } from './system'
import { emit, findPidByPort, killTree, run, sleep } from './util'

const MAX_LOG = 3000

export class EngineManager {
  readonly api = new AceStepApi(() => getSettings().port)
  private child: ChildProcess | null = null
  private logs: LogLine[] = []
  private healthTimer: NodeJS.Timeout | null = null
  private stopping = false
  private busy = false
  private op: Promise<unknown> | null = null
  inspection: InstallInspection | null = null

  status: EngineStatus = {
    state: 'not-installed',
    installed: false,
    installPath: null,
    pid: null,
    external: false,
    port: 8001,
    startedAt: null,
    modelsInitialized: false,
    llmInitialized: false,
    loadedModel: null,
    loadedLm: null,
    lastError: null,
    revision: null,
  }

  // ── state helpers ──────────────────────────────────────────────────────────
  private set(patch: Partial<EngineStatus>): void {
    this.status = { ...this.status, ...patch, port: getSettings().port }
    emit('engine:status', this.status)
  }

  log(text: string, stream: LogLine['stream'] = 'sys'): void {
    const line: LogLine = { t: Date.now(), stream, text: text.replace(/\x1b\[[0-9;]*m/g, '') }
    this.logs.push(line)
    if (this.logs.length > MAX_LOG) this.logs.splice(0, this.logs.length - MAX_LOG)
    emit('engine:log', line)
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

  /** Re-read the configured install directory and derive the idle state. */
  async refreshInstall(): Promise<void> {
    const path = getSettings().installPath
    this.inspection = path ? await inspectInstall(path) : null
    const installed = !!(this.inspection?.source && this.inspection?.venv)
    const patch: Partial<EngineStatus> = {
      installed,
      installPath: path,
      revision: this.inspection?.revision ?? null,
    }
    if (!this.running && this.status.state !== 'stopping') patch.state = installed ? 'stopped' : 'not-installed'
    this.set(patch)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  start(): Promise<void> {
    if (this.op) return this.op.then(() => undefined)
    this.op = this.doStart().finally(() => (this.op = null))
    return this.op as Promise<void>
  }

  stop(): Promise<void> {
    return this.doStop()
  }

  async restart(): Promise<void> {
    this.log('Restarting engine…')
    await this.doStop()
    await this.start()
  }

  private async doStart(): Promise<void> {
    await this.refreshInstall()
    const s = getSettings()
    const insp = this.inspection
    if (!insp?.source || !insp.venv) {
      this.set({ state: 'not-installed', lastError: 'ACE-Step is not installed' })
      throw new Error('ACE-Step is not installed')
    }
    if (this.running) return

    // Somebody (a previous AceDeck, a terminal) may already serve this port.
    try {
      await this.api.health(1500)
      const pid = await findPidByPort(s.port)
      this.log(`Found an engine already listening on port ${s.port} (pid ${pid ?? '?'}), attaching to it.`)
      this.set({ state: 'starting', external: true, pid, startedAt: Date.now(), lastError: null })
      await this.afterHealthy()
      return
    } catch {
      /* port is free — launch our own */
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      ACESTEP_API_HOST: '127.0.0.1',
      ACESTEP_API_PORT: String(s.port),
      ACESTEP_CONFIG_PATH: s.ditModel,
      ACESTEP_LM_MODEL_PATH: s.lmModel,
      ACESTEP_LM_BACKEND: s.lmBackend === 'auto' ? (insp.hasTriton ? 'vllm' : 'pt') : s.lmBackend,
      // Load models during server startup: only that path captures the init kwargs ACE-Step
      // needs for on-demand model switching (lazy /v1/init does not).
      ACESTEP_NO_INIT: s.preloadModels ? 'false' : 'true',
      // Without this the server silently renders with the primary model when a job asks for
      // another DiT (SFT/Base/XL, stems need Base). Safe: AceDeck runs one queue/API worker.
      ACESTEP_ON_DEMAND_MODEL_LOAD: 'true',
    }
    if (s.initLlm !== 'auto') env.ACESTEP_INIT_LLM = s.initLlm
    if (s.offload !== 'auto') env.ACESTEP_OFFLOAD_TO_CPU = s.offload === 'on' ? 'true' : 'false'

    let cmd: string
    let args: string[]
    if (insp.apiExe) {
      cmd = insp.apiExe
      args = ['--host', '127.0.0.1', '--port', String(s.port)]
    } else {
      const uv = await findUv()
      if (!uv) throw new Error('uv not found')
      cmd = uv
      args = ['run', '--no-sync', 'acestep-api', '--host', '127.0.0.1', '--port', String(s.port)]
    }

    this.log(`Starting ACE-Step API: ${cmd} ${args.join(' ')}`)
    this.log(`DiT=${s.ditModel}  LM=${s.lmModel}  backend=${env.ACESTEP_LM_BACKEND}  offload=${s.offload}`)
    this.stopping = false
    const handle = run(cmd, args, {
      cwd: insp.path,
      env,
      onLine: (line, stream) => {
        // Hide uvicorn access lines produced by AceDeck's own polling.
        if (/"(GET|POST) \/(health|query_result|v1\/stats|v1\/models)[^"]*" 200/.test(line)) return
        if (this.status.state === 'starting' && /Loading primary DiT model|Loading LLM|lazy-loading models/.test(line)) this.set({ state: 'loading' })
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
        this.log(`Engine stopped (exit ${code}).`)
        this.set({ state: this.status.installed ? 'stopped' : 'not-installed', pid: null, startedAt: null, modelsInitialized: false, llmInitialized: false })
      } else {
        const tail = this.logs.filter((l) => l.stream !== 'sys').slice(-6).map((l) => l.text).join('\n')
        this.log(`Engine exited unexpectedly (code ${code}).`, 'err')
        this.set({ state: 'error', pid: null, startedAt: null, modelsInitialized: false, llmInitialized: false, lastError: `Engine exited with code ${code}\n${tail}` })
      }
    })

    // Wait for the HTTP server to come up.
    const deadline = Date.now() + 20 * 60 * 1000 // first start may download models
    for (;;) {
      if (!this.child) throw new Error(this.status.lastError ?? 'Engine process exited during start')
      try {
        await this.api.health(2000)
        break
      } catch {
        if (Date.now() > deadline) {
          await this.doStop()
          this.set({ state: 'error', lastError: 'Engine did not answer within 20 minutes' })
          throw new Error('Engine start timeout')
        }
        await sleep(1000)
      }
    }
    await this.afterHealthy()
  }

  /** Health is up: optionally warm the models, then go ready and keep polling. */
  private async afterHealthy(): Promise<void> {
    const s = getSettings()
    this.startHealth()
    const h = await this.api.health().catch(() => null)
    if (s.preloadModels && h && !h.models_initialized) {
      this.set({ state: 'loading' })
      let initLlm = s.initLlm === 'true'
      if (s.initLlm === 'auto') {
        const vram = (await gpuInfo())[0]?.memoryTotalMB ?? 0
        initLlm = vram >= 7500
      }
      this.log(`Loading models (DiT ${s.ditModel}${initLlm ? `, LM ${s.lmModel}` : ''})…`)
      const t0 = Date.now()
      try {
        await this.api.init({ model: s.ditModel, init_llm: initLlm, lm_model_path: s.lmModel })
        this.log(`Models loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s.`)
      } catch (e: any) {
        this.log(`Model warm-up failed: ${e.message}. Models will load on the first request.`, 'err')
      }
    }
    await this.pollHealth()
    if (this.running) this.set({ state: this.busy ? 'busy' : 'ready' })
  }

  private startHealth(): void {
    this.stopHealth()
    this.healthTimer = setInterval(() => void this.pollHealth(), 3000)
  }

  private stopHealth(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = null
  }

  private async pollHealth(): Promise<void> {
    try {
      const h = await this.api.health()
      this.set({
        modelsInitialized: h.models_initialized,
        llmInitialized: h.llm_initialized,
        loadedModel: h.loaded_model,
        loadedLm: h.loaded_lm_model,
      })
    } catch {
      // An attached external engine can disappear without an exit event.
      if (this.status.external && this.running && !this.stopping) {
        this.stopHealth()
        this.log('External engine is no longer reachable.', 'err')
        this.set({ state: 'stopped', external: false, pid: null, startedAt: null })
      }
    }
  }

  private async doStop(): Promise<void> {
    if (!this.running && !this.child) {
      // Maybe a stray engine still holds the port.
      const pid = await findPidByPort(getSettings().port)
      if (pid && this.status.external) await killTree(pid)
      return
    }
    this.stopping = true
    this.set({ state: 'stopping' })
    this.log('Stopping engine…')
    this.stopHealth()
    const pid = this.child?.pid ?? this.status.pid ?? (await findPidByPort(getSettings().port))
    if (pid) await killTree(pid)
    // Wait until the port is released so a restart does not collide.
    for (let i = 0; i < 30; i++) {
      try {
        await this.api.health(800)
        await sleep(500)
      } catch {
        break
      }
    }
    if (this.status.external) {
      this.log('External engine stopped.')
      this.set({ state: 'stopped', external: false, pid: null, startedAt: null, modelsInitialized: false, llmInitialized: false })
    }
    // For our own child the exit handler finalises the state.
    for (let i = 0; i < 20 && this.child; i++) await sleep(250)
    if (this.child === null && this.status.state === 'stopping') {
      this.set({ state: this.status.installed ? 'stopped' : 'not-installed', pid: null })
    }
  }

  /** Poll for an engine that was started outside AceDeck while we are idle. */
  async probeExternal(): Promise<void> {
    if (this.running || this.status.state === 'stopping' || !this.status.installed) return
    try {
      await this.api.health(1000)
      const pid = await findPidByPort(getSettings().port)
      this.log(`Detected a running engine on port ${getSettings().port}.`)
      this.set({ state: 'starting', external: true, pid, startedAt: Date.now() })
      await this.afterHealthy()
    } catch {
      /* nothing there */
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

export const engine = new EngineManager()
