import { app, BrowserWindow, protocol, screen, shell } from 'electron'
import { createReadStream, existsSync, promises as fsp } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { loadSettings, getSettings } from './settings'
import { engine } from './engine'
import { library } from './library'
import { queue } from './queue'
import { registerIpc } from './ipc'
import { startControlServer, stopControlServer } from './control-server'
import { systemInfo } from './system'
import { emit, on, writeJson } from './util'
import { defaultInstallPath } from './installer'
import { detectInstalls } from './install-detect'
import { updateSettings } from './settings'
import { startUpdater } from './updater'
import { videoEngine } from './video/engine'
import { videoQueue } from './video/queue'
import { videoLibrary } from './video/library'

const isDev = !!process.env.VITE_DEV_SERVER_URL

protocol.registerSchemesAsPrivileged([
  { scheme: 'acedeck-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true } },
])

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
}

// The renderer origin is http://localhost (dev) or file:// (prod), so media fetches are cross-origin.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges' }

/** Serves library tracks, video clips (and picked source audio) with HTTP Range support so seeking works. */
function registerMediaProtocol(): void {
  protocol.handle('acedeck-media', async (request) => {
    const url = new URL(request.url)
    let file: string | undefined
    if (url.hostname === 'track') file = library.get(decodeURIComponent(url.pathname.slice(1)))?.file
    else if (url.hostname === 'clip') file = videoLibrary.get(decodeURIComponent(url.pathname.slice(1)))?.file
    else if (url.hostname === 'file') file = decodeURIComponent(url.pathname.slice(1))
    if (!file || !MIME[extname(file).toLowerCase()] || !existsSync(file)) return new Response('not found', { status: 404 })
    const size = (await fsp.stat(file)).size
    const type = MIME[extname(file).toLowerCase()]
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
      })
    }
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(body, { headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const icon = join(app.getAppPath(), app.isPackaged ? 'out/renderer/icon.png' : 'build/icon.png')
  // Fit the work area of the display under the cursor (portrait monitors are common).
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  const width = Math.min(1440, area.width - 24)
  const height = Math.min(920, area.height - 24)
  mainWindow = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: Math.min(940, area.width),
    minHeight: 640,
    show: false,
    backgroundColor: '#08070c',
    title: 'AceDeck',
    icon: existsSync(icon) ? icon : undefined,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0a10', symbolColor: '#c9c3de', height: 40 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (isDev) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  mainWindow.on('closed', () => (mainWindow = null))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.denishumen.acedeck')
    await loadSettings()
    await Promise.all([library.load(), queue.load(), videoLibrary.load(), videoQueue.load()])

    // First launch: adopt an existing ACE-Step checkout if we can find one.
    if (!getSettings().installPath) {
      const found = (await detectInstalls()).find((i) => i.source && i.venv)
      if (found) await updateSettings({ installPath: found.path })
    }

    // Lets the MCP server relaunch the app when Claude needs it.
    void writeJson(join(app.getPath('userData'), 'app.json'), {
      exe: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
      version: app.getVersion(),
    })

    registerMediaProtocol()
    registerIpc()
    createWindow()
    await engine.refreshInstall()
    await videoEngine.refreshInstall()
    await startControlServer()
    startUpdater()

    // Resume the queue only on the transition into "ready" (not on every status tick).
    let lastState = engine.status.state
    on('engine:status', (s) => {
      const became = s.state === 'ready' && lastState !== 'ready' && lastState !== 'busy'
      lastState = s.state
      if (became) setTimeout(() => queue.kick(), 0)
    })

    if (getSettings().autoStartEngine && engine.status.installed) void engine.start().catch(() => {})
    else void engine.probeExternal()
    queue.kick()

    let lastVideoState = videoEngine.status.state
    on('video:status', (s) => {
      const became = s.state === 'ready' && lastVideoState !== 'ready' && lastVideoState !== 'busy'
      lastVideoState = s.state
      if (became) setTimeout(() => videoQueue.kick(), 0)
    })
    videoQueue.kick()

    // Live system telemetry (GPU/VRAM) for the header and the Engine page.
    const tick = async () => {
      if (mainWindow && !mainWindow.isMinimized()) emit('system:update', await systemInfo(getSettings().installPath ?? defaultInstallPath()))
    }
    setInterval(() => void tick(), 3000)
    void tick()
  })

  let quitting = false
  app.on('before-quit', (e) => {
    if (quitting) return
    const shouldStop = getSettings().stopEngineOnExit && engine.running && !engine.status.external
    const stopVideo = getSettings().stopEngineOnExit && videoEngine.running && !videoEngine.status.external
    e.preventDefault()
    quitting = true
    void (async () => {
      await stopControlServer().catch(() => {})
      await Promise.all([shouldStop ? engine.stop().catch(() => {}) : null, stopVideo ? videoEngine.stop().catch(() => {}) : null])
      app.quit()
    })()
  })

  app.on('window-all-closed', () => app.quit())
}
