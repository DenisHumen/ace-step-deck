import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { AnimatePresence } from 'motion/react'
import {
  CircleCheck,
  CircleX,
  Clapperboard,
  Clock,
  Copy,
  Dices,
  Download,
  Film,
  Loader2,
  Pause,
  Play,
  Plus,
  Ratio,
  RotateCcw,
  Settings2,
  Sparkles,
  Timer,
  Trash2,
  X,
} from 'lucide-react'
import type { VideoJob, VideoParams } from '@shared/video'
import { DEFAULT_VIDEO_PARAMS, VIDEO_FRAME_OPTIONS, VIDEO_SAMPLERS, VIDEO_SCHEDULERS, VIDEO_SIZES, WAN_NEGATIVE, clipCost, clipSeconds } from '@shared/video'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { fmtEta } from '../lib/format'
import { Badge, Button, Card, CardTitle, Collapsible, Field, IconButton, Orb, ProgressBar, Select, Slider, StatusDot, Stepper } from '../components/ui'
import { ClipCard, ClipModal } from './VideoLibrary'

interface Form {
  p: VideoParams
  count: number
}

const STORE_KEY = 'acedeck.video.v1'

function loadForm(defaultModel: string): Form {
  const base: Form = { p: { ...DEFAULT_VIDEO_PARAMS, model: defaultModel }, count: 1 }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')
    if (saved?.p) return { ...base, ...saved, p: { ...base.p, ...saved.p } }
  } catch {
    /* ignore */
  }
  return base
}

