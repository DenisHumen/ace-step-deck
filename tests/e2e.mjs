// End-to-end checks against a running dev build (npm run dev) and the real ACE-Step engine.
//   node tests/e2e.mjs            → all scenarios
//   node tests/e2e.mjs cover stems → selected scenarios
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const ctl = JSON.parse(readFileSync(join(process.env.APPDATA ?? join(os.homedir(), 'AppData', 'Roaming'), 'AceDeck', 'control.json'), 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${ctl.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctl.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await res.json()
  if (!j.ok) throw new Error(`${path}: ${j.error}`)
  return j.data
}
/** Call a renderer→main IPC method through the UI bridge. */
const ipc = (method, ...args) =>
  api('POST', '/ui/eval', { js: `window.acedeck.invoke(${JSON.stringify(method)}, ...${JSON.stringify(args)}).then(r => JSON.stringify({ ok: true, r }), e => JSON.stringify({ ok: false, e: e.message }))` }).then((s) => {
    const o = JSON.parse(s)
    if (!o.ok) throw new Error(`${method}: ${o.e}`)
    return o.r
  })

async function waitJob(id, timeoutSec = 900) {
  const end = Date.now() + timeoutSec * 1000
  for (;;) {
    const j = await api('GET', `/jobs/${id}`)
    if (['done', 'failed', 'cancelled'].includes(j.status)) return j
    if (Date.now() > end) throw new Error(`job ${id} timeout (${j.stage})`)
    await sleep(2000)
  }
}

async function scenario(name, fn) {
  const t0 = Date.now()
  process.stdout.write(`▶ ${name} … `)
  try {
    const detail = await fn()
    results.push({ name, ok: true })
    console.log(`OK (${((Date.now() - t0) / 1000).toFixed(0)} s) ${detail ?? ''}`)
  } catch (e) {
    results.push({ name, ok: false })
    console.log(`FAIL (${((Date.now() - t0) / 1000).toFixed(0)} s) ${e.message}`)
  }
}

const source = async () => {
  const tracks = await api('GET', '/tracks?limit=200')
  const t = tracks.find((x) => x.title === 'Midnight Drive') ?? tracks.find((x) => x.taskType === 'text2music' && (x.durationSec ?? 0) >= 30)
  if (!t) throw new Error('no source track in library')
  return t
}
const assertTrack = (job, minCount = 1) => {
  if (job.status !== 'done') throw new Error(`status ${job.status}: ${job.error}`)
  if ((job.tracks ?? []).length < minCount) throw new Error('no tracks saved')
  for (const t of job.tracks) {
    if (!existsSync(t.file) || statSync(t.file).size < 10_000) throw new Error(`bad file ${t.file}`)
    if (!(typeof t.durationSec === 'number' && t.durationSec > 0)) throw new Error(`bad duration ${t.durationSec}`)
  }
  return job.tracks
}

const SCENARIOS = {
  async engine() {
    await scenario('engine ready', async () => {
      const s = await api('POST', '/engine/start')
      if (s.state !== 'ready' && s.state !== 'busy') throw new Error(s.state)
      return `${s.loadedModel} + ${s.loadedLm}`
    })
  },
  async ai() {
    await scenario('AI: write with AI (create_sample)', async () => {
      const r = await ipc('ai.createSample', 'melancholic piano ballad about autumn rain', false, 'en')
      if (!r.caption || !r.lyrics) throw new Error(JSON.stringify(r).slice(0, 200))
      return `bpm=${r.bpm} key=${r.key_scale} dur=${r.duration}`
    })
    await scenario('AI: enhance (format_input)', async () => {
      const r = await ipc('ai.formatInput', 'rock, guitar', '[Verse]\nwalking down the road\n[Chorus]\nwe are free', { duration: 60 })
      if (!r.caption) throw new Error(JSON.stringify(r).slice(0, 200))
      return `caption=${r.caption.slice(0, 50)}…`
    })
    await scenario('AI: surprise me (random sample)', async () => {
      const r = await ipc('ai.randomSample', 'custom_mode')
      if (!r.caption) throw new Error(JSON.stringify(r).slice(0, 200))
      return `caption=${r.caption.slice(0, 50)}…`
    })
  },
  async cover() {
    await scenario('cover of a library track', async () => {
      const src = await source()
      const job = await api('POST', '/jobs', { title: 'E2E cover', params: { task_type: 'cover', prompt: 'smooth jazz, saxophone, upright bass', src_audio_path: src.file, audio_cover_strength: 0.5, thinking: false }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id))
      return `${t.durationSec}s from ${src.title}`
    })
  },
  async repaint() {
    await scenario('repaint 10–20 s of a library track', async () => {
      const src = await source()
      const job = await api('POST', '/jobs', { title: 'E2E repaint', params: { task_type: 'repaint', prompt: src.caption, lyrics: src.lyrics, src_audio_path: src.file, repainting_start: 10, repainting_end: 20, thinking: false }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id))
      return `${t.durationSec}s`
    })
  },
  async models() {
    await scenario('download acestep-v15-base with progress', async () => {
      const before = (await ipc('models.list')).find((m) => m.name === 'acestep-v15-base')
      if (before.installed) return 'already installed'
      await ipc('models.download', 'acestep-v15-base')
      const seen = []
      for (let i = 0; i < 1800; i++) {
        const m = (await ipc('models.list')).find((x) => x.name === 'acestep-v15-base')
        if (m.downloading && m.progress !== null) seen.push(m.progress)
        if (!m.downloading && i > 2) {
          if (!m.installed) throw new Error('download finished but model not installed')
          break
        }
        await sleep(1000)
      }
      const drops = seen.filter((v, i) => i && v + 0.02 < seen[i - 1]).length
      if (seen.length && drops) throw new Error(`progress went backwards ${drops}×`)
      return `${seen.length} progress ticks, last ${(seen.at(-1) ?? 0).toFixed(2)}`
    })
  },
  async stems() {
    await scenario('stems: extract vocals (base model, on-demand load)', async () => {
      const src = await source()
      const job = await api('POST', '/jobs', { title: 'E2E extract vocals', params: { task_type: 'extract', model: 'acestep-v15-base', track_name: 'vocals', prompt: src.caption, src_audio_path: src.file, thinking: false, inference_steps: 32 }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id, 1800))
      if (!/base/.test(t.model)) throw new Error(`rendered with ${t.model}`)
      return `${t.durationSec}s, model ${t.model}`
    })
    await scenario('stems: add a guitar track (lego)', async () => {
      const src = await source()
      const job = await api('POST', '/jobs', { title: 'E2E lego guitar', params: { task_type: 'lego', model: 'acestep-v15-base', track_name: 'guitar', prompt: 'warm clean electric guitar arpeggios', src_audio_path: src.file, thinking: false, inference_steps: 32 }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id, 1800))
      return `${t.durationSec}s, ${t.model}`
    })
    await scenario('stems: complete with drums + bass', async () => {
      const src = await source()
      const job = await api('POST', '/jobs', { title: 'E2E complete drums bass', params: { task_type: 'complete', model: 'acestep-v15-base', track_classes: ['drums', 'bass'], prompt: 'punchy drums and deep bass', src_audio_path: src.file, thinking: false, inference_steps: 32 }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id, 1800))
      return `${t.durationSec}s, ${t.model}`
    })
    await scenario('per-job model switch back to turbo', async () => {
      const job = await api('POST', '/jobs', { title: 'E2E turbo after base', params: { prompt: 'chill house, warm pads', instrumental: true, audio_duration: 15, thinking: false }, count: 1, batchSize: 1 })
      const [t] = assertTrack(await waitJob(job.id))
      if (!/turbo/.test(t.model)) throw new Error(`rendered with ${t.model}`)
      return t.model
    })
  },
  async queue() {
    await scenario('queue reorder while paused', async () => {
      await api('POST', '/queue/pause')
      const mk = (title) => api('POST', '/jobs', { title, params: { prompt: 'test', instrumental: true, audio_duration: 10, thinking: false }, count: 1, batchSize: 1 })
      const a = await mk('Q-A'), b = await mk('Q-B'), c = await mk('Q-C')
      await ipc('queue.move', c.id, 'top')
      await ipc('queue.move', a.id, 'down')
      const order = (await api('GET', '/jobs')).jobs.filter((j) => j.status === 'pending').map((j) => j.title)
      for (const j of [a, b, c]) await api('POST', `/jobs/${j.id}/cancel`)
      await ipc('queue.clearFinished')
      await api('POST', '/queue/resume')
      if (order.join() !== 'Q-C,Q-B,Q-A') throw new Error(order.join())
      return order.join(' → ')
    })
  },
}

const only = process.argv.slice(2)
for (const [name, fn] of Object.entries(SCENARIOS)) if (!only.length || only.includes(name) || name === 'engine') await fn()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
