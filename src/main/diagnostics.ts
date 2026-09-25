// Stability check: system → install → engine → stress generations → verdict.
import type { DiagCheck, DiagnosticsState, DiagSample, GenerationParams } from '@shared/types'
import { engine } from './engine'
import { queue, buildRequest } from './queue'
import { getSettings } from './settings'
import { diskFreeGB, gpuInfo } from './system'
import { emit, run, sleep, throttle } from './util'
import os from 'node:os'

const CHECKS: Pick<DiagCheck, 'id' | 'group'>[] = [
  { id: 'gpu', group: 'system' },
  { id: 'driver', group: 'system' },
  { id: 'vram', group: 'system' },
  { id: 'ram', group: 'system' },
  { id: 'disk', group: 'system' },
  { id: 'source', group: 'install' },
  { id: 'venv', group: 'install' },
  { id: 'models', group: 'install' },
  { id: 'torch', group: 'install' },
  { id: 'api', group: 'engine' },
  { id: 'latency', group: 'engine' },
  { id: 'loaded', group: 'engine' },
  { id: 'gen', group: 'stress' },
  { id: 'speed', group: 'stress' },
  { id: 'memory', group: 'stress' },
  { id: 'alive', group: 'stress' },
]

class Diagnostics {
  state: DiagnosticsState = { running: false, mode: null, checks: [], samples: [], verdict: null, score: null, startedAt: null, finishedAt: null }
  private cancelFlag = false
  private push = throttle(() => emit('diag:update', this.state), 150)

  private set(id: string, patch: Partial<DiagCheck>): void {
    const c = this.state.checks.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
    this.push()
  }

  private async check(id: string, fn: () => Promise<Partial<DiagCheck>>): Promise<DiagCheck> {
    if (this.cancelFlag) {
      this.set(id, { status: 'skip', detail: 'cancelled' })
      return this.state.checks.find((x) => x.id === id)!
    }
    const t0 = Date.now()
    this.set(id, { status: 'running' })
    try {
      const r = await fn()
      this.set(id, { status: 'pass', ...r, durationMs: Date.now() - t0 })
    } catch (e: any) {
      this.set(id, { status: 'fail', detail: e?.message ?? String(e), durationMs: Date.now() - t0 })
    }
    return this.state.checks.find((x) => x.id === id)!
  }

  cancel(): void {
    this.cancelFlag = true
  }

