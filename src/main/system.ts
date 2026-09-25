import { app } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { join, parse } from 'node:path'
import os from 'node:os'
import type { GpuInfo, SystemInfo } from '@shared/types'
import { execText, which } from './util'

export async function gpuInfo(): Promise<GpuInfo[]> {
  const { code, out } = await execText('nvidia-smi', [
    '--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu,driver_version',
    '--format=csv,noheader,nounits',
  ], 8000)
  if (code !== 0) return []
  return out
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const [name, total, used, util, temp, driver] = l.split(',').map((s) => s.trim())
      return {
        name,
        memoryTotalMB: Number(total) || 0,
        memoryUsedMB: Number(used) || 0,
        utilization: Number(util) || 0,
        temperature: Number(temp) || 0,
        driver: driver ?? '',
      }
    })
}

export async function diskFreeGB(path: string): Promise<number | null> {
  // Walk up to the nearest existing ancestor (the install dir may not exist yet).
  let p = path
  while (p && !existsSync(p)) {
    const parent = parse(p).dir
    if (parent === p) break
    p = parent
  }
  try {
    const s = await fsp.statfs(p || parse(path).root)
    return (s.bavail * s.bsize) / 1024 ** 3
  } catch {
    return null
  }
}

export function toolsDir(): string {
  return join(app.getPath('userData'), 'tools')
}

/** Locate uv: PATH, the usual installer locations, or AceDeck's private copy. */
export async function findUv(): Promise<string | null> {
  const home = os.homedir()
  const candidates = [
    join(toolsDir(), 'uv.exe'),
    join(home, '.local', 'bin', 'uv.exe'),
    join(home, '.cargo', 'bin', 'uv.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'uv.exe'),
    join(home, 'scoop', 'shims', 'uv.exe'),
  ]
  const onPath = await which('uv')
  if (onPath) return onPath
  return candidates.find((c) => existsSync(c)) ?? null
}

export async function systemInfo(diskPath: string | null): Promise<SystemInfo> {
  const [gpus, git, uv, free] = await Promise.all([
    gpuInfo(),
    which('git'),
    findUv(),
    diskPath ? diskFreeGB(diskPath) : Promise.resolve(null),
  ])
  return {
    gpus,
    ramGB: os.totalmem() / 1024 ** 3,
    diskFreeGB: free,
    diskPath,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    hasGit: !!git,
    hasUv: !!uv,
  }
}
