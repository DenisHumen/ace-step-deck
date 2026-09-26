import { app, net, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, promises as fsp } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { autoUpdater, type UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { PROJECT_URL } from '@shared/constants'
import { compareVersions } from '@shared/logic'
import { engine } from './engine'
import { getSettings, updateSettings } from './settings'
import { emit } from './util'

const REPO = 'DenisHumen/ace-step-deck'
const RELEASES = `${PROJECT_URL}/releases/latest`
/** Test hooks: a generic feed for the installer flow, a fake GitHub API for the portable flow. */
const FEED = process.env.ACEDECK_UPDATE_FEED
const RELEASE_API = process.env.ACEDECK_UPDATE_API ?? `https://api.github.com/repos/${REPO}/releases/latest`
const PORTABLE_EXE = process.env.PORTABLE_EXECUTABLE_FILE
const CHECK_EVERY = 6 * 60 * 60 * 1000

const mode: UpdateStatus['mode'] = PORTABLE_EXE ? 'portable' : app.isPackaged || FEED ? 'installer' : 'manual'

let status: UpdateStatus = {
  state: 'idle',
  mode,
  current: app.getVersion(),
  latest: null,
  notes: null,
  releaseUrl: RELEASES,
  percent: 0,
  bytesPerSecond: 0,
  total: 0,
  error: null,
  checkedAt: null,
}
let portableAsset: { url: string; name: string; size: number } | null = null
let portableFile: string | null = null

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  emit('update:status', status)
}

export const updateStatus = (): UpdateStatus => status

/** GitHub release notes arrive as HTML (electron-updater) or Markdown (API); the UI shows a short plain-text excerpt. */
function plainNotes(notes: UpdateInfo['releaseNotes'] | string | null | undefined): string | null {
  const raw = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : (notes ?? '')
  const text = raw
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/^#+\s*/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 1200) : null
}

// ── Installer build: electron-updater against GitHub Releases (latest.yml) ──────────────────────
if (mode === 'installer') {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  if (FEED) {
    autoUpdater.setFeedURL({ provider: 'generic', url: FEED })
    if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
  }
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', latest: info.version, notes: plainNotes(info.releaseNotes), checkedAt: Date.now() }))
  autoUpdater.on('update-not-available', (info) => set({ state: 'none', latest: info.version, notes: null, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: p.percent / 100, bytesPerSecond: p.bytesPerSecond, total: p.total }))
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', percent: 1, latest: info.version }))
  autoUpdater.on('error', (e) => set({ state: 'error', error: e?.message ?? String(e) }))
}

