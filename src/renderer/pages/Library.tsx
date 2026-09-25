import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { Disc3, Download, FolderOpen, Heart, Library as LibraryIcon, Paintbrush, Pause, Play, RefreshCcw, Trash2, X, Sparkles } from 'lucide-react'
import type { Track } from '@shared/types'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { fmtBytes, fmtDate, fmtDuration } from '../lib/format'
import { Badge, Button, Chip, EmptyState, IconButton, PageHeader, Segmented, TrackCover, WaveBars } from '../components/ui'

type Filter = 'all' | 'fav'
type Sort = 'new' | 'old' | 'title'

export function LibraryPage() {
  const t = useT()
  const tracks = useApp((s) => s.tracks)
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const outputDir = useApp((s) => s.settings?.outputDir ?? '')
  const player = useApp((s) => s.player)
  const play = useApp((s) => s.play)
  const setPlaying = useApp((s) => s.setPlaying)
  const go = useApp((s) => s.go)
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('new')
  const [type, setType] = useState<string>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let l = tracks.filter(
      (x) =>
        (filter === 'all' || x.favorite) &&
        (type === 'all' || x.taskType === type) &&
        (!q || `${x.title} ${x.caption} ${x.lyrics} ${x.genres}`.toLowerCase().includes(q)),
    )
    if (sort === 'old') l = l.slice().reverse()
    if (sort === 'title') l = l.slice().sort((a, b) => a.title.localeCompare(b.title))
    return l
  }, [tracks, search, filter, sort, type])

  const types = [...new Set(tracks.map((x) => x.taskType))]
  const open = tracks.find((x) => x.id === openId) ?? null

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title={t('library.title')}
        subtitle={t('library.subtitle', { dir: outputDir })}
        right={
          <Button variant="glass" icon={<FolderOpen className="size-4" />} onClick={() => api.openLibraryFolder()}>
            {t('library.openFolder')}
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `${t('library.filter.all')} · ${tracks.length}` },
            { value: 'fav', label: t('library.filter.fav'), icon: <Heart className="size-3.5" /> },
          ]}
        />
        {types.length > 1 && (
          <div className="flex gap-1.5">
            <Chip active={type === 'all'} onClick={() => setType('all')}>
              {t('common.all')}
            </Chip>
            {types.map((ty) => (
              <Chip key={ty} active={type === ty} onClick={() => setType(ty)}>
                {ty}
              </Chip>
            ))}
          </div>
        )}
        {search && (
          <Chip active onClick={() => setSearch('')}>
            “{search}” <X className="size-3" />
          </Chip>
        )}
        <div className="ml-auto">
          <Segmented
            value={sort}
            onChange={setSort}
            options={[
              { value: 'new', label: t('library.sort.new') },
              { value: 'old', label: t('library.sort.old') },
              { value: 'title', label: t('library.sort.title') },
            ]}
          />
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon className="size-7" />}
          title={t('library.empty')}
          hint={t('library.empty.hint')}
          action={
            <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => go('create')}>
              {t('nav.create')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-5">
          {list.map((tr) => {
            const isCurrent = player.trackId === tr.id
            return (
              <div key={tr.id} className="group">
                <TrackCover id={tr.id} className="aspect-square w-full cursor-pointer shadow-[0_24px_40px_-24px_rgba(0,0,0,0.9)] transition-transform duration-300 group-hover:-translate-y-1">
                  <button className="absolute inset-0" onClick={() => setOpenId(tr.id)} />
                  <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-white/90 uppercase backdrop-blur">
                    {tr.format}
                  </span>
                  <button
                    onClick={() => attempt(() => api.trackUpdate(tr.id, { favorite: !tr.favorite }))}
                    className={clsx('absolute top-2.5 right-2.5 flex size-8 items-center justify-center rounded-full bg-black/30 backdrop-blur transition-opacity', tr.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
                  >
                    <Heart className={clsx('size-4', tr.favorite ? 'fill-magenta text-magenta' : 'text-white')} />
                  </button>
                  <div className="pointer-events-none absolute inset-x-3 bottom-3 h-8 opacity-80">
                    <WaveBars count={22} seed={tr.id} active={isCurrent && player.playing} />
                  </div>
                  <button
                    onClick={() => (isCurrent ? setPlaying(!player.playing) : play(tr.id, list.map((x) => x.id)))}
                    className={clsx(
                      'absolute right-3 bottom-3 flex size-11 items-center justify-center rounded-full bg-white text-ink-900 shadow-xl transition-all',
                      isCurrent ? 'opacity-100' : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
                    )}
                  >
                    {isCurrent && player.playing ? <Pause className="size-5" fill="currentColor" /> : <Play className="ml-0.5 size-5" fill="currentColor" />}
                  </button>
                </TrackCover>
                <div className="mt-3 px-1">
                  <button onClick={() => setOpenId(tr.id)} className="block w-full truncate text-left font-display text-[14px] font-semibold hover:text-orchid">
                    {tr.title}
                  </button>
                  <div className="mt-0.5 truncate text-[12px] text-muted">
                    {[fmtDuration(tr.durationSec), tr.bpm && `${tr.bpm} BPM`, tr.keyscale].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <AnimatePresence>{open && <TrackDrawer track={open} onClose={() => setOpenId(null)} />}</AnimatePresence>
    </div>
  )
}

function TrackDrawer({ track, onClose }: { track: Track; onClose: () => void }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const player = useApp((s) => s.player)
  const play = useApp((s) => s.play)
  const setPlaying = useApp((s) => s.setPlaying)
  const setPrefill = useApp((s) => s.setPrefill)
  const isCurrent = player.trackId === track.id
  const [title, setTitle] = useState(track.title)
  const p = track.params
  const reuse = () =>
    setPrefill({
      mode: p.sample_mode ? 'simple' : 'custom',
      params: { ...p, prompt: p.prompt || track.caption, lyrics: p.lyrics || track.lyrics, src_audio_path: null },
    })
  const rows: [string, string | number | null | undefined][] = [
    ['Model', track.model],
    ['LM', track.lmModel || '—'],
    ['Seed', track.seed],
    ['BPM', track.bpm],
    ['Key', track.keyscale],
    ['Time sig.', track.timesignature],
    ['Language', track.language],
    ['Steps', p.inference_steps],
    ['Task', track.taskType],
    ['Size', fmtBytes(track.sizeBytes)],
    ['Created', fmtDate(track.createdAt, lang)],
  ]
  // Portal to <body>: the page content lives in a z-[1] stacking context below the player bar.
  return createPortal(
    <>
      <motion.div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        initial={{ x: 480 }}
        animate={{ x: 0 }}
        exit={{ x: 480 }}
        transition={{ type: 'spring', damping: 30, stiffness: 280 }}
        className="glass-strong scroll-y fixed top-0 right-0 bottom-0 z-40 w-[460px] border-l border-white/[0.08] p-6"
      >
        <div className="flex items-center">
          <span className="label">{t('library.details')}</span>
          <IconButton className="ml-auto" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <TrackCover id={track.id} className="mt-3 aspect-[16/10] w-full">
          <div className="absolute inset-x-5 bottom-5 flex items-end gap-4">
            <button
              onClick={() => (isCurrent ? setPlaying(!player.playing) : play(track.id))}
              className="flex size-14 items-center justify-center rounded-full bg-white text-ink-900 shadow-xl"
            >
              {isCurrent && player.playing ? <Pause className="size-6" fill="currentColor" /> : <Play className="ml-1 size-6" fill="currentColor" />}
            </button>
            <div className="h-10 flex-1 opacity-85">
              <WaveBars count={30} seed={track.id} active={isCurrent && player.playing} />
            </div>
          </div>
        </TrackCover>
        <input
          className="mt-5 w-full bg-transparent font-display text-[22px] font-semibold outline-none"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== track.title && attempt(() => api.trackUpdate(track.id, { title: title.trim() }))}
        />
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge tone="violet">{fmtDuration(track.durationSec)}</Badge>
          {track.bpm && <Badge>{track.bpm} BPM</Badge>}
          {track.keyscale && <Badge>{track.keyscale}</Badge>}
          {track.genres && <Badge tone="cyan">{track.genres}</Badge>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            variant="primary"
            icon={<Download className="size-4" />}
            onClick={async () => {
              const path = await attempt(() => api.trackSaveAs(track.id))
              if (path) useApp.getState().toast(t('library.saved', { path }), 'ok')
            }}
          >
            {t('library.saveAs')}
          </Button>
          <Button variant="glass" icon={<FolderOpen className="size-4" />} onClick={() => api.trackReveal(track.id)}>
            {t('library.reveal')}
          </Button>
          <Button variant="soft" icon={<RefreshCcw className="size-4" />} onClick={reuse}>
            {t('library.reuse')}
          </Button>
          <Button variant="soft" icon={<Heart className={clsx('size-4', track.favorite && 'fill-magenta text-magenta')} />} onClick={() => attempt(() => api.trackUpdate(track.id, { favorite: !track.favorite }))}>
            {t('library.favorite')}
          </Button>
          <Button variant="soft" icon={<Disc3 className="size-4" />} onClick={() => setPrefill({ mode: 'cover', params: { src_audio_path: track.file, prompt: track.caption, lyrics: track.lyrics } })}>
            {t('library.cover')}
          </Button>
          <Button variant="soft" icon={<Paintbrush className="size-4" />} onClick={() => setPrefill({ mode: 'repaint', params: { src_audio_path: track.file, prompt: track.caption, lyrics: track.lyrics } })}>
            {t('library.repaint')}
          </Button>
        </div>

        <section className="mt-6">
          <div className="label mb-2">{t('library.caption')}</div>
          <p className="text-[13.5px] leading-relaxed text-muted">{track.caption || '—'}</p>
        </section>
        {track.lyrics && track.lyrics !== '[Instrumental]' && (
          <section className="mt-5">
            <div className="label mb-2">{t('library.lyrics')}</div>
            <pre className="console max-h-72 overflow-auto rounded-2xl bg-white/[0.03] p-4 whitespace-pre-wrap text-muted">{track.lyrics}</pre>
          </section>
        )}
        <section className="mt-5">
          <div className="label mb-2">{t('library.params')}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-white/[0.05] py-1">
                <span className="text-dim">{k}</span>
                <span className="truncate text-right font-mono text-muted">{v ?? '—'}</span>
              </div>
            ))}
          </div>
        </section>
        <Button
          variant="danger"
          className="mt-6 w-full"
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            await attempt(() => api.trackRemove(track.id), t('library.deleted'))
            onClose()
          }}
        >
          {t('common.delete')}
        </Button>
      </motion.aside>
    </>,
    document.body,
  )
}
