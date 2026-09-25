import { existsSync, promises as fsp } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { execText } from './util'

export interface InstallInspection {
  path: string
  source: boolean
  venv: boolean
  apiExe: string | null
  python: string | null
  mainModels: boolean
  hasTriton: boolean
  isGit: boolean
  revision: string | null
}

export const MAIN_COMPONENTS = ['acestep-v15-turbo', 'vae', 'Qwen3-Embedding-0.6B', 'acestep-5Hz-lm-1.7B']

export function checkpointsDir(installPath: string): string {
  return join(installPath, 'checkpoints')
}

export async function isAceStepDir(p: string): Promise<boolean> {
  try {
    const toml = await fsp.readFile(join(p, 'pyproject.toml'), 'utf8')
    return /name\s*=\s*"ace-step"/.test(toml) && existsSync(join(p, 'acestep'))
  } catch {
    return false
  }
}

/** A model folder counts as present when it holds at least one real weight file. */
export async function hasWeights(dir: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return false
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isFile() && /\.(safetensors|bin|pt|pth|ckpt)$/i.test(e.name)) {
      try {
        if ((await fsp.stat(p)).size > 1024 * 1024) return true
      } catch {
        /* ignore */
      }
    } else if (e.isDirectory() && !e.name.startsWith('.') && (await hasWeights(p))) return true
  }
  return false
}

export async function inspectInstall(path: string): Promise<InstallInspection> {
  const source = await isAceStepDir(path)
  const scripts = join(path, '.venv', 'Scripts')
  const python = existsSync(join(scripts, 'python.exe')) ? join(scripts, 'python.exe') : null
  const apiExe = existsSync(join(scripts, 'acestep-api.exe')) ? join(scripts, 'acestep-api.exe') : null
  const ck = checkpointsDir(path)
  const mainModels = source ? (await Promise.all(MAIN_COMPONENTS.map((c) => hasWeights(join(ck, c))))).every(Boolean) : false
  const hasTriton = existsSync(join(path, '.venv', 'Lib', 'site-packages', 'triton', 'language'))
  const isGit = existsSync(join(path, '.git'))
  let revision: string | null = null
  if (isGit) {
    const r = await execText('git', ['-C', path, 'log', '-1', '--format=%h %cs'], 5000)
    if (r.code === 0) revision = r.out.trim() || null
  }
  return { path, source, venv: !!python, apiExe, python, mainModels, hasTriton, isGit, revision }
}

export function candidateInstallPaths(extra: (string | null | undefined)[] = []): string[] {
  const home = os.homedir()
  const list = [
    ...extra,
    join(home, 'ACE-Step-1.5'),
    join(home, 'ACE-Step'),
    join(home, 'Desktop', 'ACE-Step-1.5'),
    join(home, 'Documents', 'ACE-Step-1.5'),
    join(home, 'AceDeck', 'ACE-Step-1.5'),
    'C:\\ACE-Step-1.5',
    'C:\\ACE-Step',
    'C:\\AI\\ACE-Step-1.5',
    'D:\\ACE-Step-1.5',
    'D:\\AI\\ACE-Step-1.5',
  ]
  return [...new Set(list.filter((p): p is string => !!p))]
}

export async function detectInstalls(extra: (string | null | undefined)[] = []): Promise<InstallInspection[]> {
  const found: InstallInspection[] = []
  for (const p of candidateInstallPaths(extra)) {
    if (existsSync(p) && (await isAceStepDir(p))) found.push(await inspectInstall(p))
  }
  return found
}
