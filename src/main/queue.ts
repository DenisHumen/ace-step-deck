import { app, BrowserWindow, Notification } from 'electron'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import type { GenerationParams, Job, JobSpec, QueueState, Track } from '@shared/types'
import { DEFAULT_PARAMS } from '@shared/constants'
import { jobTitle, slugify, smoothProgress } from '@shared/logic'
import { engine } from './engine'
import { library } from './library'
import { getSettings } from './settings'
import { emit, readJson, sleep, throttle, uid, writeJson } from './util'

const queueFile = () => join(app.getPath('userData'), 'queue.json')
const MAX_FINISHED = 200

/** Merge user params with defaults + engine settings into a `/release_task` body. */
export function buildRequest(p: Partial<GenerationParams>, songs: number, runIndex: number): Partial<GenerationParams> {
  const s = getSettings()
  const insp = engine.inspection
  const merged: Partial<GenerationParams> = { ...DEFAULT_PARAMS, ...p }
  merged.batch_size = songs
  merged.model = p.model || s.ditModel
  merged.lm_model_path = p.lm_model_path || s.lmModel
  merged.lm_backend = s.lmBackend === 'auto' ? (insp?.hasTriton ? 'vllm' : 'pt') : s.lmBackend
  if (merged.use_random_seed === false && typeof merged.seed === 'number' && merged.seed >= 0) {
    merged.seed = merged.seed + runIndex // distinct but reproducible songs across runs
  }
  if (!merged.audio_duration || merged.audio_duration <= 0) delete merged.audio_duration
  if (!merged.bpm) delete merged.bpm
  if (merged.instrumental && !merged.lyrics?.trim()) merged.lyrics = '[Instrumental]'
  if (merged.sample_query?.trim()) merged.sample_mode = true
  if (!merged.src_audio_path) delete merged.src_audio_path
  if (!merged.reference_audio_path) delete merged.reference_audio_path
  if (merged.lm_top_k === null) delete merged.lm_top_k
  if (merged.repainting_end === null) merged.repainting_end = -1
  return merged
}

class QueueManager {
  state: QueueState = { jobs: [], paused: false, activeJobId: null, avgRunSeconds: null }
  private working = false
  private push = throttle(() => emit('queue:update', this.state), 200)
  private persist = throttle(() => void writeJson(queueFile(), this.state), 1000)

  async load(): Promise<void> {
    const saved = await readJson<QueueState>(queueFile(), this.state)
    for (const j of saved.jobs) {
      if (j.status === 'running') {
        j.status = 'pending'
        j.stage = 'Resumed after restart'
        j.taskId = null
      }
    }
    this.state = { ...saved, activeJobId: null }
  }

  private changed(): void {
    this.push()
    this.persist()
  }

  get(id: string): Job | undefined {
    return this.state.jobs.find((j) => j.id === id)
  }

  add(spec: JobSpec): Job {
    const count = Math.max(1, Math.min(100, Math.floor(spec.count || 1)))
    const batchSize = Math.max(1, Math.min(8, Math.floor(spec.batchSize || 1), count))
    const clean: JobSpec = { ...spec, count, batchSize }
    const job: Job = {
      id: uid(6),
      title: jobTitle(clean),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      status: 'pending',
      spec: clean,
      runsTotal: Math.ceil(count / batchSize),
      runsDone: 0,
      songsDone: 0,
      progress: 0,
      runProgress: 0,
      stage: 'Queued',
      progressText: '',
      taskId: null,
      trackIds: [],
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
      j.status = 'cancelled'
      j.stage = 'Cancelled'
      j.finishedAt = Date.now()
    } else if (j.status === 'running') {
      j.cancelRequested = true
      j.stage = 'Cancelling…'
    }
    this.changed()
  }

  remove(id: string): void {
    const j = this.get(id)
    if (!j || j.status === 'running') return
    this.state.jobs = this.state.jobs.filter((x) => x.id !== id)
    this.changed()
  }

  move(id: string, dir: 'up' | 'down' | 'top'): void {
    const jobs = this.state.jobs
    const i = jobs.findIndex((j) => j.id === id)
    if (i < 0 || jobs[i].status !== 'pending') return
    const [job] = jobs.splice(i, 1)
    if (dir === 'top') {
      const firstPending = jobs.findIndex((j) => j.status === 'pending')
      jobs.splice(firstPending < 0 ? jobs.length : firstPending, 0, job)
    } else {
      // Only swap with neighbouring pending jobs.
      let k = i + (dir === 'up' ? -1 : 1)
      while (k >= 0 && k < jobs.length && jobs[k]?.status !== 'pending') k += dir === 'up' ? -1 : 1
      jobs.splice(Math.max(0, Math.min(jobs.length, k)), 0, job)
    }
    this.changed()
  }

  retry(id: string): void {
    const j = this.get(id)
    if (!j || (j.status !== 'failed' && j.status !== 'cancelled')) return
    Object.assign(j, { status: 'pending', error: null, stage: 'Queued', cancelRequested: false, finishedAt: null, taskId: null, runProgress: 0 })
    this.changed()
    this.kick()
  }

