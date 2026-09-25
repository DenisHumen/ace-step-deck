// Regenerates the README screenshots from a running dev build (npm run dev).
//   node scripts/screenshots.mjs            → en + ru
//   node scripts/screenshots.mjs en queue   → one language / one shot
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ctlFile = join(process.env.APPDATA ?? join(os.homedir(), 'AppData', 'Roaming'), 'AceDeck', 'control.json')
const { port, token } = JSON.parse(readFileSync(ctlFile, 'utf8'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await res.json()
  if (!j.ok) throw new Error(`${path}: ${j.error}`)
  return j.data
}
const js = (code) => api('POST', '/ui/eval', { js: code })
const nav = async (page) => {
  await api('POST', '/ui/navigate', { page })
  await sleep(900)
}
const scrollTop = (y) => js(`document.querySelector('.scroll-y.relative').scrollTop = ${y}; 1`)
const shot = async (lang, name) => {
  const dir = join(root, 'docs', 'screenshots', lang)
  mkdirSync(dir, { recursive: true })
  await sleep(400)
  await api('POST', '/ui/screenshot', { path: join(dir, `${name}.png`) })
  console.log(`  ✓ ${lang}/${name}.png`)
}
const store = (expr) => js(`(async () => { const S = window.__acedeck_store; ${expr} })()`)

const customForm = {
  en: {
    prompt: 'synthwave, retro 80s, driving bassline, gated drums, analog synths, female vocal, nostalgic',
    lyrics: "[Verse]\nCity lights are fading slow\nChasing echoes on the road\nEvery signal turning gold\nIn the static of the night\n\n[Chorus]\nMidnight drive, we're alive\nNeon skies in your eyes\nHold on tight, one more time\nWe're the sound of the night",
    vocal_language: 'en',
  },
  ru: {
    prompt: 'russian indie pop, acoustic guitar, warm female vocal, summer, dreamy',
    lyrics: '[Verse]\nЛетний вечер, тёплый ветер\nМы идём с тобой к реке\nФонари горят как свечи\nОтражаясь в тишине\n\n[Chorus]\nЭто лето навсегда\nГорит закат в твоей руке\nЭто лето навсегда\nМы плывём в его тепле',
    vocal_language: 'ru',
  },
}

const SHOTS = {
  async create(lang) {
    await js(`localStorage.setItem('acedeck.create.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('acedeck.create.v1') || '{}'), mode: 'simple', simple: '', count: 1, batch: 1 })); 1`)
    await nav('library')
    await nav('create')
    await shot(lang, 'create')
  },
  async custom(lang) {
    const f = customForm[lang]
    await js(`(() => { const f = JSON.parse(localStorage.getItem('acedeck.create.v1') || '{}'); f.mode = 'custom'; f.count = 3; f.batch = 1; f.p = Object.assign(f.p || {}, ${JSON.stringify({ ...f, instrumental: false, bpm: 108, key_scale: 'A minor', time_signature: '4', audio_duration: 150, thinking: true })}); localStorage.setItem('acedeck.create.v1', JSON.stringify(f)); return 1 })()`)
    await nav('library')
    await nav('create')
    await scrollTop(430)
    await shot(lang, 'create-custom')
    await scrollTop(0)
  },
  async queue(lang) {
    const title = lang === 'ru' ? 'Звёздный путь' : 'Starlight Highway'
    const job = await api('POST', '/jobs', {
      title,
      params: { prompt: 'epic synth-pop anthem, soaring female vocal, big drums, bright synth leads', instrumental: false, lyrics: '[Verse]\nWe run beneath the silver sky\n\n[Chorus]\nStarlight highway, take me home', vocal_language: 'en', audio_duration: 60, thinking: true },
      count: 3,
      batchSize: 1,
      source: 'ui',
    })
    await api('POST', '/jobs', { title: lang === 'ru' ? 'Утренний кофе' : 'Morning Coffee', params: { prompt: 'lo-fi jazz hop, rhodes piano, soft rain', instrumental: true, audio_duration: 45, thinking: false }, count: 2, batchSize: 1, source: 'claude' })
    await nav('queue')
    for (let i = 0; i < 90; i++) {
      const j = await api('GET', `/jobs/${job.id}`)
      if (j.status === 'running' && j.runProgress > 0.55 && j.songsDone >= 1) break
      await sleep(1000)
    }
    await shot(lang, 'queue')
  },
  async library(lang) {
    await store(`const t = S.getState().tracks.find((x) => x.title === 'Midnight Drive') || S.getState().tracks[0]; S.getState().play(t.id, S.getState().tracks.map((x) => x.id)); return 1`)
    await nav('library')
    await sleep(2500)
    await shot(lang, 'library')
  },
  async track(lang) {
    await nav('library')
    await js(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Midnight Drive' || x.textContent === 'Летний вечер'); b && b.click(); return !!b })()`)
    await sleep(900)
    await shot(lang, 'track')
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); [...document.querySelectorAll('.fixed.inset-0')].forEach((e) => e.click()); 1`)
  },
  async engine(lang) {
    await nav('engine')
    await sleep(1500)
    await shot(lang, 'engine')
  },
  async diagnostics(lang) {
    const d = await api('GET', '/diagnostics')
    if (!d.finishedAt) {
      await api('POST', '/diagnostics/run', { mode: 'full' })
      for (let i = 0; i < 300; i++) {
        if (!(await api('GET', '/diagnostics')).running) break
        await sleep(1000)
      }
    }
    await nav('diagnostics')
    await shot(lang, 'diagnostics')
  },
  async models(lang) {
    await nav('models')
    await shot(lang, 'models')
  },
  async setup(lang) {
    await nav('setup')
    await sleep(800)
    await shot(lang, 'setup')
  },
  async claude(lang) {
    await nav('claude')
    await shot(lang, 'claude')
  },
  async settings(lang) {
    await nav('settings')
    await shot(lang, 'settings')
  },
}

const [langArg, onlyArg] = process.argv.slice(2)
const langs = langArg ? [langArg] : ['en', 'ru']
await api('POST', '/ui/window', { x: 0, y: 160, width: 1440, height: 900 })
for (const lang of langs) {
  console.log(`[${lang}]`)
  await js(`window.acedeck.invoke('settings.set', { language: '${lang}' }).then(() => 1)`)
  await sleep(500)
  for (const [name, fn] of Object.entries(SHOTS)) {
    if (onlyArg && onlyArg !== name) continue
    await fn(lang)
  }
}
