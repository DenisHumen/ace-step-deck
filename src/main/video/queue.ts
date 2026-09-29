// Video render queue: one ComfyUI prompt per clip, progress over the websocket, /history as the source of truth.
import { app, BrowserWindow, Notification } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { slugify } from '@shared/logic'
import {
  DEFAULT_VIDEO_PARAMS,
  WF,
  buildWanWorkflow,
  clipCost,
  clipProgress,
  normalizeVideoParams,
  stageForNode,
  videoJobTitle,
  type VideoClip,
  type VideoJob,
  type VideoJobSpec,
  type VideoParams,
  type VideoQueueState,
} from '@shared/video'
import { gpu } from '../gpu'
import { getSettings } from '../settings'
import { emit, readJson, sleep, throttle, uid, writeJson } from '../util'
import { outputFiles, type OutputFile } from './comfy-api'
import { videoEngine } from './engine'
import { videoLibrary } from './library'
import { modelPath } from './models'

const queueFile = () => join(app.getPath('userData'), 'video-queue.json')
const MAX_FINISHED = 200

type FollowResult = { files: OutputFile[] } | { error: string } | { cancelled: true } | { lost: Error }
/** Timing of the clip being rendered, shared by the websocket listener and the /history poller. */
interface ClipRun {
  t0: number
  /** When the first sampler step was reported, and which step that was. */
  samplingStart: number
  firstStep: number
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 48)

class VideoQueueManager {
  state: VideoQueueState = { jobs: [], paused: false, activeJobId: null, secondsPerCost: null }
  private working = false
  private readonly clientId = `acedeck-${uid(4)}`
  private push = throttle(() => emit('video:queue', this.state), 200)
  private persist = throttle(() => void writeJson(queueFile(), this.state), 1000)

  async load(): Promise<void> {
    const saved = await readJson<VideoQueueState>(queueFile(), this.state)
    for (const j of saved.jobs ?? []) {
      if (j.status === 'running') {
        j.status = 'pending'
        j.stage = 'queued'
        j.promptId = null
      }
    }
    this.state = { ...this.state, ...saved, activeJobId: null }
  }

  private changed(): void {
    this.push()
    this.persist()
  }

  get(id: string): VideoJob | undefined {
    return this.state.jobs.find((j) => j.id === id)
  }

  add(spec: VideoJobSpec): VideoJob {
    const params = normalizeVideoParams({ ...DEFAULT_VIDEO_PARAMS, model: getSettings().videoModel, ...spec.params })
    if (!params.prompt) throw new Error('Describe the video first')
    const count = Math.max(1, Math.min(50, Math.floor(spec.count || 1)))
    const clean: VideoJobSpec = { ...spec, params, count }
    const job: VideoJob = {
      id: uid(6),
      title: videoJobTitle(params, spec.title),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      status: 'pending',
      spec: clean,
      clipsDone: 0,
      progress: 0,
      clipProgress: 0,
      stage: 'queued',
      step: 0,
      steps: params.steps,
      promptId: null,
      clipIds: [],
      error: null,
      cancelRequested: false,
      etaSeconds: null,
    }
    this.state.jobs.push(job)
    this.changed()
    this.kick()
    return job
  }

  cancel(id: string): void {
    const j = this.get(id)
    if (!j) return
    if (j.status === 'pending') {
      Object.assign(j, { status: 'cancelled', stage: 'cancelled', finishedAt: Date.now() })
    } else if (j.status === 'running') {
      j.cancelRequested = true
      if (j.promptId) void videoEngine.api.interrupt(j.promptId)
    }
    this.changed()
  }

  remove(id: string): void {
    const j = this.get(id)
    if (!j || j.status === 'running') return
    this.state.jobs = this.state.jobs.filter((x) => x.id !== id)
    this.changed()
  }

  retry(id: string): void {
    const j = this.get(id)
    if (!j || (j.status !== 'failed' && j.status !== 'cancelled')) return
    Object.assign(j, { status: 'pending', error: null, stage: 'queued', cancelRequested: false, finishedAt: null, promptId: null, clipProgress: 0 })
    this.changed()
    this.kick()
  }

  duplicate(id: string): VideoJob | undefined {
    const j = this.get(id)
    return j ? this.add(structuredClone(j.spec)) : undefined
  }

  setPaused(paused: boolean): void {
    this.state.paused = paused
    this.changed()
    if (!paused) this.kick()
  }

  clearFinished(): void {
    this.state.jobs = this.state.jobs.filter((j) => j.status === 'pending' || j.status === 'running')
    this.changed()
  }

  kick(): void {
    if (!this.working) void this.work()
  }

