import { useEffect, useRef } from 'react'
import { clsx } from 'clsx'
import { CircleCheck, CircleDashed, CircleMinus, CircleX, Loader2, Power } from 'lucide-react'
import type { InstallState, StepStatus } from '@shared/types'
import { useT } from '../i18n'
import { fmtDuration } from '../lib/format'
import { Button, Card, ProgressBar, ProgressRing } from './ui'

function StepIcon({ s }: { s: StepStatus }) {
  if (s === 'done') return <CircleCheck className="size-5 text-mint" />
  if (s === 'error') return <CircleX className="size-5 text-rose" />
  if (s === 'running') return <Loader2 className="size-5 animate-spin text-magenta" />
  if (s === 'skipped') return <CircleMinus className="size-5 text-cyan" />
  return <CircleDashed className="size-5 text-dim" />
}

/** Progress ring + per-step list + log of an installer run (ACE-Step or ComfyUI). */
export function InstallProgress<Id extends string>({
  install,
  now,
  stepLabel,
  onCancel,
  onRetry,
  done,
}: {
  install: InstallState<Id>
  now: number
  stepLabel: (id: Id) => string
  onCancel: () => void
  onRetry: () => void
  done: { title: string; subtitle: string; action: string; onAction: () => void }
}) {
  const t = useT()
  const logBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
  }, [install.log.length])
  const elapsed = install.startedAt ? (now - install.startedAt) / 1000 : 0
  return (
    <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5 max-[1280px]:grid-cols-1">
      <Card className="flex flex-col items-center !p-7 text-center">
        <ProgressRing value={install.overall} size={190} stroke={13} spin={install.running}>
          <div className="font-display text-[38px] font-semibold tabular-nums">{Math.round(install.overall * 100)}%</div>
          <div className="label mt-1">{t('setup.overall')}</div>
        </ProgressRing>
        <div className="mt-5 text-[13px] text-muted">{t('setup.elapsed', { t: fmtDuration(elapsed) })}</div>
        <div className="mt-1 max-w-full truncate font-mono text-[11.5px] text-dim">{install.targetPath}</div>
        {install.running && (
          <Button variant="danger" className="mt-6" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        {install.finished && (
          <div className="mt-6 w-full">
            <div className="font-display text-[18px] font-semibold text-mint">{done.title}</div>
            <p className="mt-1 text-[13px] text-muted">{done.subtitle}</p>
            <Button variant="primary" className="mt-4 w-full" icon={<Power className="size-4" />} onClick={done.onAction}>
              {done.action}
            </Button>
          </div>
        )}
        {!install.running && install.error && (
          <div className="mt-6 w-full">
            <div className="font-display text-[16px] font-semibold text-rose">{install.cancelled ? t('setup.cancelled') : t('setup.failed')}</div>
            <p className="mt-1 text-[12.5px] break-words text-rose/80">{install.error}</p>
            <Button variant="primary" className="mt-4 w-full" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          </div>
        )}
      </Card>
      <div className="space-y-5">
        <Card>
          <div className="space-y-1">
            {install.steps.map((s) => (
              <div key={s.id} className={clsx('rounded-2xl px-3 py-3 transition-colors', s.status === 'running' && 'bg-white/[0.04]')}>
                <div className="flex items-center gap-3">
                  <StepIcon s={s.status} />
                  <span className={clsx('font-display text-[14px] font-medium', s.status === 'pending' && 'text-muted')}>{stepLabel(s.id)}</span>
                  <span className="ml-auto max-w-[55%] truncate text-right font-mono text-[11.5px] text-dim">{s.error ?? s.detail}</span>
                </div>
                {(s.status === 'running' || s.status === 'done') && (
                  <ProgressBar value={s.status === 'done' ? 1 : s.progress} tone={s.status === 'done' ? 'mint' : 'brand'} thin className="mt-2.5 ml-8" />
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="label mb-2">{t('setup.log')}</div>
          <div ref={logBox} className="console scroll-y h-56 rounded-xl bg-black/40 p-3 select-text">
            {install.log.map((l, i) => (
              <div key={i} className={clsx('break-all', l.stream === 'err' ? 'text-[#ff9fb4]' : 'text-muted')}>
                {l.text}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
