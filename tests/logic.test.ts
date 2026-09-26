import { describe, expect, it } from 'vitest'
import { compareVersions, jobTitle, mergeClaudeDesktopConfig, normalizeSample, slugify, smoothProgress } from '../src/shared/logic'
import { stageKey } from '../src/renderer/lib/stage'
import { en } from '../src/renderer/i18n/en'
import { ru } from '../src/renderer/i18n/ru'

describe('smoothProgress', () => {
  it('returns the engine value when it just changed', () => {
    expect(smoothProgress(0.5, 0)).toBeCloseTo(0.5)
  })
  it('creeps towards the next milestone but never reaches it', () => {
    const a = smoothProgress(0.01, 10)
    const b = smoothProgress(0.01, 60)
    const c = smoothProgress(0.01, 10_000)
    expect(a).toBeGreaterThan(0.01)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeLessThan(0.25)
  })
  it('is monotonic in time and clamps input', () => {
    let prev = 0
    for (let s = 0; s < 120; s += 5) {
      const v = smoothProgress(0.8, s)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(smoothProgress(2, 5)).toBeLessThanOrEqual(1)
    expect(smoothProgress(-1, 0)).toBeGreaterThanOrEqual(0)
  })
})

describe('jobTitle', () => {
  it('prefers explicit title, then description, then caption', () => {
    expect(jobTitle({ title: 'My song', params: { prompt: 'x' }, count: 1, batchSize: 1 })).toBe('My song')
    expect(jobTitle({ params: { sample_query: 'rainy  synthwave', prompt: 'x' }, count: 1, batchSize: 1 })).toBe('rainy synthwave')
    expect(jobTitle({ params: { prompt: 'lo-fi, piano' }, count: 1, batchSize: 1 })).toBe('lo-fi, piano')
    expect(jobTitle({ params: { task_type: 'cover' }, count: 1, batchSize: 1 })).toBe('cover')
  })
  it('truncates long titles', () => {
    const t = jobTitle({ params: { prompt: 'a'.repeat(200) }, count: 1, batchSize: 1 })
    expect(t.length).toBe(58)
    expect(t.endsWith('…')).toBe(true)
  })
})

describe('normalizeSample', () => {
  it('maps the different key spellings used by ACE-Step endpoints', () => {
    const a = normalizeSample({ caption: 'c', lyrics: 'l', bpm: 120, keyscale: 'A minor', timesignature: '4', duration: 90, language: 'ru' })
    expect(a).toEqual({ caption: 'c', lyrics: 'l', bpm: 120, key_scale: 'A minor', time_signature: '4', duration: 90, vocal_language: 'ru' })
    const b = normalizeSample({ prompt: 'p', key_scale: 'C major', time_signature: '3', audio_duration: '60', vocal_language: 'en', bpm: 'N/A' })
    expect(b.caption).toBe('p')
    expect(b.bpm).toBeNull()
    expect(b.duration).toBe(60)
  })
})

describe('slugify', () => {
  it('keeps unicode letters and collapses separators', () => {
    expect(slugify('Neon rain — synthwave!!')).toBe('neon-rain-synthwave')
    expect(slugify('Песня про лето')).toBe('песня-про-лето')
    expect(slugify('***')).toBe('track')
  })
})

describe('stageKey', () => {
  it('maps raw engine stages to friendly labels', () => {
    expect(stageKey('Phase 2: Generating audio codes for batch')).toBe('stage.melody')
    expect(stageKey('Generating music (batch size: 1)...')).toBe('stage.render')
    expect(stageKey('Decoding audio...')).toBe('stage.decode')
    expect(stageKey('Preparing audio data...')).toBe('stage.finish')
    expect(stageKey('something new')).toBeNull()
  })
})

describe('i18n dictionaries', () => {
  it('Russian covers every English key', () => {
    const missing = Object.keys(en).filter((k) => !(k in ru))
    expect(missing).toEqual([])
  })
  it('placeholders match between languages', () => {
    // Compare the set of placeholders (plural forms repeat {n} a different number of times).
    const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',')
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      expect(vars(ru[k]), k).toBe(vars(en[k]))
    }
  })
})

describe('mergeClaudeDesktopConfig', () => {
  const entry = { command: 'C:/AceDeck/AceDeck.exe', args: ['C:/AceDeck/resources/mcp/server.cjs'], env: { ELECTRON_RUN_AS_NODE: '1' } }
  it('creates a config when none exists', () => {
    expect(JSON.parse(mergeClaudeDesktopConfig(null, entry))).toEqual({ mcpServers: { acedeck: entry } })
    expect(JSON.parse(mergeClaudeDesktopConfig('   ', entry))).toEqual({ mcpServers: { acedeck: entry } })
  })
  it('keeps other servers and settings', () => {
    const existing = JSON.stringify({ globalShortcut: 'Ctrl+Space', mcpServers: { github: { command: 'gh-mcp', args: [] } } })
    const out = JSON.parse(mergeClaudeDesktopConfig(existing, entry))
    expect(out.globalShortcut).toBe('Ctrl+Space')
    expect(out.mcpServers.github).toEqual({ command: 'gh-mcp', args: [] })
    expect(out.mcpServers.acedeck).toEqual(entry)
  })
  it('replaces an older AceDeck entry instead of duplicating it', () => {
    const existing = JSON.stringify({ mcpServers: { acedeck: { command: 'old.exe', args: [] } } })
    expect(Object.keys(JSON.parse(mergeClaudeDesktopConfig(existing, entry)).mcpServers)).toEqual(['acedeck'])
    expect(JSON.parse(mergeClaudeDesktopConfig(existing, entry)).mcpServers.acedeck.command).toBe(entry.command)
  })
  it('refuses to overwrite invalid JSON', () => {
    expect(() => mergeClaudeDesktopConfig('{ broken', entry)).toThrow(/not valid JSON/)
    expect(() => mergeClaudeDesktopConfig('[1,2]', entry)).toThrow(/JSON object/)
  })
})

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
    expect(compareVersions('v1.0.2', '1.0.2')).toBe(0)
    expect(compareVersions('1.0.2', '1.1.0')).toBe(-1)
    expect(compareVersions('1.0.2-beta.1', '1.0.2')).toBe(-1)
    expect(compareVersions('2.0', '1.9.9')).toBe(1)
  })
})