  private async work(): Promise<void> {
    if (this.state.paused || !this.state.jobs.some((j) => j.status === 'pending')) return
    this.working = true
    try {
      for (;;) {
        if (this.state.paused) return
        const job = this.state.jobs.find((j) => j.status === 'pending')
        if (!job) return
        if (gpu.busyWith === 'music') {
          job.stage = 'gpu'
          this.changed()
        }
        const release = await gpu.acquire('video')
        try {
          if (!videoEngine.ready) {
            if (videoEngine.status.installed && (videoEngine.status.state === 'stopped' || videoEngine.status.state === 'error')) {
              job.stage = 'starting'
              this.changed()
              await videoEngine.start().catch(() => {})
            }
            if (!(await videoEngine.waitReady(5 * 60 * 1000))) {
              job.stage = 'waiting'
              this.changed()
              return // resumed by video:status → ready
            }
          }
          await this.runJob(job)
        } finally {
          release()
        }
      }
    } finally {
      this.state.activeJobId = null
      videoEngine.setBusy(false)
      this.working = false
      this.changed()
      void gpu.videoIdle()
    }
  }

  private async runJob(job: VideoJob): Promise<void> {
    this.state.activeJobId = job.id
    job.status = 'running'
    job.startedAt ??= Date.now()
    job.error = null
    videoEngine.setBusy(true)
    this.changed()

    const p = normalizeVideoParams(job.spec.params)
    const missing = [p.model, ...p.loras.map((l) => l.file)].find((f, i) => {
      const path = modelPath(i === 0 ? 'diffusion' : 'lora', f)
      return path && !existsSync(path) && !existsSync(join(path, '..', '..', 'unet', f))
    })
    if (missing && !videoEngine.status.external) return this.fail(job, `Model file is not downloaded: ${missing}`)

    const outDir = getSettings().videoOutputDir
    await fsp.mkdir(outDir, { recursive: true })

    while (job.clipsDone < job.spec.count) {
      if (job.cancelRequested) break
      const seed = p.randomSeed || p.seed < 0 ? randomSeed() : p.seed + job.clipsDone
      const t0 = Date.now()
      Object.assign(job, { stage: 'queued', step: 0, steps: p.steps, clipProgress: 0, promptId: null })
      this.changed()

      const n = job.clipsDone + 1
      const d = new Date()
      const pad = (x: number) => String(x).padStart(2, '0')
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
      const name = `${stamp}_${slugify(job.title)}${job.spec.count > 1 ? `_${n}` : ''}`

      const run: ClipRun = { t0, samplingStart: 0, firstStep: 0 }
      const events = this.subscribe(job, p, run)
      let promptId: string
      try {
        promptId = await videoEngine.api.queuePrompt(buildWanWorkflow(p, seed, `acedeck/${name}`), this.clientId)
      } catch (e: any) {
        events.close()
        if (await this.engineLost(job, e)) return
        return this.fail(job, e.message)
      }
      job.promptId = promptId
      events.promptId = promptId
      const result = await this.follow(job, promptId, p, run)
      events.close()
      job.promptId = null

      if ('cancelled' in result) break
      if ('lost' in result) {
        if (await this.engineLost(job, result.lost)) return
        return this.fail(job, result.lost.message)
      }
      if ('error' in result) return this.fail(job, result.error)

      job.stage = 'saving'
      this.changed()
      const out = result.files.find((f) => /\.(mp4|webm|mkv|webp|gif)$/i.test(f.filename))
      if (!out) return this.fail(job, 'ComfyUI finished without producing a video')
      const dest = join(outDir, `${name}${out.filename.slice(out.filename.lastIndexOf('.'))}`)
      try {
        await videoEngine.api.download(out, dest)
      } catch (e: any) {
        return this.fail(job, e.message)
      }
      await this.dropComfyCopy(out)
      const renderSeconds = (Date.now() - t0) / 1000
      const clip: VideoClip = {
        id: uid(6),
        jobId: job.id,
        title: job.spec.count > 1 ? `${job.title.length > 50 ? `${job.title.slice(0, 49).trimEnd()}…` : job.title} #${n}` : job.title,
        file: dest,
        sizeBytes: (await fsp.stat(dest)).size,
        createdAt: Date.now(),
        seed,
        renderSeconds,
        favorite: false,
        params: { ...p, seed, randomSeed: false },
      }
      await videoLibrary.add(clip)
      job.clipIds.push(clip.id)

      const perCost = renderSeconds / Math.max(0.05, clipCost(p))
      this.state.secondsPerCost = this.state.secondsPerCost ? this.state.secondsPerCost * 0.6 + perCost * 0.4 : perCost
      job.clipsDone += 1
      job.clipProgress = 1
      job.progress = job.clipsDone / job.spec.count
      this.changed()
    }

    job.finishedAt = Date.now()
    job.promptId = null
    job.etaSeconds = null
    if (job.cancelRequested) {
      job.status = 'cancelled'
      job.stage = 'cancelled'
    } else {
      job.status = 'done'
      job.stage = 'done'
      job.progress = 1
      this.notify(`🎬 ${job.title}`, `${job.clipIds.length} clip(s) ready`)
    }
    this.trimFinished()
    this.changed()
  }

