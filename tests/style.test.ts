import { describe, expect, it } from 'vitest'
import { extractStyle, styleCaption } from '../src/shared/style'

const NOIR =
  'Нуар-джаз (или джаз-нуар) — медленный, мрачный и атмосферный джаз, напоминающий саундтреки к фильмам нуар: приглушённая труба, контрабас, щётки по малому барабану, дымный бар и дождливый ночной город. Близкий жанр — дарк-джаз (dark jazz). Дарк-джаз — это более современная и экспериментальная форма, зародившаяся в 1990-х годах (например, группа Bohren und der Club of Gore), которая объединяет джаз с элементами эмбиента, дум-метала и более мрачной, «погребальной» атмосферой.'

describe('extractStyle', () => {
  it('keeps the genre of a Russian noir/dark-jazz description', () => {
    const h = extractStyle(NOIR)
    expect(h.needsTranslation).toBe(true)
    expect(h.hasGenre).toBe(true)
    for (const tag of ['noir jazz', 'dark jazz', 'muted trumpet', 'upright bass', 'brushed drums', 'ambient', 'doom metal', 'Bohren und der Club of Gore', 'slow tempo'])
      expect(h.tags).toContain(tag)
    for (const drift of ['hip-hop', 'rap', 'pop', 'trumpet', 'jazz', 'metal']) expect(h.tags).not.toContain(drift)
    expect(h.bpm).toBe(70)
    expect(h.instrumental).toBe(true)
    expect(h.parts.eras).not.toContain('1990s') // "зародившаяся в 1990-х годах" is history, not a request
    expect(h.parts.refs).toEqual(['Bohren und der Club of Gore'])
    const caption = styleCaption(NOIR, h)
    expect(caption).toMatch(/^A slow, .* instrumental noir jazz piece blending .*dark jazz/)
    expect(caption).toContain('Featuring muted trumpet, upright bass, brushed drums and snare.')
    expect(caption).toContain('70 BPM')
  })

  it('detects vocals, tempo and explicit BPM', () => {
    const h = extractStyle('Грустная песня про осень, женский вокал, акустическая гитара, 84 bpm')
    expect(h.tags).toEqual(expect.arrayContaining(['sad', 'autumn', 'female vocals', 'acoustic guitar']))
    expect(h.tags).not.toContain('guitar')
    expect(h.instrumental).toBe(false)
    expect(h.bpm).toBe(84)
    expect(h.hasGenre).toBe(false)
    expect(styleCaption('Грустная песня про осень, женский вокал, акустическая гитара, 84 bpm', h)).toBe(
      'A sad, autumn song, 84 BPM. Featuring acoustic guitar. Female vocals.',
    )
  })

  it('avoids common false positives', () => {
    const h = extractStyle('Роковой урок: органичный трек с электрогитарой, текстура плотная, попытка сделать хорошо')
    expect(h.tags).not.toContain('rock')
    expect(h.tags).not.toContain('electro')
    expect(h.tags).not.toContain('organ')
    expect(h.tags).not.toContain('pop')
    expect(h.tags).toContain('electric guitar')
    expect(h.instrumental).toBeNull()
  })

  it('honours explicit instrumental requests and fast tempo', () => {
    const h = extractStyle('быстрый драм-н-бейс без вокала, синты и 808')
    expect(h.tags).toEqual(expect.arrayContaining(['fast tempo', 'drum and bass', 'synthesizer', '808 bass']))
    expect(h.instrumental).toBe(true)
    expect(h.bpm).toBe(140)
    expect(styleCaption('быстрый драм-н-бейс без вокала, синты и 808', h)).toBe('A fast instrumental drum and bass piece, 140 BPM. Featuring synthesizer and 808 bass.')
  })

  it('leaves English descriptions verbatim', () => {
    const text = 'slow dark jazz with a muted trumpet, no vocals'
    const h = extractStyle(text)
    expect(h.needsTranslation).toBe(false)
    expect(styleCaption(text, h)).toBe(text)
    expect(h.instrumental).toBe(true)
    expect(h.bpm).toBe(70)
  })
})
