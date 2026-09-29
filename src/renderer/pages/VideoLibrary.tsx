import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { Clapperboard, Download, FolderOpen, Heart, RotateCcw, Search, Trash2, X } from 'lucide-react'
import type { VideoClip } from '@shared/video'
import { clipSeconds } from '@shared/video'
import { useApp, attempt } from '../lib/store'
import { api, clipUrl } from '../lib/api'
import { useT } from '../i18n'
import { fmtBytes, fmtDate, fmtDuration } from '../lib/format'
import { Button, Chip, EmptyState, IconButton, PageHeader } from '../components/ui'

export function VideoLibraryPage() {
  const t = useT()
  const clips = useApp((s) => s.clips)
  const go = useApp((s) => s.go)
  const [q, setQ] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return clips.filter((c) => (!favOnly || c.favorite) && (!needle || `${c.title} ${c.params.prompt} ${c.params.model}`.toLowerCase().includes(needle)))
  }, [clips, q, favOnly])
  const current = clips.find((c) => c.id === open) ?? null
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title={t('video.library.title')}
        subtitle={t('video.library.subtitle', { n: clips.length })}
        right={
          <Button variant="soft" icon={<FolderOpen className="size-4" />} onClick={() => api.openVideoFolder()}>
            {t('video.library.folder')}
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="glass flex h-10 w-[320px] items-center gap-2.5 rounded-full px-4">
          <Search className="size-4 text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('video.library.search')} className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-dim" />
        </div>
        <Chip active={favOnly} onClick={() => setFavOnly(!favOnly)}>
          <Heart className="size-3.5" /> {t('video.library.favorites')}
        </Chip>
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<Clapperboard className="size-7" />}
          title={clips.length ? t('video.library.nothing') : t('video.library.empty')}
          hint={clips.length ? undefined : t('video.library.emptyHint')}
          action={
            !clips.length && (
              <Button variant="primary" icon={<Clapperboard className="size-4" />} onClick={() => go('video')}>
                {t('video.studio.create')}
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-3 gap-5 max-[1400px]:grid-cols-2 max-[900px]:grid-cols-1">
          {shown.map((c) => (
            <ClipCard key={c.id} clip={c} onOpen={() => setOpen(c.id)} />
          ))}
        </div>
      )}
      <AnimatePresence>{current && <ClipModal clip={current} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  )
}

/** Poster frame; plays muted on hover. */
export function ClipCard({ clip, onOpen, compact }: { clip: VideoClip; onOpen: () => void; compact?: boolean }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const ref = useRef<HTMLVideoElement>(null)
  const p = clip.params
  return (
    <div className="glass group overflow-hidden rounded-[22px]">
      <button
        className="no-drag relative block w-full bg-black/60"
        style={{ aspectRatio: `${p.width} / ${p.height}`, maxHeight: compact ? 220 : 360 }}
        onClick={onOpen}
        onMouseEnter={() => void ref.current?.play().catch(() => {})}
        onMouseLeave={() => {
          if (!ref.current) return
          ref.current.pause()
          ref.current.currentTime = 0.05
        }}
      >
        <video ref={ref} src={`${clipUrl(clip.id)}#t=0.05`} muted loop playsInline preload="metadata" className="absolute inset-0 size-full object-contain" />
        <span className="absolute right-2.5 bottom-2.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/90">{fmtDuration(clipSeconds(p.frames, p.fps))}</span>
        {clip.favorite && <Heart className="absolute top-2.5 right-2.5 size-4 fill-magenta text-magenta" />}
      </button>
      <div className="p-3.5">
        <div className="truncate font-display text-[14px] font-medium" title={clip.title}>
          {clip.title}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-[11.5px] text-dim">
          <span>{fmtDate(clip.createdAt, lang)}</span>
          <span>
            {p.width}×{p.height}
          </span>
          {!compact && <span className="max-w-[180px] truncate">{p.model.replace(/\.safetensors$/, '')}</span>}
          {clip.renderSeconds && !compact && <span>{t('video.clip.rendered', { t: fmtDuration(clip.renderSeconds) })}</span>}
        </div>
      </div>
    </div>
  )
}

function ClipModal({ clip, onClose }: { clip: VideoClip; onClose: () => void }) {
  const t = useT()
  const setVideoPrefill = useApp((s) => s.setVideoPrefill)
  const p = clip.params
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  const rows: [string, string][] = [
    [t('video.clip.model'), p.model],
    [t('video.clip.size'), `${p.width}×${p.height} · ${p.frames} ${t('video.clip.frames')} · ${p.fps} fps`],
    [t('video.clip.sampling'), `${p.steps} steps · CFG ${p.cfg} · shift ${p.shift} · ${p.sampler}/${p.scheduler}`],
    [t('video.clip.seed'), String(clip.seed)],
    [t('video.clip.file'), `${fmtBytes(clip.sizeBytes)}${clip.renderSeconds ? ` · ${t('video.clip.rendered', { t: fmtDuration(clip.renderSeconds) })}` : ''}`],
  ]
  if (p.loras.length) rows.splice(1, 0, ['LoRA', p.loras.map((l) => `${l.file} (${l.strength})`).join(', ')])
  // Portal: the page wrapper is transformed by its enter animation, which would re-anchor `fixed`.
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-8 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.97, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0 }}
        className="glass-strong flex max-h-full w-full max-w-[1180px] gap-5 overflow-hidden rounded-[26px] p-4 max-[1100px]:flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-[18px] bg-black">
          <video src={clipUrl(clip.id)} controls autoPlay loop className="max-h-[78vh] max-w-full" />
        </div>
        <div className="scroll-y flex w-[340px] shrink-0 flex-col max-[1100px]:w-full">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 font-display text-[17px] leading-snug font-semibold">{clip.title}</h3>
            <IconButton onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="label mt-4 mb-1">{t('video.studio.prompt')}</div>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-muted select-text">{p.prompt}</p>
          <div className="mt-4 space-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-3 text-[12.5px]">
                <span className="w-20 shrink-0 text-dim">{k}</span>
                <span className="min-w-0 break-all font-mono text-[12px] select-text">{v}</span>
              </div>
            ))}
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <Button size="sm" variant={clip.favorite ? 'soft' : 'ghost'} icon={<Heart className={clsx('size-3.5', clip.favorite && 'fill-magenta text-magenta')} />} onClick={() => attempt(() => api.clipUpdate(clip.id, { favorite: !clip.favorite }))}>
              {t('video.clip.favorite')}
            </Button>
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setVideoPrefill({ ...p, randomSeed: false })}>
              {t('video.clip.reuse')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => attempt(() => api.clipSaveAs(clip.id))}>
              {t('video.clip.saveAs')}
            </Button>
            <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => api.clipReveal(clip.id)}>
              {t('video.clip.reveal')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 className="size-3.5" />}
              onClick={async () => {
                if (!confirm(t('video.clip.confirmDelete'))) return
                onClose()
                await attempt(() => api.clipRemove(clip.id))
              }}
            >
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

export { ClipModal }
