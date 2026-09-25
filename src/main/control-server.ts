// Local automation API (127.0.0.1 only, bearer token) used by the MCP server and scripts.
import { app, BrowserWindow, screen } from 'electron'
import http from 'node:http'
import { join } from 'node:path'
import { promises as fsp } from 'node:fs'
import type { JobSpec, PageId } from '@shared/types'
import { engine } from './engine'
import { queue } from './queue'
import { library } from './library'
import { diagnostics } from './diagnostics'
import { listModels, downloadModel } from './models'
import { getSettings } from './settings'
import { gpuInfo } from './system'
import { emit, uid, writeJson } from './util'

export const controlFile = () => join(app.getPath('userData'), 'control.json')
let server: http.Server | null = null
let token = ''

type Handler = (req: { body: any; params: Record<string, string>; query: URLSearchParams }) => Promise<unknown> | unknown

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = []
function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = []
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$')
  routes.push({ method, pattern, keys, handler })
}

const devTools = () => !app.isPackaged || process.env.ACEDECK_AUTOMATION === '1'

route('GET', '/status', async () => {
  const q = queue.state
  return {
    app: { version: app.getVersion(), name: 'AceDeck' },
    engine: engine.status,
    queue: {
      paused: q.paused,
      pending: q.jobs.filter((j) => j.status === 'pending').length,
      running: q.jobs.find((j) => j.status === 'running') ?? null,
      done: q.jobs.filter((j) => j.status === 'done').length,
      failed: q.jobs.filter((j) => j.status === 'failed').length,
    },
    library: { tracks: library.list().length, outputDir: getSettings().outputDir },
    gpu: (await gpuInfo())[0] ?? null,
  }
})
route('POST', '/engine/start', async () => (await engine.start(), engine.status))
route('POST', '/engine/stop', async () => (await engine.stop(), engine.status))
route('POST', '/engine/restart', async () => (await engine.restart(), engine.status))
route('GET', '/engine/logs', ({ query }) => engine.getLogs().slice(-Number(query.get('limit') ?? 200)))

route('GET', '/jobs', () => queue.state)
route('POST', '/jobs', ({ body }) => {
  const spec = body as JobSpec
  if (!spec?.params) throw new Error('body.params is required')
  return queue.add({ ...spec, source: spec.source ?? 'claude' })
})
route('GET', '/jobs/:id', ({ params }) => {
  const j = queue.get(params.id)
  if (!j) throw new Error('job not found')
  return { ...j, tracks: j.trackIds.map((id) => library.get(id)).filter(Boolean) }
})
route('POST', '/jobs/:id/cancel', ({ params }) => (queue.cancel(params.id), queue.get(params.id)))
route('POST', '/jobs/:id/retry', ({ params }) => (queue.retry(params.id), queue.get(params.id)))
route('POST', '/queue/pause', () => (queue.setPaused(true), queue.state))
route('POST', '/queue/resume', () => (queue.setPaused(false), queue.state))
route('POST', '/queue/clear', () => (queue.clearFinished(), queue.state))

route('GET', '/tracks', ({ query }) => {
  const q = (query.get('q') ?? '').toLowerCase()
  const fav = query.get('favorite') === 'true'
  const limit = Number(query.get('limit') ?? 50)
  return library
    .list()
    .filter((t) => (!fav || t.favorite) && (!q || `${t.title} ${t.caption} ${t.lyrics}`.toLowerCase().includes(q)))
    .slice(0, limit)
})
route('GET', '/tracks/:id', ({ params }) => {
  const t = library.get(params.id)
  if (!t) throw new Error('track not found')
  return t
})

route('GET', '/diagnostics', () => diagnostics.state)
route('POST', '/diagnostics/run', ({ body }) => {
  void diagnostics.run(body?.mode === 'full' ? 'full' : 'quick')
  return { started: true }
})

route('GET', '/models', () => listModels())
route('POST', '/models/:name/download', ({ params }) => {
  void downloadModel(params.name).catch((e) => engine.log(`[models] ${e.message}`, 'err'))
  return { started: true }
})

