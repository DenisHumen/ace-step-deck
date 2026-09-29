// One-click ACE-Step installer: uv → source → Python deps → models → config → verify.
import { app } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import os from 'node:os'
import type { ChildProcess } from 'node:child_process'
import type { InstallState, InstallStep, InstallStepId, LogLine } from '@shared/types'
import { ACE_STEP_REPO_GIT, ACE_STEP_REPO_ZIP, REQUIRED_DISK_GB, UV_ZIP_URL } from '@shared/constants'
import { checkpointsDir, inspectInstall, isAceStepDir } from './install-detect'
import { diskFreeGB, findUv, gpuInfo, toolsDir } from './system'
import { dirSize, download, emit, extractZip, formatBytes, run, throttle, uid, which } from './util'
import { getSettings, updateSettings } from './settings'
import { engine } from './engine'

const STEP_WEIGHTS: Record<InstallStepId, number> = { system: 2, uv: 4, source: 6, deps: 43, models: 40, config: 1, verify: 4 }
const STEP_ORDER: InstallStepId[] = ['system', 'uv', 'source', 'deps', 'models', 'config', 'verify']
/** Measured on Windows (torch cu128 + deps); used only to animate the install phase. */
const EXPECTED_VENV_BYTES = 6.58e9
const FALLBACK_MAIN_MODEL_BYTES = 10.1e9

class CancelledError extends Error {
  constructor() {
    super('Installation cancelled')
  }
}

export function defaultInstallPath(): string {
  return join(os.homedir(), 'AceDeck', 'ACE-Step-1.5')
}

