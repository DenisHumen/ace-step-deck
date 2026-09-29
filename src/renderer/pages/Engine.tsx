import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Boxes, Cpu, FolderOpen, HardDrive, Power, RefreshCw, RotateCw, Server, Terminal, Activity, TriangleAlert } from 'lucide-react'
import type { LogLine } from '@shared/types'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { fmtDuration, fmtEta } from '../lib/format'
import { engineTone, isTransitional, isUp } from '../lib/engine-ui'
import { Badge, Button, Card, CardTitle, CopyButton, PageHeader, ProgressBar, StatusDot, Toggle } from '../components/ui'

export function EnginePage() {
  const t = useT()
  const engine = useApp((s) => s.engine)
  const gpu = useApp((s) => s.system?.gpus[0])
  const logs = useApp((s) => s.logs)
  const go = useApp((s) => s.go)
  const [updating, setUpdating] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])
  const state = engine?.state ?? 'not-installed'
  const up = isUp(state)
  const tone = engineTone(state)
  const ringColor = { mint: '#3fe5a9', amber: '#ffc45c', rose: '#ff5c7c', dim: '#6f6985', cyan: '#53d2ff', magenta: '#f043c6' }[tone]

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('engine.title')} subtitle={t('engine.subtitle')} />
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5 max-[1380px]:grid-cols-1">
        {/* Status hero */}
        <Card className="relative flex flex-col overflow-hidden !p-7">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(124,92,255,0.22),transparent_60%)]" />
          <div className="relative flex flex-1 flex-wrap items-center gap-8">
            <StatusOrb color={ringColor} active={up || isTransitional(state)} busy={state === 'busy'} />
            <div className="min-w-[260px] flex-1">
              <div className="label">ACE-Step 1.5</div>
              <div className="mt-1 flex items-center gap-2.5">
                <StatusDot tone={tone} pulse={up || isTransitional(state)} />
                <h2 className="font-display text-[28px] font-semibold">{t(`state.${state}`)}</h2>
              </div>
              {engine?.startedAt && up && (
                <div className="mt-1 text-[13px] text-muted">
                  {t('engine.uptime')}: {fmtDuration((now - engine.startedAt) / 1000)}
                </div>
              )}
              {engine?.external && <Badge tone="cyan">{t('engine.external')}</Badge>}
              <div className="mt-6 flex flex-wrap gap-2.5">
                {state === 'not-installed' ? (
                  <Button variant="primary" icon={<Power className="size-4" />} onClick={() => go('setup')}>
                    {t('engineCard.install')}
                  </Button>
                ) : up || state === 'starting' || state === 'loading' ? (
                  <Button variant="glass" icon={<Power className="size-4" />} disabled={state === 'starting'} onClick={() => attempt(() => api.engineStop())}>
                    {t('common.stop')}
                  </Button>
                ) : (
                  <Button variant="primary" icon={<Power className="size-4" />} loading={state === 'stopping'} onClick={() => attempt(() => api.engineStart())}>
                    {t('common.start')}
                  </Button>
                )}
                <Button variant="glass" icon={<RotateCw className="size-4" />} disabled={!engine?.installed || isTransitional(state)} onClick={() => attempt(() => api.engineRestart())}>
                  {t('common.restart')}
                </Button>
                <Button
                  variant="ghost"
                  icon={<RefreshCw className={clsx('size-4', updating && 'animate-spin')} />}
                  disabled={!engine?.installed || updating}
                  onClick={async () => {
                    setUpdating(true)
                    const rev = await attempt(() => api.engineUpdate())
                    setUpdating(false)
                    if (rev) useApp.getState().toast(t('engine.updated', { rev }), 'ok')
                  }}
                >
                  {updating ? t('engine.updating') : t('engine.update')}
                </Button>
                <Button variant="ghost" icon={<Activity className="size-4" />} onClick={() => go('diagnostics')}>
                  {t('nav.diagnostics')}
                </Button>
              </div>
            </div>
          </div>
          {state === 'error' && engine?.lastError && (
            <div className="relative mt-6 rounded-2xl border border-rose/25 bg-rose/10 p-4">
              <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-rose">
                <TriangleAlert className="size-4" /> {t('engine.lastError')}
              </div>
              <pre className="console max-h-40 overflow-auto whitespace-pre-wrap text-rose/85">{engine.lastError}</pre>
            </div>
          )}
          <HeroStats uptime={engine?.startedAt && up ? (now - engine.startedAt) / 1000 : null} />
        </Card>

        {/* Side info */}
        <div className="space-y-5">
          <Card>
            <CardTitle icon={<Boxes className="size-4" />}>{t('engine.models')}</CardTitle>
            <InfoRow label={t('engine.dit')} value={engine?.modelsInitialized ? engine.loadedModel : `${engine?.loadedModel ?? '—'} · ${t('engine.notLoaded')}`} ok={!!engine?.modelsInitialized} />
            <InfoRow label={t('engine.lm')} value={engine?.llmInitialized ? engine.loadedLm ?? 'LM' : t('engine.notLoaded')} ok={!!engine?.llmInitialized} />
          </Card>
          <Card>
            <CardTitle icon={<Cpu className="size-4" />}>{t('engine.gpu')}</CardTitle>
            {gpu ? (
              <>
                <div className="truncate text-[14px] font-medium">{gpu.name}</div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="label w-20">VRAM</span>
                  <ProgressBar value={gpu.memoryUsedMB / gpu.memoryTotalMB} className="flex-1" />
                  <span className="w-32 text-right font-mono text-[12px] whitespace-nowrap text-muted">
                    {(gpu.memoryUsedMB / 1024).toFixed(1)} / {(gpu.memoryTotalMB / 1024).toFixed(1)} GB
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-3">
                  <span className="label w-20">{t('engine.util')}</span>
                  <ProgressBar value={gpu.utilization / 100} tone="mint" className="flex-1" />
                  <span className="w-32 text-right font-mono text-[12px] whitespace-nowrap text-muted">
                    {gpu.utilization}% · {gpu.temperature}°C
                  </span>
                </div>
                <div className="mt-2 text-[11.5px] text-dim">Driver {gpu.driver}</div>
              </>
            ) : (
              <div className="text-muted">—</div>
            )}
          </Card>
          <Card>
            <CardTitle icon={<Server className="size-4" />}>{t('engine.server')}</CardTitle>
            <InfoRow label={t('engine.port')} value={`127.0.0.1:${engine?.port ?? '—'}`} />
            <InfoRow label={t('engine.pid')} value={engine?.pid ? String(engine.pid) : '—'} />
            <InfoRow label={t('engine.revision')} value={engine?.revision ?? '—'} />
            <div className="mt-2 flex items-center gap-2">
              <HardDrive className="size-3.5 shrink-0 text-dim" />
              <span className="truncate font-mono text-[11.5px] text-dim">{engine?.installPath ?? '—'}</span>
              {engine?.installPath && (
                <Button size="sm" variant="ghost" className="ml-auto" icon={<FolderOpen className="size-3.5" />} onClick={() => api.openPath(engine.installPath!)}>
                  {t('engine.openFolder')}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
      <LogConsole
        logs={logs}
        onClear={async () => {
          await api.engineClearLogs()
          useApp.setState({ logs: [] })
        }}
      />
    </div>
  )
}

