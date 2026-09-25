import { parseFile } from 'music-metadata'

/** Real duration of an audio file in seconds (ACE-Step reports "N/A" for cover/repaint/stems). */
export async function probeDuration(file: string): Promise<number | null> {
  try {
    const meta = await parseFile(file, { duration: true, skipCovers: true })
    const d = meta.format.duration
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : null
  } catch {
    return null
  }
}

/** Accept numbers and numeric strings, reject "N/A" and friends. */
export function numericOrNull(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}
