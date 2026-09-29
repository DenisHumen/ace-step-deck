// One-click ComfyUI installer for the video studio: uv → ComfyUI source → Python + CUDA PyTorch → Wan 2.1 models → verify.
import { app } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import os from 'node:os'
import type { ChildProcess } from 'node:child_process'
import type { InstallStep, LogLine } from '@shared/types'
import { COMFY_REPO_GIT, COMFY_REPO_ZIP, VIDEO_MODEL_CATALOG, VIDEO_REQUIRED_DISK_GB, type VideoInstallState, type VideoInstallStepId } from '@shared/video'
import { diskFreeGB, findUv, gpuInfo } from '../system'
import { dirSize, download, downloadResumable, emit, extractZip, formatBytes, killTree, run, throttle, uid, which } from '../util'
import { getSettings, updateSettings } from '../settings'
import { downloadUv } from '../installer'
import { inspectComfy, videoEngine } from './engine'
import { modelPath } from './models'

const STEP_WEIGHTS: Record<VideoInstallStepId, number> = { system: 1, uv: 3, source: 5, deps: 45, models: 42, verify: 4 }
const STEP_ORDER: VideoInstallStepId[] = ['system', 'uv', 'source', 'deps', 'models', 'verify']
/** torch cu128 + ComfyUI requirements on Windows; only used to animate the install phase. */
const EXPECTED_VENV_BYTES = 6.2e9

class CancelledError extends Error {
  constructor() {
    super('Installation cancelled')
  }
}

export function defaultVideoInstallPath(): string {
  return join(os.homedir(), 'AceDeck', 'ComfyUI')
}

function freshState(): VideoInstallState {
  return {
    running: false,
    finished: false,
    cancelled: false,
    targetPath: null,
    steps: STEP_ORDER.map((id) => ({ id, status: 'pending', progress: 0, detail: '' })),
    overall: 0,
    error: null,
    startedAt: null,
    log: [],
  }
}

class VideoInstaller {
  state: VideoInstallState = freshState()
  private child: ChildProcess | null = null
  private abort: AbortController | null = null
  private cancelFlag = false
  private uvPath: string | null = null
  private push = throttle(() => emit('video:install', this.state), 150)

  private update(): void {
    let total = 0
    let done = 0
    for (const s of this.state.steps) {
      const w = STEP_WEIGHTS[s.id]
      total += w
      if (s.status === 'done' || s.status === 'skipped') done += w
      else if (s.status === 'running') done += w * (s.progress ?? 0)
    }
    this.state.overall = total ? done / total : 0
    this.push()
  }

  private setStep(id: VideoInstallStepId, patch: Partial<InstallStep<VideoInstallStepId>>): void {
    Object.assign(this.state.steps.find((s) => s.id === id)!, patch)
    this.update()
  }

  private log(text: string, stream: LogLine['stream'] = 'sys'): void {
    this.state.log.push({ t: Date.now(), stream, text })
    if (this.state.log.length > 500) this.state.log.splice(0, this.state.log.length - 500)
    videoEngine.log(`[install] ${text}`, stream)
    this.push()
  }

  private checkCancel(): void {
    if (this.cancelFlag) throw new CancelledError()
  }

  cancel(): void {
    if (!this.state.running) return
    this.cancelFlag = true
    this.abort?.abort()
    if (this.child?.pid) void killTree(this.child.pid)
    this.log('Cancel requested…', 'err')
  }

