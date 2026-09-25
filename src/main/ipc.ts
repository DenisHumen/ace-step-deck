import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
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
  'ai.createSample': (query: string, instrumental: boolean, lang: string) => engine.api.createSample(query, instrumental, lang),
  'ai.formatInput': (caption: string, lyrics: string, meta: Record<string, unknown>) => engine.api.formatInput(caption, lyrics, meta),
  'ai.randomSample': (type: 'simple_mode' | 'custom_mode') => engine.api.randomSample(type),

  // dialogs
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
