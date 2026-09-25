import { useCallback } from 'react'
import { useApp } from '../lib/store'
import { en, type DictKey } from './en'
import { ru } from './ru'

const dicts = { en, ru }

/** Plural forms are separated by "|": en "one|other", ru "one|few|many". The count comes from `n`. */
function pickPlural(lang: 'en' | 'ru', forms: string[], n: number): string {
  if (forms.length === 1) return forms[0]
  if (lang === 'ru') {
    const m10 = n % 10
    const m100 = n % 100
    const i = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
    return forms[Math.min(i, forms.length - 1)]
  }
  return forms[n === 1 ? 0 : 1] ?? forms[0]
}

export function translate(lang: 'en' | 'ru', key: DictKey | string, vars?: Record<string, string | number>): string {
  const d = dicts[lang] as Record<string, string>
  let s = d[key] ?? (en as Record<string, string>)[key] ?? key
  if (s.includes('|') && vars && typeof vars.n === 'number') s = pickPlural(lang, s.split('|'), vars.n)
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export function useT() {
  const lang = useApp((s) => s.settings?.language ?? 'en')
  return useCallback((key: DictKey | string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])
}