function HeroStats({ uptime }: { uptime: number | null }) {
  const t = useT()
  const lang = useApp((s) => s.settings?.language ?? 'en')
  const tracks = useApp((s) => s.tracks.length)
  const q = useApp((s) => s.queue)
  const pending = q.jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const tiles = [
    { label: t('engine.uptime'), value: uptime !== null ? fmtDuration(uptime) : '—' },
    { label: t('nav.library'), value: String(tracks) },
    { label: t('nav.queue'), value: String(pending) },
    { label: t('queue.stat.avg'), value: q.avgRunSeconds ? fmtEta(q.avgRunSeconds, lang) : '—' },
  ]
  return (
    <div className="relative mt-7 grid grid-cols-4 gap-3">
      {tiles.map((x) => (
        <div key={x.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
          <div className="label !text-[10px]">{x.label}</div>
          <div className="mt-1 font-display text-[20px] font-semibold tabular-nums">{x.value}</div>
        </div>
      ))}
    </div>
  )
}

function InfoRow({ label, value, ok }: { label: string; value: string | null | undefined; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.05] py-2 last:border-0">
      <span className="w-16 text-[12.5px] text-dim">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{value ?? '—'}</span>
      {ok !== undefined && <StatusDot tone={ok ? 'mint' : 'dim'} />}
    </div>
  )
}