function freshState(): InstallState {
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

class Installer {
  state: InstallState = freshState()
  private child: ChildProcess | null = null
  private abort: AbortController | null = null
  private cancelFlag = false
  private uvPath: string | null = null

  private push = throttle(() => emit('install:update', this.state), 150)

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

  private step(id: InstallStepId): InstallStep {
    return this.state.steps.find((s) => s.id === id)!
  }

  private setStep(id: InstallStepId, patch: Partial<InstallStep>): void {
    Object.assign(this.step(id), patch)
    this.update()
  }

  private log(text: string, stream: LogLine['stream'] = 'sys'): void {
    this.state.log.push({ t: Date.now(), stream, text })
    if (this.state.log.length > 500) this.state.log.splice(0, this.state.log.length - 500)
    engine.log(`[install] ${text}`, stream)
    this.push()
  }

  private checkCancel(): void {
    if (this.cancelFlag) throw new CancelledError()
  }

  cancel(): void {
    if (!this.state.running) return
    this.cancelFlag = true
    this.abort?.abort()
    if (this.child?.pid) void import('./util').then((u) => u.killTree(this.child!.pid!))
    this.log('Cancel requested…', 'err')
  }

  async start(rawPath: string): Promise<void> {
    if (this.state.running) throw new Error('Installer is already running')
    // "C:foo" is drive-relative on Windows and would silently install next to the app.
    const trimmed = rawPath.trim().replace(/[\\/]+$/, '')
    if (!isAbsolute(trimmed) || (process.platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(trimmed))) {
      throw new Error(`Choose a full folder path, e.g. ${defaultInstallPath()}`)
    }
    if (/[<>"|?*]/.test(trimmed.slice(2))) throw new Error('The folder path contains invalid characters')
    const targetPath = resolve(trimmed)
    this.state = { ...freshState(), running: true, targetPath, startedAt: Date.now() }
    this.cancelFlag = false
    this.update()
    this.log(`Installing ACE-Step 1.5 into ${targetPath}`)
    let current: InstallStepId = 'system'
    try {
      for (const id of STEP_ORDER) {
        current = id
        this.checkCancel()
        this.setStep(id, { status: 'running', progress: null, detail: '' })
        const result = await this.runStep(id, targetPath)
        this.setStep(id, { status: result === 'skipped' ? 'skipped' : 'done', progress: 1 })
      }
      this.state.finished = true
      this.log('Installation complete.')
      await updateSettings({ installPath: targetPath })
      await engine.refreshInstall()
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
      emit('install:update', this.state)
    }
  }

  private async runStep(id: InstallStepId, target: string): Promise<'done' | 'skipped'> {
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
      case 'config':
        return this.stepConfig(target)
      case 'verify':
        return this.stepVerify(target)
    }
  }

  // ── 1. System check ────────────────────────────────────────────────────────
  private async stepSystem(target: string): Promise<'done'> {
    const gpus = await gpuInfo()
    if (gpus.length) this.log(`GPU: ${gpus[0].name}, ${(gpus[0].memoryTotalMB / 1024).toFixed(1)} GB VRAM, driver ${gpus[0].driver}`)
    else this.log('No NVIDIA GPU detected — ACE-Step will run on CPU (very slow).', 'err')
    const free = await diskFreeGB(target)
    const existing = await inspectInstall(target)
    const need = existing.mainModels ? 3 : existing.venv ? 12 : REQUIRED_DISK_GB
    if (free !== null) {
      this.log(`Free disk space at target: ${free.toFixed(1)} GB (need ~${need} GB)`)
      if (free < need) throw new Error(`Not enough disk space: ${free.toFixed(1)} GB free, ~${need} GB required`)
    }
    this.setStep('system', {
      detail: `${gpus[0]?.name ?? 'CPU only'} · ${free !== null ? `${free.toFixed(0)} GB free` : 'disk ?'}`,
    })
    return 'done'
  }

  // ── 2. uv package manager ──────────────────────────────────────────────────
  private async stepUv(): Promise<'done' | 'skipped'> {
    // ACEDECK_TEST_FORCE_UV_DOWNLOAD=1 exercises the download path on machines that already have uv.
    const found = process.env.ACEDECK_TEST_FORCE_UV_DOWNLOAD === '1' ? null : await findUv()
    if (found) {
      this.uvPath = found
      this.setStep('uv', { detail: found })
      this.log(`uv found: ${found}`)
      return 'skipped'
    }
    this.log(`Downloading uv from ${UV_ZIP_URL}`)
    this.abort = new AbortController()
    this.uvPath = await downloadUv((progress, detail) => this.setStep('uv', { progress, detail }), this.abort.signal)
    this.checkCancel()
    this.setStep('uv', { detail: this.uvPath })
    this.log(`uv installed: ${this.uvPath}`)
    return 'done'
  }

  // ── 3. ACE-Step source ─────────────────────────────────────────────────────
  private async stepSource(target: string): Promise<'done' | 'skipped'> {
    if (await isAceStepDir(target)) {
      this.setStep('source', { detail: 'already present' })
      this.log('ACE-Step source already present, skipping download.')
      return 'skipped'
    }
    if (existsSync(target) && (await fsp.readdir(target)).length > 0) {
      throw new Error(`Target folder is not empty and is not an ACE-Step checkout: ${target}`)
    }
    await fsp.mkdir(join(target, '..'), { recursive: true })
    const git = process.env.ACEDECK_TEST_NO_GIT === '1' ? null : await which('git')
    if (git) {
      this.log(`git clone ${ACE_STEP_REPO_GIT}`)
      const h = run(git, ['clone', '--depth', '1', '--progress', ACE_STEP_REPO_GIT, target], {
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
      const zip = join(app.getPath('temp'), `acestep-${uid(4)}.zip`)
      this.log(`git not found — downloading source archive ${ACE_STEP_REPO_ZIP}`)
      this.abort = new AbortController()
      await download(
        ACE_STEP_REPO_ZIP,
        zip,
        (p) =>
          this.setStep('source', {
            progress: p.total ? (p.received / p.total) * 0.8 : null,
            detail: `${formatBytes(p.received)}${p.total ? ` / ${formatBytes(p.total)}` : ''} · ${formatBytes(p.bytesPerSec)}/s`,
          }),
        this.abort.signal,
      )
      this.checkCancel()
      this.setStep('source', { progress: 0.85, detail: 'Extracting…' })
      const tmp = join(app.getPath('temp'), `acestep-src-${uid(4)}`)
      await extractZip(zip, tmp)
      const inner = (await fsp.readdir(tmp)).find((n) => n.toLowerCase().startsWith('ace-step'))
      if (!inner) throw new Error('Unexpected archive layout')
      await fsp.cp(join(tmp, inner), target, { recursive: true })
      await fsp.rm(tmp, { recursive: true, force: true })
      await fsp.rm(zip, { force: true })
    }
    if (!(await isAceStepDir(target))) throw new Error('Downloaded source does not look like ACE-Step 1.5')
    this.setStep('source', { detail: target })
    return 'done'
  }

  // ── 4. Python + dependencies (uv sync) ─────────────────────────────────────
  private async stepDeps(target: string): Promise<'done'> {
    const uv = this.uvPath ?? (await findUv())
    if (!uv) throw new Error('uv not available')
    const announced = new Map<string, number>()
    const finished = new Set<string>()
    let phase: 'resolve' | 'download' | 'install' = 'resolve'
    let best = 0
    const parseSize = (s: string) => {
      const m = /([\d.]+)\s*(KiB|MiB|GiB|B)/.exec(s)
      if (!m) return 0
      const mult = m[2] === 'GiB' ? 1024 ** 3 : m[2] === 'MiB' ? 1024 ** 2 : m[2] === 'KiB' ? 1024 : 1
      return Number(m[1]) * mult
    }
    const recompute = (detail?: string) => {
      let p = best
      if (phase === 'download') {
        const total = [...announced.values()].reduce((a, b) => a + b, 0)
        const got = [...finished].reduce((a, n) => a + (announced.get(n) ?? 0), 0)
        p = 0.04 + 0.78 * (total ? got / total : 0)
      }
      best = Math.max(best, Math.min(p, 0.99))
      this.setStep('deps', { progress: best, ...(detail ? { detail } : {}) })
    }
    const venv = join(target, '.venv')
    const sizeTimer = setInterval(async () => {
      if (phase !== 'install') return
      const size = await dirSize(venv)
      best = Math.max(best, Math.min(0.82 + 0.17 * (size / EXPECTED_VENV_BYTES), 0.99))
      this.setStep('deps', { progress: best, detail: `Installing packages · ${formatBytes(size)}` })
    }, 1500)

    this.log(`${uv} sync`)
    const h = run(uv, ['sync', '--color', 'never'], {
      cwd: target,
      env: { ...process.env, UV_NO_PROGRESS: '0', PYTHONUTF8: '1' },
      onLine: (raw) => {
        const line = raw.trim()
        this.log(line)
        let m: RegExpExecArray | null
        if (/^Using CPython|^Creating virtual environment|^Downloading cpython/i.test(line)) recompute(line)
        else if ((m = /^Resolved (\d+) packages/.exec(line))) {
          best = Math.max(best, 0.04)
          phase = 'download'
          recompute(`Resolved ${m[1]} packages`)
        } else if ((m = /^Downloading (\S+) \(([^)]+)\)/.exec(line))) {
          phase = 'download'
          announced.set(m[1], parseSize(m[2]))
          recompute(`Downloading ${m[1]} (${m[2]})`)
        } else if ((m = /^Downloaded (\S+)/.exec(line))) {
          finished.add(m[1])
          recompute(`Downloaded ${m[1]}`)
        } else if (/^(Prepared|Building|Built|Installing|Uninstalled)/.test(line)) {
          phase = 'install'
          best = Math.max(best, 0.82)
          recompute(line)
        } else if (/^(Installed|Audited)/.test(line)) {
          best = 0.99
          recompute(line)
        }
      },
    })
    this.child = h.child
    const code = await h.done
    clearInterval(sizeTimer)
    this.checkCancel()
    if (code !== 0) throw new Error(`uv sync failed (exit ${code}). See the log for details.`)
    this.setStep('deps', { detail: 'Python environment ready' })
    return 'done'
  }

  // ── 5. Models ──────────────────────────────────────────────────────────────
  private async stepModels(target: string): Promise<'done' | 'skipped'> {
    const insp = await inspectInstall(target)
    if (insp.mainModels) {
      this.setStep('models', { detail: 'main models already downloaded' })
      this.log('Main models already present, skipping download.')
      return 'skipped'
    }
    const expected = await mainModelBytes()
    const ck = checkpointsDir(target)
    const before = await dirSize(ck)
    const started = Date.now()
    const tick = setInterval(async () => {
      const size = await dirSize(ck)
      const got = Math.max(0, size - before)
      const speed = got / Math.max(1, (Date.now() - started) / 1000)
      this.setStep('models', {
        progress: Math.min(0.99, size / expected),
        detail: `${formatBytes(size)} / ${formatBytes(expected)} · ${formatBytes(speed)}/s`,
      })
    }, 1000)
    const exe = join(target, '.venv', 'Scripts', 'acestep-download.exe')
    const uv = this.uvPath ?? (await findUv())
    const [cmd, args] = existsSync(exe) ? [exe, [] as string[]] : [uv!, ['run', '--no-sync', 'acestep-download']]
    this.log(`Downloading main models (~${formatBytes(expected)}) into ${ck}`)
    const h = run(cmd, args, {
      cwd: target,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
      onLine: (line) => {
        if (!/%\||Xet Storage|hf_xet/.test(line)) this.log(line)
      },
    })
    this.child = h.child
    const code = await h.done
    clearInterval(tick)
    this.checkCancel()
    if (code !== 0) throw new Error(`Model download failed (exit ${code})`)
    if (!(await inspectInstall(target)).mainModels) throw new Error('Model download finished but weights are missing')
    this.setStep('models', { detail: `${formatBytes(await dirSize(ck))} · ${((Date.now() - started) / 1000).toFixed(0)} s` })
    return 'done'
  }

  // ── 6. Config ──────────────────────────────────────────────────────────────
  private async stepConfig(target: string): Promise<'done' | 'skipped'> {
    const envFile = join(target, '.env')
    if (existsSync(envFile)) {
      this.setStep('config', { detail: '.env kept' })
      return 'skipped'
    }
    const insp = await inspectInstall(target)
    const example = join(target, '.env.example')
    let text = existsSync(example) ? await fsp.readFile(example, 'utf8') : ''
    const backend = insp.hasTriton ? 'vllm' : 'pt'
    text = text.replace(/^ACESTEP_LM_BACKEND=.*$/m, `ACESTEP_LM_BACKEND=${backend}`)
    if (!/^ACESTEP_LM_BACKEND=/m.test(text)) text += `\nACESTEP_LM_BACKEND=${backend}\n`
    await fsp.writeFile(envFile, text, 'utf8')
    this.setStep('config', { detail: `.env written (LM backend: ${backend})` })
    this.log(`Wrote ${envFile} (LM backend ${backend})`)
    return 'done'
  }

  // ── 7. Verify ──────────────────────────────────────────────────────────────
  private async stepVerify(target: string): Promise<'done'> {
    const py = join(target, '.venv', 'Scripts', 'python.exe')
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
    const gpus = await gpuInfo()
    if (!info.cuda && gpus.length) throw new Error(`PyTorch ${info.torch} cannot use the NVIDIA GPU (CUDA unavailable). Update the GPU driver.`)
    this.setStep('verify', { detail: `PyTorch ${info.torch} · ${info.cuda ? `CUDA OK · ${info.gpu}` : 'CPU mode'}` })
    this.log(`Verified: PyTorch ${info.torch}, CUDA ${info.cuda ? 'OK' : 'unavailable'}${info.gpu ? `, ${info.gpu}` : ''}`)
    return 'done'
  }
}

/** Fetch uv into AceDeck's tools folder (shared by the ACE-Step and the video installers). */
export async function downloadUv(onProgress: (progress: number | null, detail: string) => void, signal?: AbortSignal): Promise<string> {
  const zip = join(app.getPath('temp'), `uv-${uid(4)}.zip`)
  await download(
    UV_ZIP_URL,
    zip,
    (p) => onProgress(p.total ? (p.received / p.total) * 0.9 : null, `${formatBytes(p.received)}${p.total ? ` / ${formatBytes(p.total)}` : ''} · ${formatBytes(p.bytesPerSec)}/s`),
    signal,
  )
  await extractZip(zip, toolsDir())
  await fsp.rm(zip, { force: true })
  const uv = existsSync(join(toolsDir(), 'uv.exe')) ? join(toolsDir(), 'uv.exe') : await findUv()
  if (!uv) throw new Error('uv.exe not found after extraction')
  return uv
}

let cachedMainBytes: number | null = null
/** Exact size of the ACE-Step/Ace-Step1.5 repo from the Hugging Face API. */
export async function mainModelBytes(): Promise<number> {
  if (cachedMainBytes) return cachedMainBytes
  cachedMainBytes = (await repoBytes('ACE-Step/Ace-Step1.5')) ?? FALLBACK_MAIN_MODEL_BYTES
  return cachedMainBytes
}

export async function repoBytes(repo: string): Promise<number | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return null
    const list = (await res.json()) as { type: string; size?: number; lfs?: { size: number } }[]
    const total = list.filter((f) => f.type === 'file').reduce((a, f) => a + (f.lfs?.size ?? f.size ?? 0), 0)
    return total > 0 ? total : null
  } catch {
    return null
  }
}

export const installer = new Installer()

export function installDefaults(): { path: string; settingsPath: string | null } {
  return { path: getSettings().installPath ?? defaultInstallPath(), settingsPath: getSettings().installPath }
}