  duplicate(id: string): Job | undefined {
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

  /** Wake the worker; it exits on its own when there is nothing to do. */
  kick(): void {
    if (!this.working) void this.work()
  }

  private async work(): Promise<void> {
    // Nothing to do → return before touching engine state. (An early return inside try/finally
    // runs `finally` synchronously; emitting from there re-entered kick() via engine:status.)
    if (this.state.paused || !this.state.jobs.some((j) => j.status === 'pending')) return
    this.working = true
    let ranJob = false
    try {
      for (;;) {
        if (this.state.paused) return
        const job = this.state.jobs.find((j) => j.status === 'pending')
        if (!job) return
        if (!engine.ready) {
          if (engine.status.installed && (engine.status.state === 'stopped' || engine.status.state === 'error')) {
            job.stage = 'Starting engine…'
            this.changed()
            await engine.start().catch(() => {})
          }
          if (!(await engine.waitReady(10 * 60 * 1000))) {
            job.stage = 'Waiting for the engine'
            this.changed()
            return // resumed by engine:status → ready
          }
        }
        ranJob = true
        await this.runJob(job)
      }
    } finally {
      this.state.activeJobId = null
      if (ranJob) engine.setBusy(false)
      this.working = false
      this.changed()
    }
  }

  private async runJob(job: Job): Promise<void> {
    this.state.activeJobId = job.id
    job.status = 'running'
    job.startedAt ??= Date.now()
    job.error = null
    engine.setBusy(true)
    this.changed()

    const outDir = getSettings().outputDir
    await fsp.mkdir(outDir, { recursive: true })

    while (job.songsDone < job.spec.count) {
      if (job.cancelRequested) break
      const songs = Math.min(job.spec.batchSize, job.spec.count - job.songsDone)
      const runIndex = job.runsDone
      let body = buildRequest(job.spec.params, songs, runIndex)
      const t0 = Date.now()
      job.runProgress = 0
      job.stage = 'Submitting'
      job.progressText = ''
      this.changed()

      // Progress window of the engine pass inside this run (the compose step takes the first 30%).
      let base = 0
      let scale = 1
      let taskId: string
      try {
        if (body.sample_mode && body.sample_query?.trim()) {
          body = await this.composeFirst(job, body)
          base = 0.3
          scale = 0.7
          if (job.cancelRequested) break
        }
        taskId = await engine.api.releaseTask(body)
      } catch (e: any) {
        if (await this.engineLost(job, e)) return
        // The engine is alive but rejected the request (validation error etc.).
        job.status = 'failed'
        job.error = e.message
        job.stage = 'Failed'
        job.finishedAt = Date.now()
        this.notify(`❌ ${job.title}`, e.message)
        this.changed()
        return
      }
      job.taskId = taskId

      // Poll until the engine finishes this pass.
      let failures = 0
      let entries: import('./acestep-api').ResultEntry[] = []
      let lastApi = -1
      let lastChange = Date.now()
      for (;;) {
        if (job.cancelRequested) break
        await sleep(1000)
        try {
          const r = await engine.api.query(taskId)
          failures = 0
          const first = r.entries[0] ?? {}
          if (r.item.status === 0) {
            const elapsed = (Date.now() - t0) / 1000
            const apiP = typeof first.progress === 'number' ? first.progress : 0
            if (apiP !== lastApi) {
              lastApi = apiP
              lastChange = Date.now()
            }
            job.runProgress = Math.max(job.runProgress, base + scale * smoothProgress(apiP, (Date.now() - lastChange) / 1000))
            job.stage = first.stage || (job.runProgress > 0 ? 'Generating' : 'Queued on engine')
            job.progressText = (r.item.progress_text ?? '').slice(0, 200)
            this.updateProgress(job, songs, elapsed)
            this.changed()
            continue
          }
          if (r.item.status === 2) {
            const msg = first.error || r.item.progress_text || 'Generation failed'
            job.status = 'failed'
            job.error = String(msg)
            job.stage = 'Failed'
            job.finishedAt = Date.now()
            this.notify(`❌ ${job.title}`, job.error)
            this.changed()
            return
          }
          entries = r.entries
          break
        } catch (e: any) {
          if (++failures >= 20) {
            if (await this.engineLost(job, e)) return
            failures = 0
          }
        }
      }
      if (job.cancelRequested) break

      // Download the rendered audio into the library.
      job.stage = 'Saving'
      this.changed()
      const files = entries.filter((e) => e.file)
      let k = 0
      for (const e of files) {
        k++
        const n = job.songsDone + k
        const fmt = body.audio_format ?? 'mp3'
        const d = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
        const dest = join(outDir, `${stamp}_${slugify(job.title)}${job.spec.count > 1 ? `_${n}` : ''}.${fmt}`)
        try {
          await engine.api.downloadAudio(e.file!, dest)
        } catch (err: any) {
          engine.log(`Failed to save ${e.file}: ${err.message}`, 'err')
          continue
        }
        const size = (await fsp.stat(dest)).size
        const seeds = String(e.seed_value ?? '').split(',')
        const track: Track = {
          id: uid(6),
          jobId: job.id,
          title: job.spec.count > 1 ? `${job.title.length > 34 ? `${job.title.slice(0, 33).trimEnd()}…` : job.title} #${n}` : job.title,
          file: dest,
          format: fmt,
          sizeBytes: size,
          durationSec: e.metas?.duration ?? body.audio_duration ?? null,
          createdAt: Date.now(),
          caption: e.prompt || body.prompt || '',
          lyrics: e.lyrics || body.lyrics || '',
          bpm: e.metas?.bpm ?? null,
          keyscale: e.metas?.keyscale ?? '',
          timesignature: e.metas?.timesignature ?? '',
          genres: e.metas?.genres && e.metas.genres !== 'N/A' ? e.metas.genres : '',
          language: body.vocal_language ?? '',
          seed: seeds[k - 1] ?? seeds[0] ?? '',
          model: e.dit_model ?? body.model ?? '',
          lmModel: body.thinking ? (e.lm_model ?? body.lm_model_path ?? '') : '',
          taskType: body.task_type ?? 'text2music',
          favorite: false,
          params: job.spec.params,
        }
        await library.add(track)
        job.trackIds.push(track.id)
      }

      const secs = (Date.now() - t0) / 1000
      const perSong = secs / Math.max(1, songs)
      this.state.avgRunSeconds = this.state.avgRunSeconds ? this.state.avgRunSeconds * 0.6 + perSong * 0.4 : perSong
      job.songsDone += songs
      job.runsDone += 1
      job.runProgress = 1
      this.updateProgress(job, 0, 0)
      this.changed()
    }

    job.finishedAt = Date.now()
    job.taskId = null
    if (job.cancelRequested) {
      job.status = 'cancelled'
      job.stage = 'Cancelled'
    } else {
      job.status = 'done'
      job.stage = 'Done'
      job.progress = 1
      this.notify(`🎵 ${job.title}`, `${job.trackIds.length} track(s) ready`)
    }
    this.trimFinished()
    this.changed()
  }

  /**
   * Simple mode, step 1: let the LM write caption + lyrics + metas via /v1/create_sample.
   * ACE-Step's own sample_mode would overwrite the user's duration/BPM/key and ignore the
   * instrumental switch, so AceDeck composes first and then renders with the user's choices.
   */
  private async composeFirst(job: Job, body: Partial<GenerationParams>): Promise<Partial<GenerationParams>> {
    job.stage = 'Phase 1: composing'
    this.changed()
    const t0 = Date.now()
    const tick = setInterval(() => {
      // The LM usually needs 15–40 s here; ease towards 28% of the run.
      job.runProgress = 0.28 * (1 - Math.exp(-(Date.now() - t0) / 1000 / 14))
      this.changed()
    }, 1000)
    try {
      const lang = body.vocal_language && body.vocal_language !== 'unknown' ? body.vocal_language : 'unknown'
      const s = await engine.api.createSample(body.sample_query!.trim(), !!body.instrumental, lang)
      const out: Partial<GenerationParams> = {
        ...body,
        sample_mode: false,
        sample_query: '',
        prompt: s.caption || body.sample_query!,
        lyrics: body.instrumental ? '[Instrumental]' : s.lyrics || '',
        bpm: body.bpm ?? s.bpm ?? undefined,
        key_scale: body.key_scale || s.key_scale || '',
        time_signature: body.time_signature || s.time_signature || '',
        audio_duration: body.audio_duration ?? s.duration ?? undefined,
        vocal_language: lang !== 'unknown' ? lang : s.vocal_language || 'unknown',
      }
      if (!out.bpm) delete out.bpm
      if (!out.audio_duration) delete out.audio_duration
      job.runProgress = 0.3
      job.progressText = (s.caption ?? '').slice(0, 200)
      return out
    } finally {
      clearInterval(tick)
    }
  }

  private updateProgress(job: Job, songsInFlight: number, elapsed: number): void {
    const done = job.songsDone + songsInFlight * job.runProgress
    job.progress = Math.min(0.999, done / job.spec.count)
    const avg = this.state.avgRunSeconds
    if (avg) {
      const remainingSongs = job.spec.count - job.songsDone
      job.etaSeconds = Math.max(0, remainingSongs * avg - (songsInFlight ? elapsed : 0))
    }
  }

  /** Connectivity lost mid-job: park the job and pause the queue instead of failing it. */
  private async engineLost(job: Job, e: Error): Promise<boolean> {
    if (engine.ready) {
      try {
        await engine.api.health(2000)
        return false // transient, keep going
      } catch {
        /* really gone */
      }
    }
    job.status = 'pending'
    job.taskId = null
    job.stage = 'Engine stopped — queue paused'
    job.error = e.message
    this.state.paused = true
    this.notify('AceDeck', 'Engine stopped, queue paused')
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
    const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    if (!focused) new Notification({ title, body }).show()
  }
}

export const queue = new QueueManager()
