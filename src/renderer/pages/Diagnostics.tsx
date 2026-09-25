import { clsx } from 'clsx'
import { Activity, CircleCheck, CircleDashed, CircleMinus, CircleX, Gauge, Loader2, ShieldCheck, TriangleAlert, Zap } from 'lucide-react'
import type { DiagCheck, DiagnosticsState } from '@shared/types'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { translate, useT } from '../i18n'
import { Button, Card, CopyButton, PageHeader, ProgressRing } from '../components/ui'

const GROUPS: DiagCheck['group'][] = ['system', 'install', 'engine', 'stress']

function statusIcon(s: DiagCheck['status']) {
  switch (s) {
    case 'pass':
      return <CircleCheck className="size-[18px] text-mint" />
    case 'warn':
      return <TriangleAlert className="size-[18px] text-amber" />
    case 'fail':
      return <CircleX className="size-[18px] text-rose" />
    case 'running':
      return <Loader2 className="size-[18px] animate-spin text-magenta" />
    case 'skip':
      return <CircleMinus className="size-[18px] text-dim" />
    default:
      return <CircleDashed className="size-[18px] text-dim" />
  }
}

function report(d: DiagnosticsState, lang: 'en' | 'ru'): string {
  const tr = (k: string, v?: Record<string, string | number>) => translate(lang, k, v)
  const lines = [`# AceDeck — ${tr('diag.title')}`, '', `**${tr(`diag.verdict.${d.verdict ?? 'none'}`)}** · ${tr('diag.score')}: ${d.score ?? '—'}/100`, `Date: ${new Date(d.finishedAt ?? Date.now()).toISOString()}`, '']
  for (const g of GROUPS) {
    lines.push(`## ${tr(`diag.group.${g}`)}`)
    for (const c of d.checks.filter((x) => x.group === g)) {
      lines.push(`- [${c.status.toUpperCase()}] ${tr(`diag.check.${c.id}`)}: ${c.value ?? ''}${c.detail ? ` — ${c.detail}` : ''}`)
    }
    lines.push('')
  }
  if (d.samples.length) {
    lines.push(`## ${tr('diag.samples')}`)
    for (const s of d.samples) lines.push(`- #${s.index + 1}: ${s.ok ? 'OK' : 'FAIL'} ${s.seconds.toFixed(1)} s, VRAM peak ${s.vramPeakMB ? (s.vramPeakMB / 1024).toFixed(1) + ' GB' : '—'}${s.error ? ` (${s.error})` : ''}`)
  }
  return lines.join('\n')
}

