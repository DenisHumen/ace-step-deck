import { clsx } from 'clsx'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  CircleCheck,
  CircleDashed,
  CircleX,
  Copy,
  ListMusic,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  Ban,
  Sparkles,
} from 'lucide-react'
import type { Job } from '@shared/types'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { fmtDate, fmtEta } from '../lib/format'
import { stageLabel } from '../lib/stage'
import { Badge, Button, Card, EmptyState, IconButton, PageHeader, ProgressBar, ProgressRing, TrackCover, WaveBars } from '../components/ui'

export function QueuePage() {
  const t = useT()
  const q = useApp((s) => s.queue)
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const go = useApp((s) => s.go)
  const running = q.jobs.find((j) => j.status === 'running')
  const pending = q.jobs.filter((j) => j.status === 'pending')
  const finished = q.jobs.filter((j) => j.status !== 'pending' && j.status !== 'running').slice().reverse()
  const stats = [
    { label: t('queue.stat.pending'), value: pending.length + (running ? 1 : 0) },
    { label: t('queue.stat.done'), value: q.jobs.filter((j) => j.status === 'done').length },
    { label: t('queue.stat.failed'), value: q.jobs.filter((j) => j.status === 'failed').length },
    { label: t('queue.stat.avg'), value: q.avgRunSeconds ? fmtEta(q.avgRunSeconds, lang) : '—' },
  ]

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title={t('queue.title')}
        subtitle={t('queue.subtitle')}
        right={
          <>
            <Button variant="ghost" icon={<Trash2 className="size-4" />} disabled={!finished.length} onClick={() => attempt(() => api.queueClearFinished())}>
              {t('queue.clear')}
            </Button>
            {q.paused ? (
              <Button variant="primary" icon={<Play className="size-4" />} onClick={() => attempt(() => api.queueResume())}>
                {t('queue.resume')}
              </Button>
            ) : (
              <Button variant="glass" icon={<Pause className="size-4" />} onClick={() => attempt(() => api.queuePause())}>
                {t('queue.pause')}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-4 gap-4 max-[980px]:grid-cols-2">
        {stats.map((s) => (
          <Card key={s.label} className="!py-4">
            <div className="label">{s.label}</div>
            <div className="mt-1 font-display text-[26px] font-semibold tabular-nums">{s.value}</div>
          </Card>
        ))}
      </div>

      {q.jobs.length === 0 && (
        <EmptyState
          icon={<ListMusic className="size-7" />}
          title={t('queue.empty')}
          hint={t('queue.empty.hint')}
          action={
            <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => go('create')}>
              {t('nav.create')}
            </Button>
          }
        />
      )}

      {running && <ActiveJob job={running} paused={q.paused} />}
      {!running && q.paused && pending.length > 0 && (
        <div className="mb-5 rounded-2xl bg-amber/10 px-4 py-3 text-[13px] text-amber">
          {t('queue.paused')} · {pending[0].stage}
        </div>
      )}

      {pending.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 font-display text-[16px] font-semibold">{t('queue.upNext')}</h2>
          <div className="space-y-2.5">
            {pending.map((j, i) => (
              <JobRow key={j.id} job={j} index={i} total={pending.length} />
            ))}
          </div>
        </section>
      )}

      {finished.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-[16px] font-semibold">{t('queue.history')}</h2>
          <div className="space-y-2.5">
            {finished.map((j) => (
              <JobRow key={j.id} job={j} index={-1} total={0} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ActiveJob({ job, paused }: { job: Job; paused: boolean }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  return (
    <div className="relative mb-7 overflow-hidden rounded-[26px] border border-white/[0.08] p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(240,67,198,0.25),transparent_55%),radial-gradient(circle_at_100%_100%,rgba(83,210,255,0.16),transparent_55%)]" />
      <div className="relative flex flex-wrap items-center gap-7">
        <ProgressRing value={job.progress} size={150} stroke={11}>
          <div className="font-display text-[30px] font-semibold tabular-nums">{Math.round(job.progress * 100)}%</div>
          <div className="mt-0.5 h-5 w-16 opacity-90">
            <WaveBars count={9} seed={job.id} />
          </div>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="label !text-magenta">{t('queue.now')}</span>
            {paused && <Badge tone="amber">{t('queue.paused')}</Badge>}
            {job.spec.source === 'claude' && <Badge tone="violet">Claude</Badge>}
          </div>
          <h2 className="mt-1 truncate font-display text-[24px] font-semibold">{job.title}</h2>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            <span>{t('queue.songs', { done: job.songsDone, total: job.spec.count, n: job.spec.count })}</span>
            <span>{stageLabel(job.stage, t)}</span>
            {job.etaSeconds ? <span>{t('queue.eta', { t: fmtEta(job.etaSeconds, lang) })}</span> : null}
          </div>
          <div className="mt-4 space-y-2">
            <ProgressBar value={job.runProgress} thin />
            <div className="truncate font-mono text-[11.5px] text-dim">{job.progressText || '…'}</div>
          </div>
        </div>
        <Button variant="danger" icon={<Ban className="size-4" />} disabled={job.cancelRequested} onClick={() => attempt(() => api.queueCancel(job.id))}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

function JobRow({ job, index, total }: { job: Job; index: number; total: number }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const go = useApp((s) => s.go)
  const setSearch = useApp((s) => s.setSearch)
  const icon = {
    pending: <CircleDashed className="size-4 text-muted" />,
    running: <Loader2 className="size-4 animate-spin text-magenta" />,
    done: <CircleCheck className="size-4 text-mint" />,
    failed: <CircleX className="size-4 text-rose" />,
    cancelled: <Ban className="size-4 text-dim" />,
  }[job.status]
  const p = job.spec.params
  const task = p.task_type ?? 'text2music'
  const mode = t(`create.mode.${p.sample_mode ? 'simple' : task === 'text2music' ? 'custom' : task === 'cover' || task === 'repaint' ? task : 'stems'}`)
  return (
    <div className="glass group flex items-center gap-4 rounded-[18px] px-4 py-3">
      <TrackCover id={job.id} className="size-11 shrink-0" rounded="rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {icon}
          <span className="truncate font-display text-[14px] font-medium">{job.title}</span>
          <Badge>{mode}</Badge>
          {job.spec.count > 1 && <Badge tone="violet">×{job.spec.count}</Badge>}
          {job.spec.source === 'claude' && <Badge tone="violet">Claude</Badge>}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[12px] text-dim">
          <span>{t(`queue.status.${job.status}`)}</span>
          <span>{fmtDate(job.createdAt, lang)}</span>
          {job.status !== 'pending' && <span>{t('queue.songs', { done: job.songsDone, total: job.spec.count, n: job.spec.count })}</span>}
          {job.error && <span className="truncate text-rose">{job.error}</span>}
        </div>
        {job.status === 'failed' || job.status === 'cancelled' || job.status === 'done' ? null : job.songsDone > 0 ? <ProgressBar value={job.progress} thin className="mt-2" /> : null}
      </div>
      <div className="flex items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
        {job.status === 'pending' && (
          <>
            <IconButton title={t('queue.moveTop')} disabled={index === 0} onClick={() => api.queueMove(job.id, 'top')}>
              <ArrowUpToLine className="size-4" />
            </IconButton>
            <IconButton title={t('queue.moveUp')} disabled={index === 0} onClick={() => api.queueMove(job.id, 'up')}>
              <ArrowUp className="size-4" />
            </IconButton>
            <IconButton title={t('queue.moveDown')} disabled={index === total - 1} onClick={() => api.queueMove(job.id, 'down')}>
              <ArrowDown className="size-4" />
            </IconButton>
            <IconButton title={t('common.cancel')} tone="danger" onClick={() => api.queueCancel(job.id)}>
              <Ban className="size-4" />
            </IconButton>
          </>
        )}
        {job.status === 'done' && job.trackIds.length > 0 && (
          <Button
            size="sm"
            variant="soft"
            onClick={() => {
              setSearch(job.title.slice(0, 30))
              go('library')
            }}
          >
            {t('queue.openTracks')}
          </Button>
        )}
        {(job.status === 'failed' || job.status === 'cancelled') && (
          <IconButton title={t('common.retry')} onClick={() => attempt(() => api.queueRetry(job.id))}>
            <RotateCcw className="size-4" />
          </IconButton>
        )}
        {job.status !== 'pending' && job.status !== 'running' && (
          <>
            <IconButton title={t('queue.duplicate')} onClick={() => attempt(() => api.queueDuplicate(job.id))}>
              <Copy className="size-4" />
            </IconButton>
            <IconButton title={t('common.remove')} tone="danger" onClick={() => api.queueRemove(job.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      {job.status === 'running' && <div className={clsx('w-24')}><ProgressBar value={job.progress} thin /></div>}
      {job.etaSeconds && job.status === 'running' ? <span className="text-[12px] text-dim">{fmtEta(job.etaSeconds, lang)}</span> : null}
    </div>
  )
}
