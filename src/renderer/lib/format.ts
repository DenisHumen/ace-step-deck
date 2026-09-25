export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—'
  const s = Math.max(0, Math.round(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function fmtEta(sec: number | null | undefined, lang: 'en' | 'ru'): string {
  if (!sec || !Number.isFinite(sec)) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s} ${lang === 'ru' ? 'с' : 's'}`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} ${lang === 'ru' ? 'мин' : 'min'}`
  return `${Math.floor(m / 60)} ${lang === 'ru' ? 'ч' : 'h'} ${m % 60} ${lang === 'ru' ? 'мин' : 'min'}`
}

export function fmtBytes(b: number): string {
  if (!b) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)))
  return `${(b / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${u[i]}`
}

export function fmtDate(ts: number, lang: 'en' | 'ru'): string {
  return new Date(ts).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Deterministic hash → used for generative cover art. */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v))
}