export function VideoStudioPage() {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const settings = useApp((s) => s.settings)
  const eng = useApp((s) => s.videoEngine)
  const models = useApp((s) => s.videoModels)
  const secondsPerCost = useApp((s) => s.videoQueue.secondsPerCost)
  const prefill = useApp((s) => s.videoPrefill)
  const go = useApp((s) => s.go)
  const [f, setF] = useState<Form>(() => loadForm(settings?.videoModel ?? DEFAULT_VIDEO_PARAMS.model))
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }))
  const setP = (patch: Partial<VideoParams>) => setF((x) => ({ ...x, p: { ...x.p, ...patch } }))
  const p = f.p

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(f))
  }, [f])
  useEffect(() => {
    if (!prefill) return
    setF((x) => ({ ...x, p: { ...x.p, ...prefill.params } }))
    useApp.setState({ videoPrefill: null })
  }, [prefill])

  const diffusion = models.filter((m) => m.kind === 'diffusion' && m.installed).map((m) => m.file)
  const loras = models.filter((m) => m.kind === 'lora' && m.installed).map((m) => m.file)
  // Fall back to the default model if the saved one was removed.
  useEffect(() => {
    if (diffusion.length && !diffusion.includes(p.model)) setP({ model: diffusion.includes(settings?.videoModel ?? '') ? settings!.videoModel : diffusion[0] })
  }, [diffusion.join('|')])

  const sizeId = VIDEO_SIZES.find((s) => s.w === p.width && s.h === p.height)?.id ?? 'custom'
  const estimate = secondsPerCost ? secondsPerCost * clipCost(p) * f.count : null

  const submit = async () => {
    if (!p.prompt.trim()) return useApp.getState().toast(t('video.studio.needPrompt'), 'err')
    const job = await attempt(() => api.videoQueueAdd({ params: p, count: f.count }))
    if (job) useApp.getState().toast(`${t('create.queued')} · ${job.title}`, 'ok')
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <div className="flex flex-col items-center pt-4 pb-7 text-center">
        <Orb size={62} />
        <h1 className="mt-5 font-display text-[36px] leading-tight font-semibold tracking-tight">{t('video.studio.title')}</h1>
        <p className="mt-2 max-w-xl text-[14.5px] text-balance text-muted">{t('video.studio.subtitle')}</p>
      </div>

      {eng && !eng.installed && (
        <Card className="mx-auto mb-6 flex max-w-[880px] flex-wrap items-center gap-4 !p-5">
          <Film className="size-6 text-cyan" />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-semibold">{t('video.studio.notInstalled')}</div>
            <div className="text-[13px] text-muted">{t('video.studio.notInstalledHint')}</div>
          </div>
          <Button variant="primary" icon={<Download className="size-4" />} onClick={() => go('videoEngine')}>
            {t('video.setup.install')}
          </Button>
        </Card>
      )}
      {eng?.musicPaused && <div className="mx-auto mb-5 max-w-[880px] rounded-2xl border border-amber/25 bg-amber/10 px-4 py-3 text-[13px] text-amber">{t('video.musicPaused')}</div>}

      <div className="mx-auto max-w-[880px]">
        <div className="glass rounded-[26px] p-2 shadow-[0_30px_80px_-40px_rgba(83,210,255,0.5)]">
          <div className="rounded-[20px] border border-white/[0.06] bg-ink-900/50 p-4">
            <textarea
              value={p.prompt}
              onChange={(e) => setP({ prompt: e.target.value })}
              placeholder={t('video.studio.placeholder')}
              rows={3}
              className="w-full resize-none bg-transparent text-[15.5px] leading-relaxed outline-none placeholder:text-dim"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
              }}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill icon={<Ratio className="size-3.5" />}>
                <select
                  className="bg-transparent pr-1 text-fg outline-none"
                  value={sizeId}
                  onChange={(e) => {
                    const s = VIDEO_SIZES.find((x) => x.id === e.target.value)
                    if (s) setP({ width: s.w, height: s.h })
                  }}
                >
                  {VIDEO_SIZES.map((s) => (
                    <option key={s.id} value={s.id} className="bg-ink-800">
                      {s.id.replace(' fast', ` · ${t('video.studio.fast')}`)} · {s.w}×{s.h}
                    </option>
                  ))}
                  {sizeId === 'custom' && (
                    <option value="custom" className="bg-ink-800">
                      {p.width}×{p.height}
                    </option>
                  )}
                </select>
              </Pill>
              <Pill icon={<Timer className="size-3.5" />}>
                <select className="bg-transparent pr-1 text-fg outline-none" value={p.frames} onChange={(e) => setP({ frames: Number(e.target.value) })}>
                  {VIDEO_FRAME_OPTIONS.map((n) => (
                    <option key={n} value={n} className="bg-ink-800">
                      {clipSeconds(n, p.fps).toFixed(clipSeconds(n, p.fps) % 1 ? 1 : 0)} {t('common.seconds')} · {n} {t('video.clip.frames')}
                    </option>
                  ))}
                  {!VIDEO_FRAME_OPTIONS.includes(p.frames) && (
                    <option value={p.frames} className="bg-ink-800">
                      {p.frames} {t('video.clip.frames')}
                    </option>
                  )}
                </select>
              </Pill>
              <Pill icon={<Film className="size-3.5" />}>
                <select className="max-w-[240px] bg-transparent pr-1 text-fg outline-none" value={p.model} onChange={(e) => setP({ model: e.target.value })}>
                  {(diffusion.length ? diffusion : [p.model]).map((m) => (
                    <option key={m} value={m} className="bg-ink-800">
                      {m.replace(/\.safetensors$/, '')}
                    </option>
                  ))}
                </select>
              </Pill>
              <div className="ml-auto flex items-center gap-2">
                {estimate && (
                  <span className="flex items-center gap-1 text-[12px] text-dim" title={t('video.studio.estimate')}>
                    <Clock className="size-3.5" />≈ {fmtEta(estimate, lang)}
                  </span>
                )}
                <Button variant="primary" icon={<Clapperboard className="size-4" />} disabled={!eng?.installed} onClick={submit}>
                  {t('video.studio.create')}
                  {f.count > 1 && <span className="rounded-full bg-white/20 px-1.5 text-[11px]">×{f.count}</span>}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-6 grid max-w-[880px] grid-cols-1 gap-5">
        <Card>
          <div className="flex flex-wrap items-end gap-6">
            <Field label={t('video.studio.count')}>
              <Stepper value={f.count} onChange={(count) => set({ count })} min={1} max={50} />
            </Field>
            <div className="w-48">
              <Field label={t('create.seed')}>
                <div className="flex items-center gap-2">
                  <input
                    className="field !w-32 font-mono"
                    disabled={p.randomSeed}
                    value={p.randomSeed ? '' : p.seed}
                    placeholder={t('create.seed.random')}
                    onChange={(e) => setP({ seed: Number(e.target.value.replace(/\D/g, '').slice(0, 15)) || 0 })}
                  />
                  <Button size="sm" variant={p.randomSeed ? 'soft' : 'ghost'} icon={<Dices className="size-3.5" />} onClick={() => setP({ randomSeed: !p.randomSeed, seed: p.randomSeed ? Math.floor(Math.random() * 1e9) : -1 })} />
                </div>
              </Field>
            </div>
            <p className="min-w-[220px] flex-1 text-[12px] text-dim">{t('video.studio.countHint')}</p>
          </div>
        </Card>
        <Card>
          <Collapsible title={<><Settings2 className="size-4" />{t('create.advanced')}</>}>
            <Advanced p={p} setP={setP} loras={loras} />
          </Collapsible>
        </Card>
      </div>

      <VideoQueueCard />
      <RecentClips />
    </div>
  )
}

