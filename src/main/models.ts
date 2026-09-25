import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelInfo } from '@shared/types'
import { MODEL_CATALOG } from '@shared/constants'
import { checkpointsDir, hasWeights } from './install-detect'
import { getSettings } from './settings'
import { findUv } from './system'
import { dirSize, emit, run, throttle } from './util'
import { repoBytes } from './installer'
import { engine } from './engine'

const downloading = new Map<string, number | null>()

export async function listModels(): Promise<ModelInfo[]> {
  const path = getSettings().installPath
  const ck = path ? checkpointsDir(path) : null
  return Promise.all(
    MODEL_CATALOG.map(async (m) => ({
      name: m.name,
      kind: m.kind,
      repo: m.repo,
      approxGB: m.approxGB,
      bundled: m.bundled,
      installed: ck ? await hasWeights(join(ck, m.name)) : false,
      downloading: downloading.has(m.name),
      progress: downloading.get(m.name) ?? null,
    })),
  )
}

const pushModels = throttle(async () => emit('models:update', await listModels()), 400)

export async function downloadModel(name: string): Promise<void> {
  const path = getSettings().installPath
  if (!path) throw new Error('ACE-Step is not installed')
  const entry = MODEL_CATALOG.find((m) => m.name === name)
  if (!entry) throw new Error(`Unknown model ${name}`)
  if (downloading.has(name)) return
  const ck = checkpointsDir(path)
  const dir = join(ck, entry.bundled ? '' : name)
  const expected = (await repoBytes(entry.repo)) ?? entry.approxGB * 1e9
  const before = entry.bundled ? 0 : await dirSize(dir)
  downloading.set(name, 0)
  pushModels()
  const tick = setInterval(async () => {
    const size = entry.bundled ? await dirSize(ck) : await dirSize(dir)
    downloading.set(name, Math.min(0.99, Math.max(0, size - before) / expected + before / expected))
    pushModels()
  }, 1000)

  const exe = join(path, '.venv', 'Scripts', 'acestep-download.exe')
  const uv = await findUv()
  const baseArgs = entry.bundled ? [] : ['--model', name, '--skip-main']
  const [cmd, args] = existsSync(exe) ? [exe, baseArgs] : [uv ?? 'uv', ['run', '--no-sync', 'acestep-download', ...baseArgs]]
  engine.log(`[models] downloading ${name} (${(expected / 1e9).toFixed(1)} GB)`)
  try {
    const h = run(cmd, args, {
      cwd: path,
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_PROGRESS_BARS: '1' },
      onLine: (line, stream) => {
        if (!/%\||Xet Storage|hf_xet/.test(line)) engine.log(`[models] ${line}`, stream)
      },
    })
    const code = await h.done
    if (code !== 0) throw new Error(`Download of ${name} failed (exit ${code})`)
    engine.log(`[models] ${name} ready`)
  } finally {
    clearInterval(tick)
    downloading.delete(name)
    emit('models:update', await listModels())
  }
}
