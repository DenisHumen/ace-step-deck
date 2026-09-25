import { app } from 'electron'
import { join } from 'node:path'
import type { Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { emit, readJson, writeJson } from './util'

const file = () => join(app.getPath('userData'), 'settings.json')
let current: Settings | null = null

function defaults(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    language: app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en',
    outputDir: join(app.getPath('music'), 'AceDeck'),
  }
}

export async function loadSettings(): Promise<Settings> {
  const saved = await readJson<Partial<Settings>>(file(), {})
  current = { ...defaults(), ...saved }
  return current
}

export function getSettings(): Settings {
  if (!current) throw new Error('settings not loaded')
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  current = { ...getSettings(), ...patch }
  await writeJson(file(), current)
  emit('settings:update', current)
  return current
}