export function DiagnosticsPage() {
  const t = useT()
  const d = useApp((s) => s.diag)
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const running = !!d?.running
  const verdict = d?.verdict ?? 'none'
  const done = d?.checks.filter((c) => c.status !== 'pending' && c.status !== 'running').length ?? 0
  const total = d?.checks.length || 1
  const progress = running ? done / total : d?.score !== null && d?.score !== undefined ? d.score / 100 : 0
  const verdictColor = { stable: 'text-mint', unstable: 'text-amber', failed: 'text-rose', none: 'text-muted' }[verdict]
  const maxSec = Math.max(1, ...(d?.samples.map((s) => s.seconds) ?? [1]))

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title={t('diag.title')}
        subtitle={t('diag.subtitle')}
        right={
          running ? (
            <Button variant="danger" onClick={() => api.diagCancel()}>
              {t('diag.cancel')}
            </Button>
          ) : (
            <>
              {d?.finishedAt && <CopyButton text={report(d, lang)} label={t('diag.export')} />}
              <Button variant="glass" icon={<Zap className="size-4" />} onClick={() => attempt(() => api.diagRun('quick'))}>
                {t('diag.quick')}
              </Button>
              <Button variant="primary" icon={<Activity className="size-4" />} onClick={() => attempt(() => api.diagRun('full'))}>
                {t('diag.full')}
              </Button>
            </>
          )
        }
      />

      <Card className="relative mb-6 overflow-hidden !p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_50%,rgba(83,210,255,0.16),transparent_55%),radial-gradient(circle_at_90%_20%,rgba(240,67,198,0.18),transparent_55%)]" />
        <div className="relative flex flex-wrap items-center gap-8">
          <ProgressRing value={running ? progress : d?.score !== null && d?.score !== undefined ? progress : 0} size={168} stroke={12} spin={running}>
            {running ? (
              <>
                <Loader2 className="size-7 animate-spin text-magenta" />
                <div className="mt-2 font-mono text-[13px] text-muted">
                  {done}/{total}
                </div>
              </>
            ) : (
              <>
                <div className="font-display text-[40px] leading-none font-semibold tabular-nums">{d?.score ?? '—'}</div>
                <div className="label mt-1">{t('diag.score')}</div>
              </>
            )}
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <div className="label">{running ? t('diag.running') : d?.mode ? (d.mode === 'full' ? t('diag.full') : t('diag.quick')) : ''}</div>
            <div className={clsx('mt-1 flex items-center gap-3 font-display text-[32px] font-semibold', verdictColor)}>
              {verdict === 'stable' ? <ShieldCheck className="size-8" /> : verdict === 'failed' ? <CircleX className="size-8" /> : verdict === 'unstable' ? <TriangleAlert className="size-8" /> : <Gauge className="size-8" />}
              {running ? t('diag.running') : t(`diag.verdict.${verdict}`)}
            </div>
            <p className="mt-2 max-w-xl text-[14px] text-muted">{t(`diag.verdict.${running ? 'none' : verdict}.desc`)}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-5 max-[1280px]:grid-cols-1">
        {GROUPS.map((g) => (
          <Card key={g}>
            <h3 className="mb-3 font-display text-[15px] font-semibold">{t(`diag.group.${g}`)}</h3>
            <div>
              {(d?.checks.length ? d.checks : placeholder()).filter((c) => c.group === g).map((c) => (
                <div key={c.id} className="flex items-start gap-3 border-b border-white/[0.05] py-2.5 last:border-0">
                  <div className="mt-0.5">{statusIcon(c.status)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px]">{t(`diag.check.${c.id}`)}</div>
                    {c.detail && <div className={clsx('text-[12px]', c.status === 'fail' ? 'text-rose/85' : 'text-dim')}>{c.detail}</div>}
                  </div>
                  <div className="max-w-[55%] truncate text-right font-mono text-[12px] text-muted">{c.value ?? ''}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {!!d?.samples.length && (
        <Card className="mt-5">
          <h3 className="mb-4 font-display text-[15px] font-semibold">{t('diag.samples')}</h3>
          <div className="flex h-44 items-end gap-4">
            {d.samples.map((s) => (
              <div key={s.index} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <div className="font-mono text-[12px] text-muted">{s.seconds.toFixed(1)} s</div>
                <div className={clsx('w-full max-w-[90px] rounded-t-xl', s.ok ? 'bg-gradient-to-t from-violet to-magenta' : 'bg-rose/70')} style={{ height: `${(s.seconds / maxSec) * 75}%` }} />
                <div className="text-[12px] text-dim">
                  {t('diag.sample', { n: s.index + 1 })}
                  {s.vramPeakMB ? ` · ${(s.vramPeakMB / 1024).toFixed(1)} GB` : ''}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function placeholder(): DiagCheck[] {
  const ids: [string, DiagCheck['group']][] = [
    ['gpu', 'system'], ['driver', 'system'], ['vram', 'system'], ['ram', 'system'], ['disk', 'system'],
    ['source', 'install'], ['venv', 'install'], ['models', 'install'], ['torch', 'install'],
    ['api', 'engine'], ['latency', 'engine'], ['loaded', 'engine'],
    ['gen', 'stress'], ['speed', 'stress'], ['memory', 'stress'], ['alive', 'stress'],
  ]
  return ids.map(([id, group]) => ({ id, group, status: 'pending' }))
}