  /** Websocket listener that turns ComfyUI node events into stage/step progress for `job`. */
  private subscribe(job: VideoJob, p: VideoParams, run: ClipRun): { promptId: string | null; close: () => void } {
    const ref = { promptId: null as string | null, close: () => {} }
    ref.close = videoEngine.api.listen(this.clientId, (m) => {
      if (!ref.promptId || m.data?.prompt_id !== ref.promptId) return
      if (m.type === 'executing') {
        const stage = stageForNode(m.data.node)
        if (stage) job.stage = stage
      } else if (m.type === 'progress' && m.data.node === WF.sampler) {
        if (!run.samplingStart) {
          run.samplingStart = Date.now()
          run.firstStep = m.data.value
        }
        job.stage = 'sampling'
        job.step = m.data.value
        job.steps = m.data.max
      } else return
      job.clipProgress = Math.max(job.clipProgress, clipProgress(job.stage, job.step, job.steps))
      this.updateProgress(job, p, run)
      this.changed()
    })
    return ref
  }

  /** Poll /history until the prompt finishes; cancellation and a dead server are detected here too. */
  private async follow(job: VideoJob, promptId: string, p: VideoParams, run: ClipRun): Promise<FollowResult> {
    let failures = 0
    let cancelPolls = 0
    for (;;) {
      await sleep(1500)
      if (job.cancelRequested) {
        if (cancelPolls++ === 0) await videoEngine.api.interrupt(promptId)
        // A prompt removed from ComfyUI's queue before it started never reaches the history.
        if (cancelPolls > 4) return { cancelled: true }
      }
      try {
        const h = await videoEngine.api.history(promptId)
        failures = 0
        if (!h?.status) {
          this.updateProgress(job, p, run)
          this.changed()
          continue
        }
        if (h.status.status_str === 'success' || (h.status.completed && h.status.status_str !== 'error')) return { files: outputFiles(h) }
        const msgs = h.status.messages ?? []
        if (job.cancelRequested || msgs.some(([type]) => type === 'execution_interrupted')) return { cancelled: true }
        const err = msgs.find(([type]) => type === 'execution_error')?.[1]
        return { error: err ? `${err.node_type ?? 'ComfyUI'}: ${String(err.exception_message ?? 'failed').trim()}` : 'ComfyUI reported an error' }
      } catch (e: any) {
        if (++failures >= 15) return { lost: e }
      }
    }
  }

  private updateProgress(job: VideoJob, p: VideoParams, run: ClipRun): void {
    job.progress = Math.min(0.999, (job.clipsDone + job.clipProgress) / job.spec.count)
    const per = this.state.secondsPerCost
    const cost = clipCost(p)
    const elapsed = (Date.now() - run.t0) / 1000
    let clipLeft: number | null = null
    if (job.stage === 'sampling' && run.samplingStart && job.step > run.firstStep) {
      const perStep = (Date.now() - run.samplingStart) / 1000 / (job.step - run.firstStep)
      clipLeft = perStep * (job.steps - job.step) + perStep * 2 // VAE decode + saving ≈ a couple of steps
    } else if (per) {
      clipLeft = Math.max(0, per * cost - elapsed)
    } else if (job.etaSeconds !== null) {
      return // keep the last sampling-based estimate until a better one arrives
    }
    const clipTotal = per ? per * cost : clipLeft !== null ? clipLeft + elapsed : null
    const rest = job.spec.count - job.clipsDone - 1
    job.etaSeconds = clipLeft !== null ? clipLeft + (clipTotal ?? 0) * rest : null
  }

  /** The mp4 was copied into the video folder; don't keep a second copy in ComfyUI's output. */
  private async dropComfyCopy(f: OutputFile): Promise<void> {
    const root = videoEngine.inspection?.path
    if (!root || videoEngine.status.external || f.type !== 'output') return
    const outRoot = resolve(root, 'output')
    const path = resolve(outRoot, f.subfolder, f.filename)
    if (path.startsWith(outRoot + sep)) await fsp.rm(path, { force: true }).catch(() => {})
  }

  private fail(job: VideoJob, message: string): void {
    Object.assign(job, { status: 'failed', error: message, stage: 'failed', finishedAt: Date.now(), promptId: null, etaSeconds: null })
    this.notify(`❌ ${job.title}`, message)
    this.changed()
  }

  /** ComfyUI went away mid-job: park the job and pause the queue instead of failing it. */
  private async engineLost(job: VideoJob, e: Error): Promise<boolean> {
    try {
      await videoEngine.api.systemStats(2000)
      return false
    } catch {
      /* really gone */
    }
    Object.assign(job, { status: 'pending', promptId: null, stage: 'waiting', error: e.message })
    this.state.paused = true
    this.notify('AceDeck', 'ComfyUI stopped, video queue paused')
    this.changed()
    return true
  }

  private trimFinished(): void {
    const finished = this.state.jobs.filter((j) => j.status !== 'pending' && j.status !== 'running')
    if (finished.length > MAX_FINISHED) {
      const drop = new Set(finished.slice(0, finished.length - MAX_FINISHED).map((j) => j.id))
      this.state.jobs = this.state.jobs.filter((j) => !drop.has(j.id))
    }
  }

  private notify(title: string, body: string): void {
    if (!getSettings().notifyOnFinish || !Notification.isSupported()) return
    if (!BrowserWindow.getAllWindows().some((w) => w.isFocused())) new Notification({ title, body }).show()
  }
}

export const videoQueue = new VideoQueueManager()