/** Circular status display with an animated waveform (reference: "AI Mastering Engine"). */
function StatusOrb({ color, active, busy }: { color: string; active: boolean; busy: boolean }) {
  const bars = 17
  return (
    <div className="relative size-[190px] shrink-0">
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(from 200deg, ${color}00, ${color}, #7c5cff, ${color}00 70%)`, animation: active ? 'spin 5s linear infinite' : undefined, opacity: active ? 0.9 : 0.35, mask: 'radial-gradient(circle, transparent 60%, #000 61%, #000 66%, transparent 67%)', WebkitMask: 'radial-gradient(circle, transparent 60%, #000 61%, #000 66%, transparent 67%)' }} />
      <div className="absolute inset-[14px] rounded-full border border-white/[0.06]" />
      <div className="absolute inset-[26px] rounded-full" style={{ background: `radial-gradient(circle at 50% 40%, ${color}33, rgba(10,8,18,0.9) 70%)`, boxShadow: `0 0 50px -10px ${color}88 inset, 0 0 40px -12px ${color}` }} />
      <div className="absolute inset-[48px] flex items-center justify-center gap-[4px]">
        {Array.from({ length: bars }, (_, i) => {
          const d = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2)
          const h = (1 - d * 0.85) * 100
          return (
            <span
              key={i}
              className={clsx('w-[3px] rounded-full', active && 'bar-anim')}
              style={{ height: `${active ? h : 12}%`, background: `linear-gradient(to top, ${color}, #ffffff)`, animationDelay: `${(i * 83) % 700}ms`, animationDuration: busy ? '0.7s' : '1.4s', transformOrigin: 'center', opacity: active ? 0.95 : 0.4 }}
            />
          )
        })}
      </div>
    </div>
  )
}

export function LogConsole({ logs, onClear, emptyText }: { logs: LogLine[]; onClear: () => void; emptyText?: string }) {
  const t = useT()
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState<'all' | 'err'>('all')
  const box = useRef<HTMLDivElement>(null)
  // Python/loguru write everything to stderr, so classify by content instead of stream.
  const level = (text: string) => (/\b(ERROR|CRITICAL|Traceback|Exception|failed|exited unexpectedly)\b/i.test(text) ? 'err' : /\bWARN(ING)?\b/.test(text) ? 'warn' : 'info')
  const shown = useMemo(() => (filter === 'err' ? logs.filter((l) => level(l.text) !== 'info') : logs).slice(-800), [logs, filter])
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown, follow])
  return (
    <Card className="mt-5">
      <CardTitle
        icon={<Terminal className="size-4" />}
        right={
          <div className="flex items-center gap-2">
            <div className="w-28">
              <Toggle checked={follow} onChange={setFollow} label={t('engine.logs.follow')} />
            </div>
            <Button size="sm" variant={filter === 'err' ? 'soft' : 'ghost'} onClick={() => setFilter(filter === 'err' ? 'all' : 'err')}>
              ⚠ warn/error
            </Button>
            <CopyButton text={shown.map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.text}`).join('\n')} label={t('engine.logs.copy')} />
            <Button size="sm" variant="ghost" onClick={onClear}>
              {t('engine.logs.clear')}
            </Button>
          </div>
        }
      >
        {t('engine.logs')}
      </CardTitle>
      <div ref={box} className="console scroll-y h-[320px] rounded-2xl border border-white/[0.05] bg-black/40 p-4 select-text">
        {shown.length === 0 ? (
          <div className="text-dim">{emptyText ?? t('engine.logs.empty')}</div>
        ) : (
          shown.map((l, i) => (
            <div
              key={i}
              className={clsx(
                'break-all whitespace-pre-wrap',
                level(l.text) === 'err' ? 'text-[#ff9fb4]' : level(l.text) === 'warn' ? 'text-amber/90' : l.stream === 'sys' ? 'text-cyan' : 'text-muted',
              )}
            >
              <span className="mr-2 text-dim">{new Date(l.t).toLocaleTimeString()}</span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </Card>
  )
}