route('POST', '/ai/sample', async ({ body }) => {
  if (!engine.ready) throw new Error('Engine is not running')
  return engine.api.createSample(String(body?.query ?? ''), !!body?.instrumental, String(body?.language ?? 'unknown'))
})

// Automation helpers for tests and README screenshots (dev builds / ACEDECK_AUTOMATION=1 only).
route('POST', '/ui/navigate', ({ body }) => {
  if (!devTools()) throw new Error('disabled')
  emit('ui:navigate', body.page as PageId)
  return { ok: true }
})
route('POST', '/ui/eval', async ({ body }) => {
  if (!devTools()) throw new Error('disabled')
  const win = BrowserWindow.getAllWindows()[0]
  return win.webContents.executeJavaScript(String(body.js), true)
})
route('POST', '/ui/window', ({ body }) => {
  if (!devTools()) throw new Error('disabled')
  const win = BrowserWindow.getAllWindows()[0]
  if (body.width && body.height) {
    win.setMinimumSize(400, 300)
    win.setBounds({ x: body.x ?? win.getBounds().x, y: body.y ?? win.getBounds().y, width: body.width, height: body.height })
  }
  return { bounds: win.getBounds(), displays: screen.getAllDisplays().map((d) => ({ bounds: d.bounds, workArea: d.workArea, scale: d.scaleFactor })) }
})
// Render a local HTML file to PNG in a hidden window (README banner / social preview).
route('POST', '/ui/render', async ({ body }) => {
  if (!devTools()) throw new Error('disabled')
  const w = new BrowserWindow({ show: false, width: 800, height: 600, frame: false, enableLargerThanScreen: true, webPreferences: { offscreen: true } })
  // Windows clamps new windows to the display width; resizing afterwards is allowed.
  w.setMinimumSize(100, 100)
  w.setContentSize(body.width, body.height)
  w.webContents.setFrameRate(30)
  try {
    await w.loadFile(String(body.file), body.hash ? { hash: String(body.hash) } : undefined)
    await new Promise((r) => setTimeout(r, body.delay ?? 1200))
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: body.width, height: body.height })
    await fsp.writeFile(String(body.out), img.toPNG())
    return { ok: true, size: img.getSize() }
  } finally {
    w.destroy()
  }
})
route('POST', '/ui/screenshot', async ({ body }) => {
  if (!devTools()) throw new Error('disabled')
  const win = BrowserWindow.getAllWindows()[0]
  const img = await win.webContents.capturePage()
  await fsp.writeFile(String(body.path), img.toPNG())
  return { ok: true, size: img.getSize() }
})

function send(res: http.ServerResponse, code: number, data: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

export async function startControlServer(): Promise<void> {
  const s = getSettings()
  if (!s.controlApiEnabled || server) return
  token = uid(16)
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-acedeck-token']
    if (auth !== token) return send(res, 401, { error: 'unauthorized' })
    const r = routes.find((x) => x.method === req.method && x.pattern.test(url.pathname))
    if (!r) return send(res, 404, { error: 'not found' })
    const m = r.pattern.exec(url.pathname)!
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]))
    let raw = ''
    for await (const chunk of req) raw += chunk
    try {
      const body = raw ? JSON.parse(raw) : {}
      send(res, 200, { ok: true, data: await r.handler({ body, params, query: url.searchParams }) })
    } catch (e: any) {
      send(res, 400, { ok: false, error: e?.message ?? String(e) })
    }
  })
  await new Promise<void>((resolve) => {
    server!.once('error', (e) => {
      engine.log(`[control] could not listen on ${s.controlApiPort}: ${e.message}`, 'err')
      server = null
      resolve()
    })
    server!.listen(s.controlApiPort, '127.0.0.1', () => resolve())
  })
  if (server) {
    await writeJson(controlFile(), { port: s.controlApiPort, token, pid: process.pid, version: app.getVersion(), exe: process.execPath })
    engine.log(`[control] automation API on http://127.0.0.1:${s.controlApiPort}`)
  }
}

export async function stopControlServer(): Promise<void> {
  if (!server) return
  await new Promise<void>((r) => server!.close(() => r()))
  server = null
  await fsp.rm(controlFile(), { force: true })
}
