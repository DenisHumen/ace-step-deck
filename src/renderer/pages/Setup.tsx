import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { Cpu, Download, FolderOpen, HardDrive, Loader2, MemoryStick, Package, Power, Wrench, Search } from 'lucide-react'
import { REQUIRED_DISK_GB } from '@shared/constants'
import { useApp, attempt } from '../lib/store'
import { api, type InstallInspection } from '../lib/api'
import { useT } from '../i18n'
import { Badge, Button, Card, CardTitle, Orb } from '../components/ui'
import { InstallProgress } from '../components/InstallProgress'

export function SetupPage() {
  const t = useT()
  const install = useApp((s) => s.install)
  const engine = useApp((s) => s.engine)
  const system = useApp((s) => s.system)
  const go = useApp((s) => s.go)
  const [path, setPath] = useState('')
  const [found, setFound] = useState<InstallInspection[] | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void api.installDefaultPath().then(setPath)
    void api.engineDetect().then(setFound)
  }, [])
  useEffect(() => {
    if (!install?.running) return
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [install?.running])

  const running = !!install?.running
  const showProgress = running || install?.finished || !!install?.error
  const gpu = system?.gpus[0]
  const vramGB = gpu ? gpu.memoryTotalMB / 1024 : 0
  const disk = system?.diskFreeGB ?? null

  const start = () => attempt(() => api.installStart(path))

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="flex flex-col items-center pt-2 pb-8 text-center">
        <Orb size={58} />
        <h1 className="mt-5 font-display text-[32px] font-semibold tracking-tight">{engine?.installed && !showProgress ? t('setup.installed.title') : t('setup.title')}</h1>
        <p className="mt-2 max-w-2xl text-[14.5px] text-muted">{engine?.installed && !showProgress ? t('setup.installed.subtitle') : t('setup.subtitle')}</p>
      </div>

      {showProgress && install ? (
        <InstallProgress
          install={install}
          now={now}
          stepLabel={(id) => t(`setup.step.${id}`)}
          onCancel={() => void api.installCancel()}
          onRetry={() => void attempt(() => api.installStart(install.targetPath!))}
          done={{
            title: t('setup.done.title'),
            subtitle: t('setup.done.subtitle'),
            action: t('setup.done.start'),
            onAction: async () => {
              go('engine')
              await attempt(() => api.engineStart())
            },
          }}
        />
      ) : (
        <>
          {/* Requirements */}
          <div className="mb-5 grid grid-cols-4 gap-4 max-[1280px]:grid-cols-2">
            <Req icon={<Cpu className="size-4" />} label={t('setup.req.gpu')} value={gpu?.name ?? t('setup.req.noGpu')} ok={!!gpu} />
            <Req icon={<MemoryStick className="size-4" />} label={t('setup.req.vram')} value={gpu ? `${vramGB.toFixed(1)} GB` : '—'} ok={vramGB >= 6} warn={vramGB > 0 && vramGB < 8} />
            <Req icon={<HardDrive className="size-4" />} label={t('setup.req.disk')} value={disk !== null ? `${disk.toFixed(0)} GB` : '—'} hint={t('setup.req.need', { n: REQUIRED_DISK_GB })} ok={disk === null || disk >= REQUIRED_DISK_GB} />
            <Req icon={<Package className="size-4" />} label={t('setup.req.tools')} value={`git ${system?.hasGit ? '✓' : '✗'} · uv ${system?.hasUv ? '✓' : '✗'}`} hint={t('setup.req.toolsHint')} ok />
          </div>

          <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 max-[1280px]:grid-cols-1">
            <Card className="!p-6">
              <CardTitle icon={<Download className="size-4" />}>{engine?.installed ? t('setup.repair') : t('setup.install')}</CardTitle>
              <div className="label mb-1.5">{t('setup.folder')}</div>
              <div className="flex gap-2">
                <input className="field font-mono !text-[13px]" value={path} onChange={(e) => setPath(e.target.value)} />
                <Button
                  variant="soft"
                  icon={<FolderOpen className="size-4" />}
                  onClick={async () => {
                    const p = await api.pickFolder(path)
                    if (p) setPath(p.toLowerCase().includes('ace-step') ? p : `${p}\\ACE-Step-1.5`)
                  }}
                >
                  {t('common.browse')}
                </Button>
              </div>
              <ol className="mt-5 space-y-2 text-[13px] text-muted">
                {(['uv', 'source', 'deps', 'models', 'verify'] as const).map((s, i) => (
                  <li key={s} className="flex items-center gap-3">
                    <span className="flex size-6 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[11px]">{i + 1}</span>
                    {t(`setup.step.${s}`)}
                  </li>
                ))}
              </ol>
              <Button variant="primary" size="lg" className="mt-6 w-full" icon={engine?.installed ? <Wrench className="size-5" /> : <Download className="size-5" />} disabled={!path.trim()} onClick={start}>
                {engine?.installed ? t('setup.repair') : t('setup.install')}
              </Button>
            </Card>

            <Card className="!p-6">
              <CardTitle icon={<Search className="size-4" />}>{t('setup.existing')}</CardTitle>
              <div className="label mb-2">{t('setup.existing.found')}</div>
              {found === null ? (
                <Loader2 className="size-5 animate-spin text-muted" />
              ) : found.length === 0 ? (
                <p className="text-[13px] text-dim">{t('setup.existing.none')}</p>
              ) : (
                <div className="space-y-2">
                  {found.map((f) => {
                    const inUse = engine?.installPath === f.path
                    return (
                      <div key={f.path} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3">
                        <div className="truncate font-mono text-[12.5px]">{f.path}</div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <Badge tone={f.venv ? 'mint' : 'amber'}>venv {f.venv ? '✓' : '✗'}</Badge>
                          <Badge tone={f.mainModels ? 'mint' : 'amber'}>models {f.mainModels ? '✓' : '✗'}</Badge>
                          {f.revision && <Badge>{f.revision}</Badge>}
                          <div className="ml-auto">
                            {inUse ? (
                              <Badge tone="violet">{t('setup.inUse')}</Badge>
                            ) : (
                              <Button size="sm" variant="soft" onClick={() => attempt(() => api.engineUseInstall(f.path))}>
                                {t('setup.use')}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <Button
                variant="ghost"
                className="mt-4 w-full"
                icon={<FolderOpen className="size-4" />}
                onClick={async () => {
                  const p = await api.pickFolder()
                  if (p) {
                    const r = await attempt(() => api.engineUseInstall(p))
                    if (r) setFound(await api.engineDetect())
                  }
                }}
              >
                {t('setup.existing.pick')}
              </Button>
              {engine?.installed && (
                <Button variant="primary" className="mt-3 w-full" icon={<Power className="size-4" />} onClick={() => go('engine')}>
                  {t('nav.engine')}
                </Button>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

export function Req({ icon, label, value, ok, warn, hint }: { icon: React.ReactNode; label: string; value: string; ok: boolean; warn?: boolean; hint?: string }) {
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-2">
        <span className={clsx('flex size-7 items-center justify-center rounded-full', ok ? (warn ? 'bg-amber/15 text-amber' : 'bg-mint/15 text-mint') : 'bg-rose/15 text-rose')}>{icon}</span>
        <span className="label">{label}</span>
      </div>
      <div className="mt-2 truncate text-[14px] font-medium" title={value}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11.5px] text-dim">{hint}</div>}
    </Card>
  )
}
