import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AppInfo, JobSpec, Settings } from '@shared/types'
import { engine } from './engine'
import { installer, defaultInstallPath } from './installer'
import { queue } from './queue'
import { library } from './library'
import { diagnostics } from './diagnostics'
import { listModels, downloadModel } from './models'
import { getSettings, updateSettings } from './settings'
import { systemInfo, findUv } from './system'
import { detectInstalls, inspectInstall, isAceStepDir } from './install-detect'
import { mcpConfig, installIntoClaudeDesktop, mcpServerPath } from './claude'
import { controlFile, startControlServer, stopControlServer } from './control-server'
import { run } from './util'
import { composeFromDescription } from './compose'
import { checkForUpdates, createDesktopShortcut, downloadUpdate, installUpdate, openReleasePage, updateStatus } from './updater'
import type { VideoJobSpec, VideoModelKind } from '@shared/video'
import { inspectComfy, videoEngine } from './video/engine'
import { defaultVideoInstallPath, videoInstaller } from './video/installer'
import { addVideoModelUrl, cancelVideoModel, downloadVideoModel, importVideoModelFile, listVideoModels, removeVideoModel } from './video/models'
import { videoQueue } from './video/queue'
import { videoLibrary } from './video/library'

const win = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null

async function updateEngine(): Promise<string> {
  const path = getSettings().installPath
  if (!path) throw new Error('ACE-Step is not installed')
  const insp = await inspectInstall(path)
  if (!insp.isGit) throw new Error('This install was not created with git; reinstall to enable updates')
  const wasRunning = engine.running
  if (wasRunning) await engine.stop()
  const step = async (cmd: string, args: string[]) => {
    engine.log(`[update] ${cmd} ${args.join(' ')}`)
    const code = await run(cmd, args, { cwd: path, onLine: (l, s) => engine.log(`[update] ${l}`, s) }).done
    if (code !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${code})`)
  }
  await step('git', ['pull', '--ff-only'])
  const uv = await findUv()
  if (!uv) throw new Error('uv not found')
  await step(uv, ['sync'])
  await engine.refreshInstall()
  if (wasRunning) void engine.start()
  return engine.status.revision ?? 'updated'
}

const handlers: Record<string, (...args: any[]) => unknown> = {
  // app
  'app.info': (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    userData: app.getPath('userData'),
    exePath: process.execPath,
    mcpServerPath: mcpServerPath(),
    controlFile: controlFile(),
    isPackaged: app.isPackaged,
  }),
  'app.openExternal': (url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  },
  'app.openPath': (p: string) => (existsSync(p) ? shell.openPath(p) : ''),
  'app.mcpConfig': () => mcpConfig(),
  'app.createShortcut': () => createDesktopShortcut(),

  // updates
  'update.status': () => updateStatus(),
  'update.check': () => checkForUpdates(),
  'update.download': () => downloadUpdate(),
  'update.install': () => installUpdate(),
  'update.openPage': () => openReleasePage(),
  'app.installClaudeDesktop': () => installIntoClaudeDesktop(),

  // settings
  'settings.get': () => getSettings(),
  'settings.set': async (patch: Partial<Settings>) => {
    const before = getSettings()
    const s = await updateSettings(patch)
    if ('installPath' in patch) await engine.refreshInstall()
    if (patch.controlApiEnabled !== undefined || patch.controlApiPort !== undefined) {
      await stopControlServer()
      if (s.controlApiEnabled) await startControlServer()
    }
    if (patch.outputDir && patch.outputDir !== before.outputDir) engine.log(`Output folder: ${patch.outputDir}`)
    return s
  },

  // engine
  'engine.status': () => engine.status,
  'engine.start': () => engine.start(),
  'engine.stop': () => engine.stop(),
  'engine.restart': () => engine.restart(),
  'engine.logs': () => engine.getLogs(),
  'engine.clearLogs': () => engine.clearLogs(),
  'engine.update': () => updateEngine(),
  'engine.detect': () => detectInstalls([getSettings().installPath]),
  'engine.useInstall': async (raw: string) => {
    const path = resolve(raw)
    if (!(await isAceStepDir(path))) throw new Error('This folder is not an ACE-Step 1.5 checkout')
    await updateSettings({ installPath: path })
    await engine.refreshInstall()
    return inspectInstall(path)
  },
  'engine.inspect': () => (getSettings().installPath ? inspectInstall(getSettings().installPath!) : null),

  // system
  'system.info': () => systemInfo(getSettings().installPath ?? defaultInstallPath()),

  // installer
  'install.state': () => installer.state,
  'install.start': async (path: string) => {
    // Validate synchronously so bad paths surface as a toast; the install itself runs in background.
    const started = installer.start(path)
    const early = await Promise.race([started.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 50))])
    if (early) throw early
    return true
  },
  'install.cancel': () => installer.cancel(),
  'install.defaultPath': () => getSettings().installPath ?? defaultInstallPath(),

  // queue
  'queue.state': () => queue.state,
  'queue.add': (spec: JobSpec) => queue.add({ ...spec, source: 'ui' }),
  'queue.cancel': (id: string) => queue.cancel(id),
  'queue.remove': (id: string) => queue.remove(id),
  'queue.move': (id: string, dir: 'up' | 'down' | 'top') => queue.move(id, dir),
  'queue.retry': (id: string) => queue.retry(id),
  'queue.duplicate': (id: string) => queue.duplicate(id),
  'queue.pause': () => queue.setPaused(true),
  'queue.resume': () => queue.setPaused(false),
  'queue.clearFinished': () => queue.clearFinished(),

  // library
  'library.list': () => library.list(),
  'library.update': (id: string, patch: any) => library.update(id, patch),
  'library.remove': (id: string) => library.remove(id),
  'library.saveAs': (id: string) => library.saveAs(id, win()),
  'library.reveal': (id: string) => library.reveal(id),
  'library.openFolder': () => shell.openPath(getSettings().outputDir),

  // models
  'models.list': () => listModels(),
  'models.download': (name: string) => {
    void downloadModel(name).catch((e) => engine.log(`[models] ${e.message}`, 'err'))
    return true
  },

  // diagnostics
  'diag.state': () => diagnostics.state,
  'diag.run': (mode: 'quick' | 'full') => {
    void diagnostics.run(mode)
    return true
  },
  'diag.cancel': () => diagnostics.cancel(),

  // AI helpers (need a running engine)
  'ai.createSample': (query: string, instrumental: boolean, lang: string) => composeFromDescription(query, instrumental, lang),
  'ai.formatInput': (caption: string, lyrics: string, meta: Record<string, unknown>) => engine.api.formatInput(caption, lyrics, meta),
  'ai.randomSample': (type: 'simple_mode' | 'custom_mode') => engine.api.randomSample(type),

  // video: ComfyUI engine
  'video.status': () => videoEngine.status,
  'video.start': () => videoEngine.start(),
  'video.stop': () => videoEngine.stop(),
  'video.restart': () => videoEngine.restart(),
  'video.logs': () => videoEngine.getLogs(),
  'video.clearLogs': () => videoEngine.clearLogs(),
  'video.openUi': () => {
    if (videoEngine.ready) return shell.openExternal(`http://127.0.0.1:${getSettings().videoPort}`)
  },
  'video.useInstall': async (raw: string) => {
    const insp = await inspectComfy(raw)
    if (!insp.source) throw new Error('This folder is not a ComfyUI checkout')
    if (!insp.python) throw new Error('No Python environment next to this ComfyUI (.venv, venv or python_embeded)')
    if (videoEngine.running) await videoEngine.stop()
    await updateSettings({ videoInstallPath: insp.path })
    await videoEngine.refreshInstall()
    return insp
  },
  'video.setSettings': async (patch: Partial<Settings>) => {
    const before = getSettings()
    const s = await updateSettings(patch)
    const restart = (patch.videoPort !== undefined && patch.videoPort !== before.videoPort) || (patch.videoLowVram !== undefined && patch.videoLowVram !== before.videoLowVram)
    if (restart && videoEngine.running && !videoEngine.status.external) void videoEngine.restart().catch(() => {})
    return s
  },

  // video: installer
  'video.install.state': () => videoInstaller.state,
  'video.install.start': async (path: string) => {
    const started = videoInstaller.start(path)
    const early = await Promise.race([started.then(() => null, (e) => e), new Promise((r) => setTimeout(() => r(null), 50))])
    if (early) throw early
    return true
  },
  'video.install.cancel': () => videoInstaller.cancel(),
  'video.install.defaultPath': () => getSettings().videoInstallPath ?? defaultVideoInstallPath(),

  // video: models
  'video.models.list': () => listVideoModels(),
  'video.models.download': (kind: VideoModelKind, file: string) => {
    void downloadVideoModel(kind, file).catch(() => {})
    return true
  },
  'video.models.cancel': (kind: VideoModelKind, file: string) => cancelVideoModel(kind, file),
  'video.models.addUrl': (url: string, kind: VideoModelKind) => addVideoModelUrl(url, kind),
  'video.models.import': (path: string, kind: VideoModelKind) => importVideoModelFile(path, kind),
  'video.models.remove': (kind: VideoModelKind, file: string) => removeVideoModel(kind, file),

  // video: queue + library
  'video.queue.state': () => videoQueue.state,
  'video.queue.add': (spec: VideoJobSpec) => videoQueue.add({ ...spec, source: 'ui' }),
  'video.queue.cancel': (id: string) => videoQueue.cancel(id),
  'video.queue.remove': (id: string) => videoQueue.remove(id),
  'video.queue.retry': (id: string) => videoQueue.retry(id),
  'video.queue.duplicate': (id: string) => videoQueue.duplicate(id),
  'video.queue.pause': () => videoQueue.setPaused(true),
  'video.queue.resume': () => videoQueue.setPaused(false),
  'video.queue.clearFinished': () => videoQueue.clearFinished(),
  'video.library.list': () => videoLibrary.list(),
  'video.library.update': (id: string, patch: any) => videoLibrary.update(id, patch),
  'video.library.remove': (id: string) => videoLibrary.remove(id),
  'video.library.saveAs': (id: string) => videoLibrary.saveAs(id, win()),
  'video.library.reveal': (id: string) => videoLibrary.reveal(id),
  'video.library.openFolder': async () => {
    const dir = getSettings().videoOutputDir
    await mkdir(dir, { recursive: true })
    return shell.openPath(dir)
  },

  // dialogs
  'dialog.pickModelFile': async () => {
    const w = win()
    const opts: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'Safetensors', extensions: ['safetensors'] }] }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  },
  'dialog.pickFolder': async (defaultPath?: string) => {
    const w = win()
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'], defaultPath }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  },
  'dialog.pickAudio': async () => {
    const w = win()
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'opus', 'm4a', 'aac'] }],
    }
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  },
}

export function registerIpc(): void {
  ipcMain.handle('invoke', async (_e, method: string, ...args: unknown[]) => {
    const fn = handlers[method]
    if (!fn) throw new Error(`Unknown method ${method}`)
    try {
      return { ok: true, data: await fn(...args) }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) }
    }
  })
}