function Pill({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="no-drag inline-flex h-8 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] pr-1 pl-3.5 text-[12.5px] text-muted">
      {icon}
      {children}
    </label>
  )
}

function Advanced({ p, setP, loras }: { p: VideoParams; setP: (x: Partial<VideoParams>) => void; loras: string[] }) {
  const t = useT()
  const unused = loras.filter((l) => !p.loras.some((x) => x.file === l))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 max-[1000px]:grid-cols-1">
        <Field label={t('video.adv.steps')} hint={t('video.adv.stepsHint')}>
          <Slider value={p.steps} min={4} max={60} onChange={(steps) => setP({ steps })} />
        </Field>
        <Field label="CFG" hint={t('video.adv.cfgHint')}>
          <Slider value={p.cfg} min={1} max={12} step={0.5} onChange={(cfg) => setP({ cfg })} format={(v) => v.toFixed(1)} />
        </Field>
        <Field label="Shift" hint={t('video.adv.shiftHint')}>
          <Slider value={p.shift} min={1} max={15} step={0.5} onChange={(shift) => setP({ shift })} format={(v) => v.toFixed(1)} />
        </Field>
        <Field label="FPS" hint={t('video.adv.fpsHint')}>
          <Slider value={p.fps} min={8} max={30} onChange={(fps) => setP({ fps })} />
        </Field>
        <Field label={t('video.adv.sampler')}>
          <Select value={p.sampler} onChange={(sampler) => setP({ sampler })} options={VIDEO_SAMPLERS.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label={t('video.adv.scheduler')}>
          <Select value={p.scheduler} onChange={(scheduler) => setP({ scheduler })} options={VIDEO_SCHEDULERS.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label={t('video.adv.width')}>
          <input className="field font-mono" value={p.width} onChange={(e) => setP({ width: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })} onBlur={() => setP({ width: snap16(p.width) })} />
        </Field>
        <Field label={t('video.adv.height')}>
          <input className="field font-mono" value={p.height} onChange={(e) => setP({ height: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })} onBlur={() => setP({ height: snap16(p.height) })} />
        </Field>
      </div>
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="label">{t('video.adv.negative')}</span>
          {p.negative !== WAN_NEGATIVE && (
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setP({ negative: WAN_NEGATIVE })}>
              {t('video.adv.negativeReset')}
            </Button>
          )}
        </div>
        <textarea className="field min-h-[84px] resize-y !text-[13px]" value={p.negative} onChange={(e) => setP({ negative: e.target.value })} />
        <p className="mt-1.5 text-[12px] text-dim">{t('video.adv.negativeHint')}</p>
      </div>
      <div>
        <div className="label mb-2">LoRA</div>
        {p.loras.length === 0 && !unused.length && <p className="text-[12.5px] text-dim">{t('video.adv.noLoras')}</p>}
        <div className="space-y-2.5">
          {p.loras.map((l, i) => (
            <div key={l.file} className="flex items-center gap-3">
              <span className="w-64 truncate font-mono text-[12.5px]" title={l.file}>
                {l.file}
              </span>
              <div className="flex-1">
                <Slider value={l.strength} min={-1} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(strength) => setP({ loras: p.loras.map((x, k) => (k === i ? { ...x, strength } : x)) })} />
              </div>
              <IconButton tone="danger" onClick={() => setP({ loras: p.loras.filter((_, k) => k !== i) })}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
        </div>
        {unused.length > 0 && p.loras.length < 4 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {unused.map((l) => (
              <button key={l} onClick={() => setP({ loras: [...p.loras, { file: l, strength: 1 }] })} className="inline-flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[11.5px] text-muted hover:bg-violet/20 hover:text-fg">
                <Plus className="size-3" /> {l.replace(/\.safetensors$/, '')}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const snap16 = (v: number) => Math.max(128, Math.min(1280, Math.round(v / 16) * 16))

// ─── Queue ───────────────────────────────────────────────────────────────────
function VideoQueueCard() {
  const t = useT()
  const q = useApp((s) => s.videoQueue)
  const active = q.jobs.filter((j) => j.status === 'pending' || j.status === 'running')
  const finished = q.jobs.filter((j) => j.status !== 'pending' && j.status !== 'running').slice(-6).reverse()
  if (!active.length && !finished.length) return null
  return (
    <Card className="mt-7">
      <CardTitle
        icon={<Sparkles className="size-4" />}
        right={
          <div className="flex items-center gap-1.5">
            {q.paused ? (
              <Button size="sm" variant="primary" icon={<Play className="size-3.5" />} onClick={() => api.videoQueueResume()}>
                {t('queue.resume')}
              </Button>
            ) : (
              <Button size="sm" variant="ghost" icon={<Pause className="size-3.5" />} disabled={!active.length} onClick={() => api.videoQueuePause()}>
                {t('queue.pause')}
              </Button>
            )}
            {finished.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => api.videoQueueClearFinished()}>
                {t('queue.clear')}
              </Button>
            )}
          </div>
        }
      >
        {t('video.queue.title')}
        {q.paused && (
          <span className="ml-2">
            <Badge tone="amber">{t('queue.paused')}</Badge>
          </span>
        )}
      </CardTitle>
      <div className="space-y-2">
        {[...active, ...finished].map((j) => (
          <JobRow key={j.id} job={j} />
        ))}
      </div>
    </Card>
  )
}

function JobRow({ job }: { job: VideoJob }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const p = job.spec.params
  const running = job.status === 'running'
  return (
    <div className={clsx('rounded-2xl border border-white/[0.06] px-4 py-3', running ? 'bg-white/[0.05]' : 'bg-white/[0.02]')}>
      <div className="flex items-center gap-3">
        {job.status === 'running' ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-magenta" />
        ) : job.status === 'done' ? (
          <CircleCheck className="size-4 shrink-0 text-mint" />
        ) : job.status === 'failed' ? (
          <CircleX className="size-4 shrink-0 text-rose" />
        ) : job.status === 'cancelled' ? (
          <CircleX className="size-4 shrink-0 text-dim" />
        ) : (
          <StatusDot tone="dim" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-medium" title={p.prompt}>
            {job.title}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11.5px] text-dim">
            <span>
              {p.width}×{p.height} · {p.frames} {t('video.clip.frames')} · {p.steps} steps
            </span>
            {job.spec.count > 1 && (
              <span>
                {job.clipsDone}/{job.spec.count} {t('video.queue.clips')}
              </span>
            )}
            <span className="truncate">{String(p.model).replace(/\.safetensors$/, '')}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {(job.status === 'pending' || running) && (
            <IconButton title={t('common.cancel')} onClick={() => api.videoQueueCancel(job.id)} disabled={job.cancelRequested}>
              <X className="size-4" />
            </IconButton>
          )}
          {(job.status === 'failed' || job.status === 'cancelled') && (
            <IconButton title={t('common.retry')} onClick={() => api.videoQueueRetry(job.id)}>
              <RotateCcw className="size-4" />
            </IconButton>
          )}
          <IconButton title={t('queue.duplicate')} onClick={() => attempt(() => api.videoQueueDuplicate(job.id))}>
            <Copy className="size-4" />
          </IconButton>
          {!running && job.status !== 'pending' && (
            <IconButton tone="danger" title={t('common.remove')} onClick={() => api.videoQueueRemove(job.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>
      {(running || job.status === 'pending') && (
        <div className="mt-2.5 flex items-center gap-3">
          <ProgressBar value={running ? job.progress : 0} thin className="flex-1" />
          <span className="w-[260px] shrink-0 truncate text-right text-[12px] text-muted">
            {job.cancelRequested ? t('video.stage.cancelling') : t(`video.stage.${job.stage}`)}
            {running && job.stage === 'sampling' && ` · ${job.step}/${job.steps}`}
            {running && job.etaSeconds ? ` · ${fmtEta(job.etaSeconds, lang)}` : ''}
          </span>
        </div>
      )}
      {job.status === 'failed' && job.error && <div className="mt-2 text-[12px] break-words text-rose/90">{job.error}</div>}
    </div>
  )
}

function RecentClips() {
  const t = useT()
  const clips = useApp((s) => s.clips)
  const go = useApp((s) => s.go)
  const [open, setOpen] = useState<string | null>(null)
  const recent = clips.slice(0, 6)
  const current = clips.find((c) => c.id === open) ?? null
  if (!recent.length) return null
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center">
        <h2 className="font-display text-[18px] font-semibold">{t('video.studio.recent')}</h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => go('videoLibrary')}>
          {t('video.studio.allClips')}
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-4 max-[1300px]:grid-cols-2">
        {recent.map((c) => (
          <ClipCard key={c.id} clip={c} compact onOpen={() => setOpen(c.id)} />
        ))}
      </div>
      <AnimatePresence>{current && <ClipModal clip={current} onClose={() => setOpen(null)} />}</AnimatePresence>
    </section>
  )
}
