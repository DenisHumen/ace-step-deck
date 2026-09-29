// Video model files in ComfyUI's models/ folders: catalog + user-added links + whatever is already on disk.
import { shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, join } from 'node:path'
import { VIDEO_MODEL_CATALOG, VIDEO_MODEL_DIRS, parseModelUrl, type VideoModelEntry, type VideoModelInfo, type VideoModelKind } from '@shared/video'
import { getSettings, updateSettings } from '../settings'
import { downloadResumable, emit, formatBytes, throttle } from '../util'
import { videoEngine } from './engine'

const key = (kind: VideoModelKind, file: string) => `${kind}/${file}`
const active = new Map<string, { progress: number | null; abort: AbortController }>()
const errors = new Map<string, string>()

export function modelsRoot(): string | null {
  const p = getSettings().videoInstallPath
  return p ? join(p, 'models') : null
}

export function modelPath(kind: VideoModelKind, file: string): string | null {
  const root = modelsRoot()
  return root ? join(root, VIDEO_MODEL_DIRS[kind], file) : null
}

async function sizeOf(path: string | null): Promise<number> {
  if (!path) return 0
  try {
    return (await fsp.stat(path)).size
  } catch {
    return 0
  }
}

/** .safetensors already on disk that neither the catalog nor the user's links know about. */
async function scanLocal(known: Set<string>): Promise<VideoModelEntry[]> {
  const root = modelsRoot()
  if (!root) return []
  const found: VideoModelEntry[] = []
  const dirs: [VideoModelKind, string][] = [
    ['diffusion', 'diffusion_models'],
    ['diffusion', 'unet'],
    ['lora', 'loras'],
  ]
  for (const [kind, dir] of dirs) {
    let names: string[] = []
    try {
      names = await fsp.readdir(join(root, dir))
    } catch {
      continue
    }
    for (const n of names) {
      if (!/\.safetensors$/i.test(n) || known.has(key(kind, n))) continue
      known.add(key(kind, n))
      found.push({ file: n, kind, url: null, approxGB: 0 })
    }
  }
  return found
}

export async function listVideoModels(): Promise<VideoModelInfo[]> {
  const custom = getSettings().videoCustomModels ?? []
  const entries: (VideoModelEntry & { bundled: boolean; custom: boolean })[] = [
    ...VIDEO_MODEL_CATALOG.map((m) => ({ ...m, bundled: true, custom: false })),
    ...custom.map((m) => ({ ...m, bundled: false, custom: true })),
  ]
  const known = new Set(entries.map((e) => key(e.kind, e.file)))
  for (const e of await scanLocal(known)) entries.push({ ...e, bundled: false, custom: false })
  return Promise.all(
    entries.map(async (e) => {
      const path = modelPath(e.kind, e.file)
      const k = key(e.kind, e.file)
      const installed = !!path && existsSync(path)
      return {
        ...e,
        installed,
        sizeBytes: installed ? await sizeOf(path) : 0,
        downloading: active.has(k),
        progress: active.get(k)?.progress ?? null,
        error: errors.get(k) ?? null,
      }
    }),
  )
}

export const pushVideoModels = throttle(async () => emit('video:models', await listVideoModels()), 400)

function findEntry(kind: VideoModelKind, file: string): VideoModelEntry | undefined {
  return [...VIDEO_MODEL_CATALOG, ...(getSettings().videoCustomModels ?? [])].find((m) => m.kind === kind && m.file === file)
}

