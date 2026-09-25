import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  AudioLines,
  Brain,
  Dices,
  FileAudio,
  Layers,
  Mic2,
  Music,
  Paintbrush,
  Palette,
  Play,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  Wand,
  Disc3,
} from 'lucide-react'
import type { GenerationParams, TaskType } from '@shared/types'
import { DEFAULT_PARAMS, KEYS, LYRIC_TAGS, STYLE_PRESETS, TRACK_CLASSES, VOCAL_LANGUAGES } from '@shared/constants'
import { useApp, attempt } from '../lib/store'
import { api, fileUrl } from '../lib/api'
import { useT } from '../i18n'
import { fmtDuration, fmtEta } from '../lib/format'
import { isUp } from '../lib/engine-ui'
import { stageLabel } from '../lib/stage'
import { Button, Card, CardTitle, Chip, Collapsible, Field, Orb, ProgressBar, Segmented, Select, Slider, Stepper, Toggle, TrackCover, WaveBars } from '../components/ui'

type Mode = 'simple' | 'custom' | 'cover' | 'repaint' | 'stems'
type StemTask = 'extract' | 'lego' | 'complete'

interface Form {
  mode: Mode
  simple: string
  p: GenerationParams
  count: number
  batch: number
  stemTask: StemTask
  stemTrack: string
  stemClasses: string[]
}

const STORE_KEY = 'acedeck.create.v1'

function loadForm(): Form {
  const base: Form = { mode: 'simple', simple: '', p: { ...DEFAULT_PARAMS }, count: 1, batch: 1, stemTask: 'extract', stemTrack: 'vocals', stemClasses: ['drums', 'bass'] }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (saved) return { ...base, ...saved, p: { ...DEFAULT_PARAMS, ...saved.p } }
  } catch {
    /* ignore */
  }
  return base
}