  async run(mode: 'quick' | 'full'): Promise<DiagnosticsState> {
    if (this.state.running) return this.state
    this.cancelFlag = false
    this.state = {
      running: true,
      mode,
      checks: CHECKS.map((c) => ({ ...c, status: 'pending' as const })),
      samples: [],
      verdict: null,
      score: null,
      startedAt: Date.now(),
      finishedAt: null,
    }
    this.push()
    engine.log(`[diagnostics] ${mode} stability check started`)
    const s = getSettings()

    // ── System ──
    const gpus = await gpuInfo()
    const g = gpus[0]
    await this.check('gpu', async () => {
      if (!g) return { status: 'warn', value: 'CPU only', detail: 'No NVIDIA GPU — generation will be very slow' }
      return { value: `${g.name} · ${(g.memoryTotalMB / 1024).toFixed(1)} GB` }
    })
    await this.check('driver', async () => {
      if (!g) return { status: 'skip' }
      const major = Number(g.driver.split('.')[0])
      const blackwell = /RTX 50|RTX PRO 6000|B200|GB10/i.test(g.name)
      const min = blackwell ? 570 : 525
      return major >= min ? { value: g.driver } : { status: 'fail', value: g.driver, detail: `Driver ${min}+ is required for CUDA 12.8` }
    })
    await this.check('vram', async () => {
      if (!g) return { status: 'skip' }
      const free = (g.memoryTotalMB - g.memoryUsedMB) / 1024
      const value = `${free.toFixed(1)} GB free of ${(g.memoryTotalMB / 1024).toFixed(1)} GB`
      if (engine.status.modelsInitialized) return { value, detail: 'models already loaded' }
      return free >= 6 ? { value } : free >= 3 ? { status: 'warn', value, detail: 'Close other GPU apps' } : { status: 'fail', value }
    })
    await this.check('ram', async () => {
      const gb = os.totalmem() / 1024 ** 3
      return gb >= 16 ? { value: `${gb.toFixed(0)} GB` } : { status: 'warn', value: `${gb.toFixed(0)} GB`, detail: '16 GB+ recommended' }
    })
    await this.check('disk', async () => {
      const free = await diskFreeGB(s.outputDir)
      if (free === null) return { status: 'skip' }
      const value = `${free.toFixed(0)} GB free`
      return free >= 5 ? { value } : free >= 1 ? { status: 'warn', value } : { status: 'fail', value }
    })

    // ── Install ──
    await engine.refreshInstall()
    const insp = engine.inspection
    await this.check('source', async () => {
      if (!insp?.source) throw new Error('ACE-Step source not found — open Setup')
      return { value: insp.revision ?? 'present' }
    })
    await this.check('venv', async () => {
      if (!insp?.venv) throw new Error('Python environment missing — run Setup / Repair')
      return { value: '.venv OK' }
    })
    await this.check('models', async () => {
      if (!insp?.mainModels) throw new Error('Main models are missing — download them in Models')
      return { value: 'turbo · LM 1.7B · VAE · text encoder' }
    })
    await this.check('torch', async () => {
      if (!insp?.python) throw new Error('python.exe not found')
      let out = ''
      const h = run(insp.python, ['-c', 'import torch,json;ok=torch.cuda.is_available();print("DIAG",json.dumps([torch.__version__,ok,torch.version.cuda]))'], {
        cwd: insp.path,
        onLine: (l) => {
          if (l.startsWith('DIAG ')) out = l.slice(5)
        },
      })
      if ((await h.done) !== 0 || !out) throw new Error('PyTorch failed to import')
      const [ver, cuda, cudaVer] = JSON.parse(out)
      if (!cuda && g) throw new Error(`PyTorch ${ver} cannot see the GPU`)
      return { value: `torch ${ver}${cuda ? ` · CUDA ${cudaVer}` : ' · CPU'}` }
    })

    // ── Engine ──
    const api = await this.check('api', async () => {
      if (!engine.running) {
        if (!engine.status.installed) throw new Error('Engine is not installed')
        this.set('api', { detail: 'starting engine…' })
        await engine.start()
      }
      if (!(await engine.waitReady(10 * 60 * 1000))) throw new Error(engine.status.lastError ?? 'Engine did not become ready')
      const h = await engine.api.health()
      return { value: `port ${s.port} · ${h.status}`, detail: undefined }
    })
    await this.check('latency', async () => {
      if (api.status !== 'pass') return { status: 'skip' }
      const times: number[] = []
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now()
        await engine.api.health()
        times.push(performance.now() - t0)
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length
      return { status: avg < 300 ? 'pass' : 'warn', value: `${avg.toFixed(0)} ms avg` }
    })
    await this.check('loaded', async () => {
      if (api.status !== 'pass') return { status: 'skip' }
      const h = await engine.api.health()
      return {
        status: h.models_initialized ? 'pass' : 'warn',
        value: `${h.loaded_model ?? '—'}${h.llm_initialized ? ` + ${h.loaded_lm_model ?? 'LM'}` : ''}`,
        detail: h.models_initialized ? undefined : 'models load lazily on first request',
      }
    })

    // ── Stress ──
    const stressIds = ['gen', 'speed', 'memory', 'alive']
    const busy = queue.state.jobs.some((j) => j.status === 'running')
    if (api.status !== 'pass' || busy || this.cancelFlag) {
      for (const id of stressIds) this.set(id, { status: 'skip', detail: busy ? 'Queue is busy — run again when idle' : undefined })
    } else {
      const plan: Partial<GenerationParams>[] =
        mode === 'quick'
          ? [{ thinking: false }]
          : [{ thinking: false }, { thinking: false }, { thinking: true }, { thinking: false }]
      const base: Partial<GenerationParams> = {
        prompt: 'diagnostic run, calm solo piano, soft',
        instrumental: true,
        lyrics: '[Instrumental]',
        audio_duration: 15,
        audio_format: 'mp3',
        use_random_seed: false,
        seed: 1234,
      }
      let vramBaseline: number | null = null
      const vramAfter: number[] = []
      await this.check('gen', async () => {
        for (let i = 0; i < plan.length; i++) {
          if (this.cancelFlag) break
          this.set('gen', { value: `${i + 1} / ${plan.length}` })
          const sample = await this.sampleRun(i, { ...base, ...plan[i] })
          this.state.samples.push(sample)
          const now = (await gpuInfo())[0]?.memoryUsedMB ?? null
          if (now !== null) {
            if (vramBaseline === null) vramBaseline = now
            vramAfter.push(now)
          }
          this.push()
        }
        const ok = this.state.samples.filter((x) => x.ok).length
        const total = this.state.samples.length
        if (ok === 0) throw new Error(this.state.samples[0]?.error ?? 'All test generations failed')
        return { status: ok === total ? 'pass' : 'warn', value: `${ok}/${total} succeeded` }
      })
      await this.check('speed', async () => {
        const ok = this.state.samples.filter((x) => x.ok)
        if (ok.length < 1) return { status: 'skip' }
        const times = ok.map((x) => x.seconds)
        const avg = times.reduce((a, b) => a + b, 0) / times.length
        const sd = Math.sqrt(times.reduce((a, b) => a + (b - avg) ** 2, 0) / times.length)
        const cv = avg ? sd / avg : 0
        const rtf = 15 / avg
        return {
          status: ok.length > 1 && cv > 0.6 ? 'warn' : 'pass',
          value: `${avg.toFixed(1)} s / 15 s clip · ${rtf.toFixed(1)}× realtime`,
          detail: ok.length > 1 ? `variation ${(cv * 100).toFixed(0)}%` : undefined,
        }
      })
      await this.check('memory', async () => {
        const peaks = this.state.samples.map((x) => x.vramPeakMB).filter((x): x is number => x !== null)
        if (!peaks.length || !g) return { status: 'skip' }
        const peak = Math.max(...peaks)
        const growth = vramAfter.length > 1 ? vramAfter[vramAfter.length - 1] - vramAfter[0] : 0
        const nearLimit = peak > g.memoryTotalMB * 0.97
        return {
          status: growth > 1500 || nearLimit ? 'warn' : 'pass',
          value: `peak ${(peak / 1024).toFixed(1)} GB of ${(g.memoryTotalMB / 1024).toFixed(1)} GB`,
          detail: growth > 1500 ? `VRAM grew by ${(growth / 1024).toFixed(1)} GB between runs` : nearLimit ? 'VRAM nearly full — consider offload' : `drift ${(growth / 1024).toFixed(2)} GB`,
        }
      })
      await this.check('alive', async () => {
        await engine.api.health(3000)
        return { value: 'engine healthy after stress' }
      })
    }

    // ── Verdict ──
    const cs = this.state.checks
    const fails = cs.filter((c) => c.status === 'fail')
    const warns = cs.filter((c) => c.status === 'warn')
    const critical = fails.some((c) => ['source', 'venv', 'torch', 'api', 'gen', 'alive'].includes(c.id))
    this.state.score = Math.max(0, Math.min(100, 100 - fails.length * 25 - warns.length * 8))
    this.state.verdict = critical ? 'failed' : fails.length || warns.some((c) => c.group === 'stress') ? 'unstable' : 'stable'
    this.state.running = false
    this.state.finishedAt = Date.now()
    engine.log(`[diagnostics] verdict: ${this.state.verdict} (score ${this.state.score})`)
    emit('diag:update', this.state)
    return this.state
  }

  private async sampleRun(index: number, params: Partial<GenerationParams>): Promise<DiagSample> {
    const t0 = Date.now()
    let peak: number | null = null
    let stop = false
    const vramPoll = (async () => {
      while (!stop) {
        const used = (await gpuInfo())[0]?.memoryUsedMB
        if (used !== undefined) peak = Math.max(peak ?? 0, used)
        await sleep(700)
      }
    })()
    try {
      const taskId = await engine.api.releaseTask(buildRequest(params, 1, 0))
      for (;;) {
        if (this.cancelFlag) throw new Error('cancelled')
        await sleep(1000)
        const r = await engine.api.query(taskId)
        if (r.item.status === 1) break
        if (r.item.status === 2) throw new Error(r.entries[0]?.error || r.item.progress_text || 'generation failed')
        if (Date.now() - t0 > 10 * 60 * 1000) throw new Error('timeout')
      }
      return { index, ok: true, seconds: (Date.now() - t0) / 1000, vramPeakMB: peak }
    } catch (e: any) {
      return { index, ok: false, seconds: (Date.now() - t0) / 1000, vramPeakMB: peak, error: e.message }
    } finally {
      stop = true
      await vramPoll
    }
  }
}

export const diagnostics = new Diagnostics()