/** Download one model (resumable). Resolves when done; progress is pushed as `video:models`. */
export async function downloadVideoModel(kind: VideoModelKind, file: string): Promise<void> {
  const entry = findEntry(kind, file)
  if (!entry?.url) throw new Error(`No download link for ${file}`)
  const dest = modelPath(kind, file)
  if (!dest) throw new Error('Install ComfyUI first')
  const k = key(kind, file)
  if (active.has(k)) return
  const abort = new AbortController()
  active.set(k, { progress: 0, abort })
  errors.delete(k)
  pushVideoModels()
  videoEngine.log(`[models] downloading ${file}`)
  try {
    let lastLog = 0
    await downloadResumable(
      entry.url,
      dest,
      (p) => {
        const a = active.get(k)
        if (a) a.progress = p.total ? p.received / p.total : null
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now()
          videoEngine.log(`[models] ${file}: ${formatBytes(p.received)}${p.total ? ` / ${formatBytes(p.total)}` : ''} · ${formatBytes(p.bytesPerSec)}/s`)
        }
        pushVideoModels()
      },
      abort.signal,
    )
    videoEngine.log(`[models] ${file} ready`)
  } catch (e: any) {
    const msg = abort.signal.aborted ? 'Cancelled' : e?.message ?? String(e)
    errors.set(k, msg)
    videoEngine.log(`[models] ${file}: ${msg}`, 'err')
    throw new Error(msg)
  } finally {
    active.delete(k)
    emit('video:models', await listVideoModels())
  }
}

export function cancelVideoModel(kind: VideoModelKind, file: string): void {
  active.get(key(kind, file))?.abort.abort()
}

/** Remember a Hugging Face / direct link and start downloading it. */
export async function addVideoModelUrl(raw: string, kind: VideoModelKind): Promise<VideoModelEntry> {
  if (kind !== 'diffusion' && kind !== 'lora') throw new Error('Only diffusion models and LoRAs can be added')
  const parsed = parseModelUrl(raw)
  if (!parsed) throw new Error('Paste a Hugging Face link (or a direct https link) to a .safetensors file')
  if (!modelsRoot()) throw new Error('Install ComfyUI first')
  let entry = findEntry(kind, parsed.file)
  if (!entry) {
    entry = { file: parsed.file, kind, url: parsed.url, approxGB: 0 }
    await updateSettings({ videoCustomModels: [...(getSettings().videoCustomModels ?? []), entry] })
  }
  if (!existsSync(modelPath(kind, entry.file)!)) void downloadVideoModel(kind, entry.file).catch(() => {})
  else pushVideoModels()
  return entry
}

/** Copy a local .safetensors into the models folder (hard link when on the same drive). */
export async function importVideoModelFile(src: string, kind: VideoModelKind): Promise<string> {
  if (!/\.safetensors$/i.test(src)) throw new Error('Pick a .safetensors file')
  const dest = modelPath(kind, basename(src))
  if (!dest) throw new Error('Install ComfyUI first')
  if (existsSync(dest)) throw new Error(`${basename(src)} is already in the models folder`)
  await fsp.mkdir(join(dest, '..'), { recursive: true })
  try {
    await fsp.link(src, dest)
  } catch {
    videoEngine.log(`[models] copying ${basename(src)}…`)
    await fsp.copyFile(src, `${dest}.part`)
    await fsp.rename(`${dest}.part`, dest)
  }
  videoEngine.log(`[models] imported ${basename(src)}`)
  emit('video:models', await listVideoModels())
  return basename(dest)
}

/** Move a model file to the Recycle Bin and forget its link. The base text encoder and VAE stay. */
export async function removeVideoModel(kind: VideoModelKind, file: string): Promise<void> {
  if (kind === 'text_encoder' || kind === 'vae') throw new Error('The text encoder and the VAE are required')
  cancelVideoModel(kind, file)
  const path = modelPath(kind, file)
  if (path) {
    for (const p of [path, `${path}.part`]) if (existsSync(p)) await shell.trashItem(p).catch(() => fsp.rm(p, { force: true }))
  }
  const custom = getSettings().videoCustomModels ?? []
  if (custom.some((m) => m.kind === kind && m.file === file)) {
    await updateSettings({ videoCustomModels: custom.filter((m) => !(m.kind === kind && m.file === file)) })
  }
  errors.delete(key(kind, file))
  emit('video:models', await listVideoModels())
}
