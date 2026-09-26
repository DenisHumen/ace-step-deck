import { extractStyle, styleCaption } from '@shared/style'
import type { SampleResult } from '@shared/types'
import { engine } from './engine'

export interface Composed extends SampleResult {
  instrumental: boolean
  styleTags: string[]
}

/** Cyrillic descriptions default to Russian lyrics (Ukrainian when its letters show up). */
function guessLanguage(text: string): string {
  if (/[іїєґ]/i.test(text)) return 'uk'
  return /[а-яё]/i.test(text) ? 'ru' : 'unknown'
}

/**
 * Simple mode / "Write with AI": the LM writes lyrics and fills the metadata, but the style stays the user's.
 *
 * ACE-Step's own create_sample reinterprets long non-English prose (a noir-jazz description comes back as
 * "lo-fi hip-hop with rap"), and its DiT only understands English captions. So the LM gets the English
 * style tags up front, and the render caption is the user's wording (or those tags), never the LM's retelling.
 */
export async function composeFromDescription(query: string, instrumental: boolean, lang: string): Promise<Composed> {
  const text = query.trim()
  const hints = extractStyle(text)
  const own = styleCaption(text, hints)
  const inst = instrumental || hints.instrumental === true
  const language = lang && lang !== 'unknown' ? lang : inst ? 'unknown' : guessLanguage(text)
  // Tags first so the LM keeps the genre; the original text still carries the song's topic for the lyrics.
  const lmQuery = hints.needsTranslation && own ? (inst ? own : `${own} ${text}`) : text
  const s = await engine.api.createSample(lmQuery, inst, language)

  let caption: string
  if (!hints.needsTranslation) caption = text
  else if (own && hints.hasGenre) caption = own
  else if (own) caption = s.caption ? `${own} ${s.caption}` : own // no genre named: let the LM pick one
  else caption = s.caption || text

  return {
    ...s,
    caption,
    lyrics: inst ? '[Instrumental]' : s.lyrics,
    bpm: hints.bpm ?? s.bpm ?? null,
    vocal_language: language !== 'unknown' ? language : s.vocal_language,
    instrumental: inst,
    styleTags: hints.tags,
  }
}