async function checkGithub(): Promise<void> {
  const res = await net.fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': `AceDeck/${status.current}` } })
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`)
  const r = (await res.json()) as { tag_name: string; body?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size: number }[] }
  const latest = r.tag_name.replace(/^v/, '')
  const asset = r.assets?.find((a) => /portable.*\.exe$/i.test(a.name))
  portableAsset = asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size } : null
  const newer = compareVersions(latest, status.current) > 0
  set({ state: newer ? 'available' : 'none', latest, notes: newer ? plainNotes(r.body) : null, releaseUrl: r.html_url ?? RELEASES, checkedAt: Date.now() })
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'checking' || status.state === 'downloading') return status
  try {
    if (mode === 'installer') {
      set({ state: 'checking', error: null })
      const r = await autoUpdater.checkForUpdates()
      if (!r) set({ state: 'idle' })
    } else {
      set({ state: 'checking', error: null })
      await checkGithub()
    }
  } catch (e: any) {
    set({ state: 'error', error: e?.message ?? String(e) })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (status.state !== 'available' && status.state !== 'error') return status
  if (mode === 'manual') {
    void shell.openExternal(status.releaseUrl)
    return status
  }
  set({ state: 'downloading', percent: 0, error: null })
  try {
    if (mode === 'installer') {
      await autoUpdater.downloadUpdate()
    } else {
      if (!portableAsset) throw new Error('This release has no portable build')
      const dest = join(dirname(PORTABLE_EXE!), portableAsset.name)
      const part = `${dest}.part`
      const res = await net.fetch(portableAsset.url)
      if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || portableAsset.size
      let got = 0
      let last = Date.now()
      let lastBytes = 0
      const body = Readable.fromWeb(res.body as any)
      body.on('data', (chunk: Buffer) => {
        got += chunk.length
        const now = Date.now()
        if (now - last > 250) {
          set({ percent: total ? got / total : 0, total, bytesPerSecond: ((got - lastBytes) * 1000) / (now - last) })
          last = now
          lastBytes = got
        }
      })
      await pipeline(body, createWriteStream(part))
      if (total && got !== total) throw new Error('Download incomplete')
      await fsp.rm(dest, { force: true })
      await fsp.rename(part, dest)
      portableFile = dest
      set({ state: 'ready', percent: 1 })
    }
  } catch (e: any) {
    set({ state: 'error', error: e?.message ?? String(e) })
  }
  return status
}

/** Restarts into the new version (stopping the engine first so nothing is left holding the GPU). */
export async function installUpdate(): Promise<void> {
  if (status.state !== 'ready') throw new Error('The update has not been downloaded yet')
  if (getSettings().stopEngineOnExit && engine.running && !engine.status.external) await engine.stop().catch(() => {})
  if (mode === 'installer') {
    // Silent per-user install, then relaunch.
    setImmediate(() => autoUpdater.quitAndInstall(true, true))
    return
  }
  if (!portableFile || !existsSync(portableFile)) throw new Error('The downloaded file is missing')
  // The new portable build moves the old one to the Recycle Bin once this process has exited.
  spawn(portableFile, [], { detached: true, stdio: 'ignore', env: { ...process.env, ACEDECK_REPLACED: PORTABLE_EXE } }).unref()
  setTimeout(() => app.quit(), 300)
}

export const openReleasePage = () => shell.openExternal(status.releaseUrl)

/** A portable build started by the updater cleans up the version it replaced and repoints the desktop shortcut. */
async function finishPortableSwap(): Promise<void> {
  const old = process.env.ACEDECK_REPLACED
  if (!PORTABLE_EXE || !old || old === PORTABLE_EXE) return
  if (dirname(old) !== dirname(PORTABLE_EXE) || !/^AceDeck-Portable-.*\.exe$/i.test(basename(old))) return
  delete process.env.ACEDECK_REPLACED
  for (let i = 0; i < 12 && existsSync(old); i++) {
    await new Promise((r) => setTimeout(r, 5000))
    await shell.trashItem(old).catch(() => {})
  }
}

// ── Desktop shortcut ─────────────────────────────────────────────────────────────────────────────
const shortcutPath = () => join(app.getPath('desktop'), 'AceDeck.lnk')
const launchTarget = () => PORTABLE_EXE ?? process.execPath

export function createDesktopShortcut(): string {
  if (!app.isPackaged) throw new Error('Shortcuts are created by the installed or portable build')
  const file = shortcutPath()
  const ok = shell.writeShortcutLink(file, existsSync(file) ? 'replace' : 'create', {
    target: launchTarget(),
    cwd: dirname(launchTarget()),
    icon: launchTarget(),
    iconIndex: 0,
    appUserModelId: 'io.github.denishumen.acedeck',
    description: 'AceDeck — ACE-Step 1.5 music studio',
  })
  if (!ok) throw new Error('Windows refused to create the shortcut')
  return file
}

/** First launch: make sure there is a desktop icon (the portable build has no installer to make one). */
async function ensureDesktopShortcut(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'win32') return
  const file = shortcutPath()
  if (!getSettings().desktopShortcutDone) {
    if (!existsSync(file)) {
      try {
        createDesktopShortcut()
      } catch {
        return
      }
    }
    await updateSettings({ desktopShortcutDone: true })
    return
  }
  // Keep an existing shortcut pointing at the current portable exe after an update.
  if (PORTABLE_EXE && existsSync(file)) {
    try {
      const target = shell.readShortcutLink(file).target
      if (target !== PORTABLE_EXE && /AceDeck-Portable-.*\.exe$/i.test(target)) createDesktopShortcut()
    } catch {
      /* not ours */
    }
  }
}

export function startUpdater(): void {
  void ensureDesktopShortcut()
  void finishPortableSwap()
  if (!getSettings().autoCheckUpdates || (mode === 'manual' && !FEED)) return
  setTimeout(() => void checkForUpdates(), 8000)
  setInterval(() => {
    if (getSettings().autoCheckUpdates && (status.state === 'idle' || status.state === 'none' || status.state === 'error')) void checkForUpdates()
  }, CHECK_EVERY)
}