  async start(rawPath: string): Promise<void> {
    if (this.state.running) throw new Error('Installer is already running')
    const trimmed = rawPath.trim().replace(/[\\/]+$/, '')
    if (!isAbsolute(trimmed) || (process.platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(trimmed))) {
      throw new Error(`Choose a full folder path, e.g. ${defaultVideoInstallPath()}`)
    }
    if (/[<>"|?*]/.test(trimmed.slice(2))) throw new Error('The folder path contains invalid characters')
    if (videoEngine.running && !videoEngine.status.external && getSettings().videoInstallPath === resolve(trimmed)) await videoEngine.stop()
    const target = resolve(trimmed)
    this.state = { ...freshState(), running: true, targetPath: target, startedAt: Date.now() }
    this.cancelFlag = false
    this.update()
    this.log(`Installing ComfyUI for video into ${target}`)
    let current: VideoInstallStepId = 'system'
    try {
      for (const id of STEP_ORDER) {
        current = id
        this.checkCancel()
        this.setStep(id, { status: 'running', progress: null, detail: '' })
        const result = await this.runStep(id, target)
        this.setStep(id, { status: result === 'skipped' ? 'skipped' : 'done', progress: 1 })
      }
      this.state.finished = true
      this.log('Installation complete.')
    } catch (e: any) {
      const cancelled = e instanceof CancelledError || this.cancelFlag
      this.state.cancelled = cancelled
      this.state.error = cancelled ? 'Installation cancelled' : e?.message ?? String(e)
      this.setStep(current, { status: 'error', error: this.state.error ?? undefined })
      this.log(this.state.error ?? 'Installation failed', 'err')
    } finally {
      this.child = null
      this.abort = null
      this.state.running = false
      this.update()
      emit('video:install', this.state)
    }
  }

  private runStep(id: VideoInstallStepId, target: string): Promise<'done' | 'skipped'> {
    switch (id) {
      case 'system':
        return this.stepSystem(target)
      case 'uv':
        return this.stepUv()
      case 'source':
        return this.stepSource(target)
      case 'deps':
        return this.stepDeps(target)
      case 'models':
        return this.stepModels(target)
      case 'verify':
        return this.stepVerify(target)
    }
  }

  private async stepSystem(target: string): Promise<'done'> {
    const gpus = await gpuInfo()
    if (gpus.length) this.log(`GPU: ${gpus[0].name}, ${(gpus[0].memoryTotalMB / 1024).toFixed(1)} GB VRAM, driver ${gpus[0].driver}`)
    else this.log('No NVIDIA GPU detected — video generation on CPU is impractically slow.', 'err')
    const free = await diskFreeGB(target)
    const insp = await inspectComfy(target)
    const need = insp.python ? 12 : VIDEO_REQUIRED_DISK_GB
    if (free !== null) {
      this.log(`Free disk space at target: ${free.toFixed(1)} GB (need ~${need} GB)`)
      if (free < need) throw new Error(`Not enough disk space: ${free.toFixed(1)} GB free, ~${need} GB required`)
    }
    this.setStep('system', { detail: `${gpus[0]?.name ?? 'CPU only'} · ${free !== null ? `${free.toFixed(0)} GB free` : 'disk ?'}` })
    return 'done'
  }

  private async stepUv(): Promise<'done' | 'skipped'> {
    const found = await findUv()
    if (found) {
      this.uvPath = found
      this.setStep('uv', { detail: found })
      return 'skipped'
    }
    this.abort = new AbortController()
    this.uvPath = await downloadUv((progress, detail) => this.setStep('uv', { progress, detail }), this.abort.signal)
    this.checkCancel()
    this.setStep('uv', { detail: this.uvPath })
    this.log(`uv installed: ${this.uvPath}`)
    return 'done'
  }

  private async stepSource(target: string): Promise<'done' | 'skipped'> {
    if ((await inspectComfy(target)).source) {
      this.setStep('source', { detail: 'already present' })
      this.log('ComfyUI source already present, skipping download.')
      return 'skipped'
    }
    if (existsSync(target) && (await fsp.readdir(target)).length > 0) throw new Error(`Target folder is not empty and is not a ComfyUI checkout: ${target}`)
    await fsp.mkdir(join(target, '..'), { recursive: true })
    const git = await which('git')
    if (git) {
      this.log(`git clone ${COMFY_REPO_GIT}`)
      const h = run(git, ['clone', '--depth', '1', '--progress', COMFY_REPO_GIT, target], {
        onLine: (line) => {
          const m = /(Receiving objects|Resolving deltas|Updating files):\s+(\d+)%/.exec(line)
          if (m) {
            const pct = Number(m[2]) / 100
            const progress = m[1] === 'Receiving objects' ? pct * 0.85 : m[1] === 'Resolving deltas' ? 0.85 + pct * 0.1 : 0.95 + pct * 0.05
            this.setStep('source', { progress, detail: line.trim().slice(0, 80) })
          } else this.log(line)
        },
      })
      this.child = h.child
      const code = await h.done
      this.checkCancel()
      if (code !== 0) throw new Error(`git clone failed (exit ${code})`)
    } else {
      const zip = join(app.getPath('temp'), `comfyui-${uid(4)}.zip`)
      this.log(`git not found — downloading ${COMFY_REPO_ZIP}`)
      this.abort = new AbortController()
      await download(
        COMFY_REPO_ZIP,
        zip,
        (p) => this.setStep('source', { progress: p.total ? (p.received / p.total) * 0.8 : null, detail: `${formatBytes(p.received)} · ${formatBytes(p.bytesPerSec)}/s` }),
        this.abort.signal,
      )
      this.checkCancel()
      this.setStep('source', { progress: 0.85, detail: 'Extracting…' })
      const tmp = join(app.getPath('temp'), `comfyui-src-${uid(4)}`)
      await extractZip(zip, tmp)
      const inner = (await fsp.readdir(tmp)).find((n) => n.toLowerCase().startsWith('comfyui'))
      if (!inner) throw new Error('Unexpected archive layout')
      await fsp.cp(join(tmp, inner), target, { recursive: true })
      await fsp.rm(tmp, { recursive: true, force: true })
      await fsp.rm(zip, { force: true })
    }
    if (!(await inspectComfy(target)).source) throw new Error('Downloaded source does not look like ComfyUI')
    this.setStep('source', { detail: target })
    return 'done'
  }

  private async stepDeps(target: string): Promise<'done'> {
    const uv = this.uvPath ?? (await findUv())
    if (!uv) throw new Error('uv not available')
    const env = { ...process.env, PYTHONUTF8: '1', UV_NO_PROGRESS: '0' }
    let py = (await inspectComfy(target)).python
    if (!py) {
      this.log(`${uv} venv --python 3.12 .venv`)
      const h = run(uv, ['venv', '--python', '3.12', '--seed', '--color', 'never', '.venv'], { cwd: target, env, onLine: (l) => this.log(l) })
      this.child = h.child
      const code = await h.done
      this.checkCancel()
      if (code !== 0) throw new Error(`Creating the Python environment failed (exit ${code})`)
      py = join(target, '.venv', 'Scripts', 'python.exe')
    }
    this.setStep('deps', { progress: 0.03, detail: 'Python 3.12 environment ready' })

    // --torch-backend routes torch/torchvision/torchaudio to the matching PyTorch index (CUDA 12.8 covers RTX 50xx).
    const backend = (await gpuInfo()).length ? 'cu128' : 'cpu'
    const announced = new Map<string, number>()
    const finished = new Set<string>()
    let phase: 'resolve' | 'download' | 'install' = 'resolve'
    let best = 0.03
    const parseSize = (s: string) => {
      const m = /([\d.]+)\s*(KiB|MiB|GiB|B)/.exec(s)
      if (!m) return 0
      return Number(m[1]) * (m[2] === 'GiB' ? 1024 ** 3 : m[2] === 'MiB' ? 1024 ** 2 : m[2] === 'KiB' ? 1024 : 1)
    }
    const bump = (p: number, detail?: string) => {
      best = Math.max(best, Math.min(p, 0.99))
      this.setStep('deps', { progress: best, ...(detail ? { detail } : {}) })
    }
    const venv = join(target, '.venv')
    const sizeTimer = setInterval(async () => {
      if (phase !== 'install' || !existsSync(venv)) return
      const size = await dirSize(venv)
      bump(0.82 + 0.17 * (size / EXPECTED_VENV_BYTES), `Installing packages · ${formatBytes(size)}`)
    }, 1500)
    const args = ['pip', 'install', '--python', py, '-r', 'requirements.txt', '--torch-backend', backend, '--color', 'never']
    this.log(`${uv} ${args.join(' ')}`)
    const h = run(uv, args, {
      cwd: target,
      env,
      onLine: (raw) => {
        const line = raw.trim()
        this.log(line)
        let m: RegExpExecArray | null
        if ((m = /^Resolved (\d+) packages/.exec(line))) {
          phase = 'download'
          bump(0.05, `Resolved ${m[1]} packages`)
        } else if ((m = /^Downloading (\S+) \(([^)]+)\)/.exec(line))) {
          phase = 'download'
          announced.set(m[1], parseSize(m[2]))
          bump(best, `Downloading ${m[1]} (${m[2]})`)
        } else if ((m = /^Downloaded (\S+)/.exec(line))) {
          finished.add(m[1])
          const total = [...announced.values()].reduce((a, b) => a + b, 0)
          const got = [...finished].reduce((a, n) => a + (announced.get(n) ?? 0), 0)
          bump(0.05 + 0.77 * (total ? got / total : 0), `Downloaded ${m[1]}`)
        } else if (/^(Prepared|Building|Built|Installing|Uninstalled)/.test(line)) {
          phase = 'install'
          bump(0.82, line)
        } else if (/^(Installed|Audited)/.test(line)) bump(0.99, line)
      },
    })
    this.child = h.child
    const code = await h.done
    clearInterval(sizeTimer)
    this.checkCancel()
    if (code !== 0) throw new Error(`Installing Python packages failed (exit ${code}). See the log for details.`)
    this.setStep('deps', { detail: `Python packages ready (PyTorch ${backend})` })
    return 'done'
  }

  private async stepModels(target: string): Promise<'done' | 'skipped'> {
    // modelPath() follows the settings, so point them at the new install first.
    await updateSettings({ videoInstallPath: target })
    const missing = VIDEO_MODEL_CATALOG.filter((m) => !existsSync(modelPath(m.kind, m.file)!))
    if (!missing.length) {
      this.setStep('models', { detail: 'Wan 2.1 models already downloaded' })
      this.log('Wan 2.1 models already present, skipping download.')
      return 'skipped'
    }
    const expected = missing.reduce((a, m) => a + m.approxGB * 1e9, 0)
    let doneBytes = 0
    for (const m of missing) {
      this.checkCancel()
      this.log(`Downloading ${m.file} (~${m.approxGB} GB)`)
      this.abort = new AbortController()
      let last = 0
      await downloadResumable(
        m.url!,
        modelPath(m.kind, m.file)!,
        (p) => {
          last = p.received
          this.setStep('models', {
            progress: Math.min(0.99, (doneBytes + p.received) / expected),
            detail: `${m.file} · ${formatBytes(p.received)}${p.total ? ` / ${formatBytes(p.total)}` : ''} · ${formatBytes(p.bytesPerSec)}/s`,
          })
        },
        this.abort.signal,
      )
      doneBytes += last
    }
    this.setStep('models', { detail: `${missing.length} file(s) · ${formatBytes(doneBytes)}` })
    return 'done'
  }

  private async stepVerify(target: string): Promise<'done'> {
    const py = (await inspectComfy(target)).python
    if (!py) throw new Error('Python environment is missing')
    const code = [
      'import json, torch',
      'ok = torch.cuda.is_available()',
      'print("ACEDECK_VERIFY " + json.dumps({"torch": torch.__version__, "cuda": ok, "gpu": torch.cuda.get_device_name(0) if ok else None, "ok_matmul": bool(ok and (torch.ones(256,256,device="cuda") @ torch.ones(256,256,device="cuda")).sum().item() == 256**3)}))',
    ].join('; ')
    let info: any = null
    const h = run(py, ['-c', code], {
      cwd: target,
      onLine: (line) => {
        if (line.startsWith('ACEDECK_VERIFY ')) info = JSON.parse(line.slice(15))
        else this.log(line)
      },
    })
    this.child = h.child
    const rc = await h.done
    if (rc !== 0 || !info) throw new Error('Python environment check failed')
    if (!info.cuda && (await gpuInfo()).length) throw new Error(`PyTorch ${info.torch} cannot use the NVIDIA GPU (CUDA unavailable). Update the GPU driver.`)
    this.setStep('verify', { detail: `PyTorch ${info.torch} · ${info.cuda ? `CUDA OK · ${info.gpu}` : 'CPU mode'}` })
    this.log(`Verified: PyTorch ${info.torch}, CUDA ${info.cuda ? 'OK' : 'unavailable'}${info.gpu ? `, ${info.gpu}` : ''}`)
    await videoEngine.refreshInstall()
    return 'done'
  }
}

export const videoInstaller = new VideoInstaller()