export function CreatePage() {
  const t = useT()
  const settings = useApp((s) => s.settings)
  const engine = useApp((s) => s.engine)
  const models = useApp((s) => s.models)
  const prefill = useApp((s) => s.prefill)
  const [f, setF] = useState<Form>(loadForm)
  const [showStyles, setShowStyles] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const ready = isUp(engine?.state)

  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))
  const setP = (patch: Partial<GenerationParams>) => setF((x) => ({ ...x, p: { ...x.p, ...patch } }))

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(f))
  }, [f])

  // Library → "Reuse settings" / "Make a cover" / "Repaint".
  useEffect(() => {
    if (!prefill) return
    setF((x) => ({ ...x, mode: prefill.mode, p: { ...x.p, ...prefill.params } }))
    useApp.setState({ prefill: null })
  }, [prefill])

  const ditModels = models.filter((m) => m.kind === 'dit' && m.installed).map((m) => m.name)
  const lmModels = models.filter((m) => m.kind === 'lm' && m.installed).map((m) => m.name)
  const p = f.p
  const isTurbo = (p.model || settings?.ditModel || '').includes('turbo')

  const appendTag = (tag: string) => {
    if (f.mode === 'simple') set({ simple: f.simple ? `${f.simple.replace(/[,\s]+$/, '')}, ${tag}` : tag })
    else setP({ prompt: p.prompt ? `${p.prompt.replace(/[,\s]+$/, '')}, ${tag}` : tag })
  }

  const applySample = (s: import('@shared/types').SampleResult) => {
    setF((x) => ({
      ...x,
      mode: x.mode === 'simple' ? 'custom' : x.mode,
      p: {
        ...x.p,
        prompt: s.caption || x.p.prompt,
        lyrics: s.lyrics || x.p.lyrics,
        bpm: s.bpm ?? x.p.bpm,
        key_scale: s.key_scale || x.p.key_scale,
        time_signature: s.time_signature || x.p.time_signature,
        audio_duration: s.duration ?? x.p.audio_duration,
        vocal_language: s.vocal_language || x.p.vocal_language,
        instrumental: x.p.instrumental,
      },
    }))
  }

  const ai = async (kind: 'draft' | 'enhance' | 'random') => {
    setAiBusy(kind)
    const r = await attempt(() =>
      kind === 'draft'
        ? api.aiCreateSample(f.mode === 'simple' ? f.simple : p.prompt, p.instrumental, p.vocal_language)
        : kind === 'enhance'
          ? api.aiFormat(p.prompt, p.lyrics, { duration: p.audio_duration, bpm: p.bpm, key: p.key_scale, time_signature: p.time_signature, language: p.vocal_language })
          : api.aiRandom('custom_mode'),
    )
    setAiBusy(null)
    if (r) applySample(r)
  }

  const buildParams = (): Partial<GenerationParams> | string => {
    const common: Partial<GenerationParams> = { ...p }
    switch (f.mode) {
      case 'simple':
        if (!f.simple.trim()) return t('create.needCaption')
        return { ...common, task_type: 'text2music', sample_mode: true, sample_query: f.simple.trim(), prompt: '', lyrics: '', thinking: true }
      case 'custom':
        if (!p.prompt.trim() && !p.lyrics.trim()) return t('create.needCaption')
        return { ...common, task_type: 'text2music', sample_mode: false, sample_query: '' }
      case 'cover':
        if (!p.src_audio_path) return t('create.needSource')
        return { ...common, task_type: 'cover', sample_mode: false, sample_query: '' }
      case 'repaint':
        if (!p.src_audio_path) return t('create.needSource')
        return { ...common, task_type: 'repaint', sample_mode: false, sample_query: '' }
      case 'stems': {
        if (!p.src_audio_path) return t('create.needSource')
        const task: TaskType = f.stemTask
        return {
          ...common,
          task_type: task,
          model: 'acestep-v15-base',
          sample_mode: false,
          sample_query: '',
          track_name: task === 'complete' ? null : f.stemTrack,
          track_classes: task === 'complete' ? f.stemClasses : null,
        }
      }
    }
  }

  const submit = async () => {
    const params = buildParams()
    if (typeof params === 'string') return useApp.getState().toast(params, 'err')
    const job = await attempt(() => api.queueAdd({ params, count: f.count, batchSize: f.batch, title: f.mode === 'simple' ? f.simple : undefined }))
    if (job) useApp.getState().toast(`${t('create.queued')} · ${job.title}`, 'ok')
  }

  const modeOptions: { value: Mode; label: string; icon: React.ReactNode }[] = [
    { value: 'simple', label: t('create.mode.simple'), icon: <Sparkles className="size-3.5" /> },
    { value: 'custom', label: t('create.mode.custom'), icon: <SlidersHorizontal className="size-3.5" /> },
    { value: 'cover', label: t('create.mode.cover'), icon: <Disc3 className="size-3.5" /> },
    { value: 'repaint', label: t('create.mode.repaint'), icon: <Paintbrush className="size-3.5" /> },
    { value: 'stems', label: t('create.mode.stems'), icon: <Layers className="size-3.5" /> },
  ]

  return (
    <div className="mx-auto max-w-[1180px]">
      {/* Hero */}
      <div className="flex flex-col items-center pt-4 pb-7 text-center">
        <Orb size={62} />
        <h1 className="mt-5 font-display text-[36px] leading-tight font-semibold tracking-tight">{t('create.hero.title')}</h1>
        <p className="mt-2 max-w-xl text-[14.5px] text-muted text-balance">{t('create.hero.subtitle')}</p>
        <Segmented className="mt-6" value={f.mode} onChange={(mode) => set({ mode })} options={modeOptions} />
      </div>

      {/* Prompt card */}
      <div className="mx-auto max-w-[880px]">
        <div className="glass rounded-[26px] p-2 shadow-[0_30px_80px_-40px_rgba(240,67,198,0.55)]">
          <div className="rounded-[20px] border border-white/[0.06] bg-ink-900/50 p-4">
            {f.mode === 'simple' ? (
              <textarea
                value={f.simple}
                onChange={(e) => set({ simple: e.target.value })}
                placeholder={t('create.simple.placeholder')}
                rows={3}
                className="w-full resize-none bg-transparent text-[15.5px] leading-relaxed outline-none placeholder:text-dim"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
                }}
              />
            ) : (
              <>
                <div className="label mb-1.5">{t('create.caption')}</div>
                <textarea
                  value={p.prompt}
                  onChange={(e) => setP({ prompt: e.target.value })}
                  placeholder={t('create.caption.placeholder')}
                  rows={2}
                  className="w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-dim"
                />
              </>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip active={showStyles} onClick={() => setShowStyles(!showStyles)}>
                <Palette className="size-3.5" /> {t('create.styles')}
              </Chip>
              {f.mode !== 'stems' && (
                <Chip active={p.instrumental} onClick={() => setP({ instrumental: !p.instrumental })}>
                  <Music className="size-3.5" /> {t('create.instrumental')}
                  <span className={clsx('ml-1 inline-block h-3.5 w-6 rounded-full p-[2px] transition-colors', p.instrumental ? 'bg-magenta' : 'bg-white/15')}>
                    <span className={clsx('block size-2.5 rounded-full bg-white transition-transform', p.instrumental && 'translate-x-2.5')} />
                  </span>
                </Chip>
              )}
              <label className="no-drag inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] pr-1 pl-3.5 text-[12.5px] text-muted">
                <Mic2 className="size-3.5" />
                <select className="bg-transparent pr-1 text-fg outline-none" value={p.vocal_language} onChange={(e) => setP({ vocal_language: e.target.value })}>
                  {VOCAL_LANGUAGES.map((l) => (
                    <option key={l} value={l} className="bg-ink-800">
                      {l === 'unknown' ? t('common.auto') : l.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label className="no-drag inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] pr-1 pl-3.5 text-[12.5px] text-muted">
                <AudioLines className="size-3.5" />
                <select
                  className="bg-transparent pr-1 text-fg outline-none"
                  value={p.audio_duration ?? 0}
                  onChange={(e) => setP({ audio_duration: Number(e.target.value) || null })}
                >
                  {[0, 30, 60, 90, 120, 150, 180, 240, 300].map((d) => (
                    <option key={d} value={d} className="bg-ink-800">
                      {d ? fmtDuration(d) : t('common.auto')}
                    </option>
                  ))}
                  {p.audio_duration && ![30, 60, 90, 120, 150, 180, 240, 300].includes(p.audio_duration) && (
                    <option value={p.audio_duration} className="bg-ink-800">
                      {fmtDuration(p.audio_duration)}
                    </option>
                  )}
                </select>
              </label>
              <div className="ml-auto flex items-center gap-2">
                {(f.mode === 'simple' || f.mode === 'custom') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Wand2 className="size-3.5" />}
                    loading={aiBusy === 'draft'}
                    disabled={!ready || !(f.mode === 'simple' ? f.simple : p.prompt).trim()}
                    title={ready ? t('create.aiDraft.hint') : t('create.aiNeedsEngine')}
                    onClick={() => ai('draft')}
                  >
                    {t('create.aiDraft')}
                  </Button>
                )}
                <Button variant="primary" icon={<Music className="size-4" />} onClick={submit}>
                  {t('create.create')}
                  {f.count > 1 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">×{f.count}</span>}
                </Button>
              </div>
            </div>
          </div>
          {showStyles && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 pt-4 pb-3">
              {Object.entries(STYLE_PRESETS).map(([group, tags]) => (
                <div key={group}>
                  <div className="label mb-2">{group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tags.map((tag) => (
                      <button key={tag} onClick={() => appendTag(tag)} className="rounded-full bg-white/[0.05] px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-orchid/20 hover:text-fg">
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detailed panels */}
      {f.mode !== 'simple' && (
        <div className="mt-6 grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-5 max-[1320px]:grid-cols-1">
          <div className="space-y-5">
            {(f.mode === 'cover' || f.mode === 'repaint' || f.mode === 'stems') && <SourceCard f={f} set={set} setP={setP} />}
            {f.mode !== 'stems' && <LyricsCard p={p} setP={setP} ready={ready} aiBusy={aiBusy} ai={ai} />}
          </div>
          <div className="space-y-5">
            <SongCard p={p} setP={setP} />
            <ModelCard p={p} setP={setP} ditModels={ditModels} lmModels={lmModels} isTurbo={isTurbo} defaultDit={settings?.ditModel ?? ''} defaultLm={settings?.lmModel ?? ''} />
          </div>
        </div>
      )}

      {/* Output + advanced */}
      <div className={clsx('grid gap-5', f.mode === 'simple' ? 'mx-auto mt-6 max-w-[880px] grid-cols-1' : 'mt-5 grid-cols-1')}>
        <Card>
          <div className="flex flex-wrap items-end gap-6">
            <Field label={t('create.count')}>
              <Stepper value={f.count} onChange={(count) => set({ count, batch: Math.min(f.batch, count) })} min={1} max={100} />
            </Field>
            <Field label={t('create.batch')}>
              <Stepper value={f.batch} onChange={(batch) => set({ batch })} min={1} max={Math.min(4, f.count)} />
            </Field>
            <Field label={t('create.format')} className="w-36">
              <Select value={p.audio_format} onChange={(audio_format) => setP({ audio_format })} options={['mp3', 'flac', 'wav', 'wav32', 'opus', 'aac'].map((v) => ({ value: v as any, label: v.toUpperCase() }))} />
            </Field>
            <div className="w-48">
              <Field label={t('create.seed')}>
                <div className="flex items-center gap-2">
                  <input
                    className="field !w-28 font-mono"
                    disabled={p.use_random_seed}
                    value={p.use_random_seed ? '' : p.seed}
                    placeholder={t('create.seed.random')}
                    onChange={(e) => setP({ seed: Number(e.target.value.replace(/\D/g, '')) || 0 })}
                  />
                  <Button size="sm" variant={p.use_random_seed ? 'soft' : 'ghost'} icon={<Dices className="size-3.5" />} onClick={() => setP({ use_random_seed: !p.use_random_seed, seed: p.use_random_seed ? Math.floor(Math.random() * 1e6) : -1 })} />
                </div>
              </Field>
            </div>
            {f.mode !== 'simple' && (
              <Button variant="primary" size="lg" className="ml-auto" icon={<Music className="size-4" />} onClick={submit}>
                {t('create.create')}
                {f.count > 1 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">×{f.count}</span>}
              </Button>
            )}
          </div>
          <p className="mt-3 text-[12px] text-dim">{t('create.batch.hint')}</p>
        </Card>
        {f.mode !== 'simple' && (
          <Card>
            <Collapsible title={<><Settings2 className="size-4" />{t('create.advanced')}</>}>
              <AdvancedPanel p={p} setP={setP} />
            </Collapsible>
          </Card>
        )}
      </div>

      <LiveStrip />
      <RecentCreations />
    </div>
  )
}

// ─── Panels ──────────────────────────────────────────────────────────────────
function LyricsCard({ p, setP, ready, aiBusy, ai }: { p: GenerationParams; setP: (x: Partial<GenerationParams>) => void; ready: boolean; aiBusy: string | null; ai: (k: 'draft' | 'enhance' | 'random') => void }) {
  const t = useT()
  const insert = (tag: string) => setP({ lyrics: `${p.lyrics}${p.lyrics && !p.lyrics.endsWith('\n') ? '\n\n' : ''}${tag}\n` })
  return (
    <Card>
      <CardTitle
        icon={<Mic2 className="size-4" />}
        right={
          <div className="flex gap-1.5">
            <Button size="sm" variant="ghost" icon={<Wand className="size-3.5" />} disabled={!ready} loading={aiBusy === 'enhance'} title={ready ? '' : t('create.aiNeedsEngine')} onClick={() => ai('enhance')}>
              {t('create.aiEnhance')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Dices className="size-3.5" />} disabled={!ready} loading={aiBusy === 'random'} title={ready ? '' : t('create.aiNeedsEngine')} onClick={() => ai('random')}>
              {t('create.aiRandom')}
            </Button>
          </div>
        }
      >
        {t('create.lyrics')}
      </CardTitle>
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {LYRIC_TAGS.map((tag) => (
          <button key={tag} onClick={() => insert(tag)} className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[11.5px] text-muted hover:bg-violet/20 hover:text-fg">
            {tag}
          </button>
        ))}
      </div>
      <textarea
        className="field console min-h-[300px] resize-y !text-[13px] !leading-relaxed"
        value={p.instrumental ? '' : p.lyrics}
        disabled={p.instrumental}
        onChange={(e) => setP({ lyrics: e.target.value })}
        placeholder={p.instrumental ? t('create.instrumental') : t('create.lyrics.placeholder')}
      />
    </Card>
  )
}

function SongCard({ p, setP }: { p: GenerationParams; setP: (x: Partial<GenerationParams>) => void }) {
  const t = useT()
  const durAuto = !p.audio_duration
  return (
    <Card>
      <CardTitle icon={<Music className="size-4" />}>{t('create.song')}</CardTitle>
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center">
            <span className="label">{t('create.duration')}</span>
            <div className="ml-auto">
              <Chip active={durAuto} onClick={() => setP({ audio_duration: durAuto ? 120 : null })} className="!h-6 !px-2.5 !text-[11px]">
                {t('common.auto')}
              </Chip>
            </div>
          </div>
          <Slider value={p.audio_duration ?? 120} min={10} max={600} step={5} disabled={durAuto} onChange={(v) => setP({ audio_duration: v })} format={(v) => (durAuto ? t('common.auto') : fmtDuration(v))} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('create.bpm')}>
            <input className="field font-mono" placeholder={t('common.auto')} value={p.bpm ?? ''} onChange={(e) => setP({ bpm: Number(e.target.value.replace(/\D/g, '')) || null })} />
          </Field>
          <Field label={t('create.key')}>
            <Select value={p.key_scale} onChange={(key_scale) => setP({ key_scale })} options={[{ value: '', label: t('common.auto') }, ...KEYS.map((k) => ({ value: k, label: k }))]} />
          </Field>
          <Field label={t('create.timesig')}>
            <Select value={p.time_signature} onChange={(time_signature) => setP({ time_signature })} options={[{ value: '', label: t('common.auto') }, { value: '2', label: '2/4' }, { value: '3', label: '3/4' }, { value: '4', label: '4/4' }, { value: '6', label: '6/8' }]} />
          </Field>
          <Field label={t('create.language')}>
            <Select value={p.vocal_language} onChange={(vocal_language) => setP({ vocal_language })} options={VOCAL_LANGUAGES.map((l) => ({ value: l, label: l === 'unknown' ? t('common.auto') : l.toUpperCase() }))} />
          </Field>
        </div>
      </div>
    </Card>
  )
}

function ModelCard({ p, setP, ditModels, lmModels, isTurbo, defaultDit, defaultLm }: { p: GenerationParams; setP: (x: Partial<GenerationParams>) => void; ditModels: string[]; lmModels: string[]; isTurbo: boolean; defaultDit: string; defaultLm: string }) {
  const t = useT()
  const dits = [...new Set([defaultDit, ...ditModels].filter(Boolean))]
  const lms = [...new Set([defaultLm, ...lmModels].filter(Boolean))]
  return (
    <Card>
      <CardTitle icon={<Brain className="size-4" />}>{t('create.model')}</CardTitle>
      <div className="space-y-4">
        <Field label={t('create.dit')}>
          <Select value={p.model || defaultDit} onChange={(model) => setP({ model, inference_steps: model.includes('turbo') ? 8 : 50 })} options={dits.map((m) => ({ value: m, label: m }))} />
        </Field>
        <Toggle checked={p.thinking} onChange={(thinking) => setP({ thinking })} label={t('create.thinking')} hint={t('create.thinking.hint')} />
        {p.thinking && (
          <Field label={t('create.lm')}>
            <Select value={p.lm_model_path || defaultLm} onChange={(lm_model_path) => setP({ lm_model_path })} options={lms.map((m) => ({ value: m, label: m }))} />
          </Field>
        )}
        <Field label={t('create.steps')}>
          <Slider value={p.inference_steps} min={1} max={isTurbo ? 20 : 100} onChange={(inference_steps) => setP({ inference_steps })} />
        </Field>
        {!isTurbo && (
          <Field label={t('create.guidance')}>
            <Slider value={p.guidance_scale} min={1} max={15} step={0.5} onChange={(guidance_scale) => setP({ guidance_scale })} format={(v) => v.toFixed(1)} />
          </Field>
        )}
      </div>
    </Card>
  )
}

function SourceCard({ f, set, setP }: { f: Form; set: (x: Partial<Form>) => void; setP: (x: Partial<GenerationParams>) => void }) {
  const t = useT()
  const p = f.p
  const src = p.src_audio_path
  return (
    <Card>
      <CardTitle icon={<FileAudio className="size-4" />}>{t('create.source')}</CardTitle>
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
        <TrackCover id={src ?? 'none'} className="size-12 shrink-0" rounded="rounded-xl">
          <div className="absolute inset-0 flex items-center justify-center">
            <AudioLines className="size-5 text-white/90" />
          </div>
        </TrackCover>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]">{src ? src.split(/[\\/]/).pop() : t('create.source.none')}</div>
          {src && <div className="truncate text-[11.5px] text-dim">{src}</div>}
        </div>
        <Button size="sm" variant="soft" onClick={async () => { const path = await api.pickAudio(); if (path) setP({ src_audio_path: path }) }}>
          {t('create.source.pick')}
        </Button>
      </div>
      {src && <audio className="mt-3 h-9 w-full opacity-80" controls src={fileUrl(src)} />}

      {f.mode === 'cover' && (
        <div className="mt-5 space-y-4">
          <Field label={t('create.strength')} hint={t('create.strength.hint')}>
            <Slider value={p.audio_cover_strength} min={0} max={1} step={0.05} onChange={(audio_cover_strength) => setP({ audio_cover_strength })} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label={t('create.coverNoise')}>
            <Slider value={p.cover_noise_strength ?? 0} min={0} max={1} step={0.05} onChange={(cover_noise_strength) => setP({ cover_noise_strength })} format={(v) => v.toFixed(2)} />
          </Field>
        </div>
      )}
      {f.mode === 'repaint' && (
        <div className="mt-5 space-y-4">
          <div className="label">{t('create.repaintRange')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('create.repaintStart')}>
              <input className="field font-mono" value={p.repainting_start} onChange={(e) => setP({ repainting_start: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={t('create.repaintEnd')}>
              <input className="field font-mono" value={p.repainting_end ?? -1} onChange={(e) => setP({ repainting_end: Number(e.target.value) })} />
            </Field>
            <Field label={t('create.repaintMode')}>
              <Select value={p.repaint_mode ?? 'balanced'} onChange={(repaint_mode) => setP({ repaint_mode })} options={['conservative', 'balanced', 'aggressive'].map((v) => ({ value: v as any, label: v }))} />
            </Field>
            <Field label={t('create.repaintStrength')}>
              <Slider value={p.repaint_strength ?? 0.5} min={0} max={1} step={0.05} onChange={(repaint_strength) => setP({ repaint_strength })} format={(v) => v.toFixed(2)} />
            </Field>
          </div>
        </div>
      )}
      {f.mode === 'stems' && (
        <div className="mt-5 space-y-4">
          <Field label={t('create.stemsTask')}>
            <Segmented value={f.stemTask} onChange={(stemTask) => set({ stemTask })} options={(['extract', 'lego', 'complete'] as const).map((v) => ({ value: v, label: t(`create.stems.${v}`) }))} />
          </Field>
          {f.stemTask === 'complete' ? (
            <div className="flex flex-wrap gap-1.5">
              {TRACK_CLASSES.map((c) => (
                <Chip key={c} active={f.stemClasses.includes(c)} onClick={() => set({ stemClasses: f.stemClasses.includes(c) ? f.stemClasses.filter((x) => x !== c) : [...f.stemClasses, c] })}>
                  {c}
                </Chip>
              ))}
            </div>
          ) : (
            <Field label={t('create.stems.track')}>
              <Select value={f.stemTrack} onChange={(stemTrack) => set({ stemTrack })} options={TRACK_CLASSES.map((c) => ({ value: c, label: c }))} />
            </Field>
          )}
          <Field label={t('create.caption')}>
            <input className="field" value={p.prompt} onChange={(e) => setP({ prompt: e.target.value })} placeholder={t('create.caption.placeholder')} />
          </Field>
          <p className="rounded-xl bg-amber/10 px-3 py-2 text-[12.5px] text-amber">{t('create.stems.baseHint')}</p>
        </div>
      )}
    </Card>
  )
}

function AdvancedPanel({ p, setP }: { p: GenerationParams; setP: (x: Partial<GenerationParams>) => void }) {
  const t = useT()
  return (
    <div className="grid grid-cols-3 gap-x-6 gap-y-5 max-[1320px]:grid-cols-2">
      <Field label={t('create.inferMethod')}>
        <Select value={p.infer_method} onChange={(infer_method) => setP({ infer_method })} options={[{ value: 'ode', label: 'ODE (deterministic)' }, { value: 'sde', label: 'SDE (stochastic)' }]} />
      </Field>
      <Field label={t('create.shift')}>
        <Slider value={p.shift ?? 3} min={1} max={5} step={0.5} onChange={(shift) => setP({ shift })} format={(v) => v.toFixed(1)} />
      </Field>
      <Field label={t('create.cfgInterval')}>
        <div className="flex items-center gap-2">
          <input className="field font-mono" value={p.cfg_interval_start} onChange={(e) => setP({ cfg_interval_start: Number(e.target.value) || 0 })} />
          <span className="text-dim">–</span>
          <input className="field font-mono" value={p.cfg_interval_end} onChange={(e) => setP({ cfg_interval_end: Number(e.target.value) || 1 })} />
        </div>
      </Field>
      <Field label={t('create.lmTemp')}>
        <Slider value={p.lm_temperature} min={0.1} max={2} step={0.05} onChange={(lm_temperature) => setP({ lm_temperature })} format={(v) => v.toFixed(2)} />
      </Field>
      <Field label={t('create.lmCfg')}>
        <Slider value={p.lm_cfg_scale} min={1} max={5} step={0.1} onChange={(lm_cfg_scale) => setP({ lm_cfg_scale })} format={(v) => v.toFixed(1)} />
      </Field>
      <Field label={t('create.lmTopP')}>
        <Slider value={p.lm_top_p ?? 0.9} min={0.1} max={1} step={0.05} onChange={(lm_top_p) => setP({ lm_top_p })} format={(v) => v.toFixed(2)} />
      </Field>
      <Field label={t('create.lmTopK')}>
        <input className="field font-mono" placeholder={t('common.none')} value={p.lm_top_k ?? ''} onChange={(e) => setP({ lm_top_k: Number(e.target.value.replace(/\D/g, '')) || null })} />
      </Field>
      <Field label={t('create.lmRep')}>
        <Slider value={p.lm_repetition_penalty} min={1} max={2} step={0.05} onChange={(lm_repetition_penalty) => setP({ lm_repetition_penalty })} format={(v) => v.toFixed(2)} />
      </Field>
      <Field label={t('create.negative')}>
        <input className="field" value={p.lm_negative_prompt} onChange={(e) => setP({ lm_negative_prompt: e.target.value })} />
      </Field>
      <div className="col-span-full grid grid-cols-3 gap-4 pt-1 max-[1320px]:grid-cols-2">
        <Toggle checked={p.use_adg} onChange={(use_adg) => setP({ use_adg })} label={t('create.adg')} />
        <Toggle checked={p.use_cot_caption} onChange={(use_cot_caption) => setP({ use_cot_caption })} label={t('create.cotCaption')} />
        <Toggle checked={p.use_cot_language} onChange={(use_cot_language) => setP({ use_cot_language })} label={t('create.cotLanguage')} />
        <Toggle checked={p.constrained_decoding} onChange={(constrained_decoding) => setP({ constrained_decoding })} label={t('create.constrained')} />
        <Toggle checked={p.use_format} onChange={(use_format) => setP({ use_format })} label={t('create.useFormat')} />
      </div>
      <div className="col-span-full">
        <Field label={t('create.reference')}>
          <div className="flex items-center gap-2">
            <input className="field" readOnly value={p.reference_audio_path ?? ''} placeholder={t('create.source.none')} />
            <Button size="sm" variant="soft" onClick={async () => { const path = await api.pickAudio(); if (path) setP({ reference_audio_path: path }) }}>
              {t('common.browse')}
            </Button>
            {p.reference_audio_path && (
              <Button size="sm" variant="ghost" onClick={() => setP({ reference_audio_path: null })}>
                {t('common.clear')}
              </Button>
            )}
          </div>
        </Field>
      </div>
    </div>
  )
}

/** Live progress of the running job right on the Create page. */
function LiveStrip() {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const job = useApp((s) => s.queue.jobs.find((j) => j.status === 'running'))
  const pending = useApp((s) => s.queue.jobs.filter((j) => j.status === 'pending').length)
  const go = useApp((s) => s.go)
  if (!job) return null
  return (
    <button onClick={() => go('queue')} className="glass mt-6 flex w-full items-center gap-4 rounded-[22px] p-4 text-left transition-colors hover:bg-white/[0.06]">
      <TrackCover id={job.id} className="size-14 shrink-0">
        <div className="absolute inset-x-2 bottom-2 h-5">
          <WaveBars count={10} seed={job.id} />
        </div>
      </TrackCover>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="label !text-magenta">{t('queue.now')}</span>
          {pending > 0 && <span className="text-[11.5px] text-dim">+{pending} {t('queue.upNext').toLowerCase()}</span>}
        </div>
        <div className="truncate font-display text-[15px] font-semibold">{job.title}</div>
        <div className="mt-2 flex items-center gap-3">
          <ProgressBar value={job.progress} className="flex-1" />
          <span className="w-12 text-right font-mono text-[12px] text-muted">{Math.round(job.progress * 100)}%</span>
        </div>
        <div className="mt-1 truncate text-[12px] text-dim">
          {stageLabel(job.stage, t)} · {t('queue.songs', { done: job.songsDone, total: job.spec.count, n: job.spec.count })}
          {job.etaSeconds ? ` · ${t('queue.eta', { t: fmtEta(job.etaSeconds, lang) })}` : ''}
        </div>
      </div>
    </button>
  )
}

function RecentCreations() {
  const t = useT()
  const tracks = useApp((s) => s.tracks)
  const play = useApp((s) => s.play)
  const recent = useMemo(() => tracks.slice(0, 10), [tracks])
  return (
    <div className="mt-9">
      <div className="mb-4 flex items-center">
        <h2 className="font-display text-[17px] font-semibold">{t('create.recent')}</h2>
      </div>
      {recent.length === 0 ? (
        <div className="glass flex h-40 items-center justify-center rounded-[22px] text-muted">{t('create.recent.empty')}</div>
      ) : (
        <div className="-mx-2 flex gap-4 overflow-x-auto px-2 pb-3">
          {recent.map((tr) => (
            <button key={tr.id} onClick={() => play(tr.id, recent.map((x) => x.id))} className="group w-[190px] shrink-0 text-left">
              <TrackCover id={tr.id} className="aspect-[4/5] w-full shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:rotate-[-1deg]">
                <span className="absolute top-3 left-3 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white/90 uppercase backdrop-blur">{t(`library.badge.${tr.taskType}`)}</span>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-10">
                  <div className="truncate font-display text-[14px] font-semibold text-white">{tr.title}</div>
                  <div className="truncate text-[11.5px] text-white/65">{[tr.bpm && `${tr.bpm} BPM`, tr.keyscale, fmtDuration(tr.durationSec)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-white/90 text-ink-900 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  <Play className="ml-0.5 size-4" fill="currentColor" />
                </div>
              </TrackCover>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
