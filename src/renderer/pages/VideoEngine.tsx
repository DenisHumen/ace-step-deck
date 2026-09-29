import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import {
  Boxes,
  CircleCheck,
  Cpu,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  HardDrive,
  Link2,
  MemoryStick,
  Package,
  Power,
  RotateCw,
  Server,
  Settings2,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  Wrench,
  X,
} from 'lucide-react'
import type { VideoModelInfo, VideoModelKind } from '@shared/video'
import { VIDEO_REQUIRED_DISK_GB } from '@shared/video'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { fmtBytes, fmtDuration } from '../lib/format'
import { engineTone, isTransitional, isUp } from '../lib/engine-ui'
import { Badge, Button, Card, CardTitle, Field, IconButton, Orb, PageHeader, ProgressBar, Segmented, StatusDot, Toggle } from '../components/ui'
import { InstallProgress } from '../components/InstallProgress'
import { Req } from './Setup'
import { LogConsole } from './Engine'

/** The installer run the user already closed (its state stays in the store until restart). */
let dismissedRun: number | null = null

export function VideoEnginePage() {
  const t = useT()
  const install = useApp((s) => s.videoInstall)
  const eng = useApp((s) => s.videoEngine)
  const logs = useApp((s) => s.videoLogs)
  const go = useApp((s) => s.go)
  const [now, setNow] = useState(Date.now())
  const [, force] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  const showProgress = !!install && (install.running || install.finished || !!install.error) && install.startedAt !== dismissedRun
  const dismiss = () => {
    dismissedRun = install?.startedAt ?? null
    force((x) => x + 1)
  }

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('video.engine.title')} subtitle={t('video.engine.subtitle')} />
      {showProgress && install ? (
        <>
          <InstallProgress
            install={install}
            now={now}
            stepLabel={(id) => t(`video.setup.step.${id}`)}
            onCancel={() => void api.videoInstallCancel()}
            onRetry={() => void attempt(() => api.videoInstallStart(install.targetPath!))}
            done={{
              title: t('setup.done.title'),
              subtitle: t('video.setup.done'),
              action: t('video.setup.start'),
              onAction: async () => {
                dismiss()
                go('video')
                await attempt(() => api.videoStart())
              },
            }}
          />
          {!install.running && (
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" onClick={dismiss}>
                {t('common.close')}
              </Button>
            </div>
          )}
        </>
      ) : !eng?.installed ? (
        <VideoSetup />
      ) : (
        <>
          <EngineHero now={now} />
          <ModelsSection />
          <VideoSettingsCard />
          <LogConsole
            logs={logs}
            emptyText={t('video.engine.logsEmpty')}
            onClear={async () => {
              await api.videoClearLogs()
              useApp.setState({ videoLogs: [] })
            }}
          />
        </>
      )}
    </div>
  )
}

// ─── Install ─────────────────────────────────────────────────────────────────
function VideoSetup() {
  const t = useT()
  const system = useApp((s) => s.system)
  const [path, setPath] = useState('')
  useEffect(() => {
    void api.videoInstallDefaultPath().then(setPath)
  }, [])
  const gpu = system?.gpus[0]
  const vramGB = gpu ? gpu.memoryTotalMB / 1024 : 0
  const disk = system?.diskFreeGB ?? null
  return (
    <>
      <div className="flex flex-col items-center pb-8 text-center">
        <Orb size={58} />
        <h2 className="mt-5 font-display text-[28px] font-semibold tracking-tight">{t('video.setup.title')}</h2>
        <p className="mt-2 max-w-2xl text-[14.5px] text-muted">{t('video.setup.subtitle')}</p>
      </div>
      <div className="mb-5 grid grid-cols-4 gap-4 max-[1280px]:grid-cols-2">
        <Req icon={<Cpu className="size-4" />} label={t('setup.req.gpu')} value={gpu?.name ?? t('setup.req.noGpu')} ok={!!gpu} />
        <Req icon={<MemoryStick className="size-4" />} label={t('setup.req.vram')} value={gpu ? `${vramGB.toFixed(1)} GB` : '—'} ok={vramGB >= 8} warn={vramGB > 0 && vramGB < 12} hint={t('video.setup.vramHint')} />
        <Req icon={<HardDrive className="size-4" />} label={t('setup.req.disk')} value={disk !== null ? `${disk.toFixed(0)} GB` : '—'} hint={t('setup.req.need', { n: VIDEO_REQUIRED_DISK_GB })} ok={disk === null || disk >= VIDEO_REQUIRED_DISK_GB} />
        <Req icon={<Package className="size-4" />} label={t('setup.req.tools')} value={`git ${system?.hasGit ? '✓' : '✗'} · uv ${system?.hasUv ? '✓' : '✗'}`} hint={t('setup.req.toolsHint')} ok />
      </div>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-5 max-[1280px]:grid-cols-1">
        <Card className="!p-6">
          <CardTitle icon={<Download className="size-4" />}>{t('video.setup.install')}</CardTitle>
          <div className="label mb-1.5">{t('setup.folder')}</div>
          <div className="flex gap-2">
            <input className="field font-mono !text-[13px]" value={path} onChange={(e) => setPath(e.target.value)} />
            <Button
              variant="soft"
              icon={<FolderOpen className="size-4" />}
              onClick={async () => {
                const p = await api.pickFolder(path)
                if (p) setPath(/comfyui/i.test(p) ? p : `${p}\\ComfyUI`)
              }}
            >
              {t('common.browse')}
            </Button>
          </div>
          <ol className="mt-5 space-y-2 text-[13px] text-muted">
            {(['uv', 'source', 'deps', 'models', 'verify'] as const).map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-white/[0.06] font-mono text-[11px]">{i + 1}</span>
                {t(`video.setup.step.${s}`)}
              </li>
            ))}
          </ol>
          <Button variant="primary" size="lg" className="mt-6 w-full" icon={<Download className="size-5" />} disabled={!path.trim()} onClick={() => attempt(() => api.videoInstallStart(path))}>
            {t('video.setup.install')}
          </Button>
        </Card>
        <Card className="!p-6">
          <CardTitle icon={<Server className="size-4" />}>{t('video.setup.existing')}</CardTitle>
          <p className="text-[13px] leading-relaxed text-muted">{t('video.setup.existingHint')}</p>
          <Button
            variant="soft"
            className="mt-5 w-full"
            icon={<FolderOpen className="size-4" />}
            onClick={async () => {
              const p = await api.pickFolder()
              if (p) await attempt(() => api.videoUseInstall(p), t('video.setup.linked'))
            }}
          >
            {t('video.setup.pick')}
          </Button>
        </Card>
      </div>
    </>
  )
}

// ─── Engine status ───────────────────────────────────────────────────────────
function EngineHero({ now }: { now: number }) {
  const t = useT()
  const eng = useApp((s) => s.videoEngine)!
  const state = eng.state
  const up = isUp(state)
  return (
    <Card className="relative overflow-hidden !p-7">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(83,210,255,0.16),transparent_60%)]" />
      <div className="relative flex flex-wrap items-start gap-8">
        <div className="flex size-[120px] shrink-0 items-center justify-center rounded-full border border-white/[0.07] bg-[radial-gradient(circle_at_50%_40%,rgba(124,92,255,0.35),rgba(10,8,18,0.9)_70%)]">
          <Film className={clsx('size-12', up ? 'text-cyan' : 'text-dim')} />
        </div>
        <div className="min-w-[260px] flex-1">
          <div className="label">ComfyUI · Wan 2.1</div>
          <div className="mt-1 flex items-center gap-2.5">
            <StatusDot tone={engineTone(state)} pulse={up || isTransitional(state)} />
            <h2 className="font-display text-[26px] font-semibold">{t(`video.state.${state}`)}</h2>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
            {eng.version && <span>ComfyUI {eng.version}</span>}
            {eng.torch && <span>PyTorch {eng.torch}</span>}
            <span>127.0.0.1:{eng.port}</span>
            {eng.startedAt && up && (
              <span>
                {t('engine.uptime')}: {fmtDuration((now - eng.startedAt) / 1000)}
              </span>
            )}
          </div>
          {eng.external && (
            <div className="mt-2">
              <Badge tone="cyan">{t('engine.external')}</Badge>
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-2.5">
            {up || state === 'starting' ? (
              <Button variant="glass" icon={<Power className="size-4" />} disabled={state === 'starting'} onClick={() => attempt(() => api.videoStop())}>
                {t('common.stop')}
              </Button>
            ) : (
              <Button variant="primary" icon={<Power className="size-4" />} loading={state === 'stopping'} onClick={() => attempt(() => api.videoStart())}>
                {t('common.start')}
              </Button>
            )}
            <Button variant="glass" icon={<RotateCw className="size-4" />} disabled={isTransitional(state)} onClick={() => attempt(() => api.videoRestart())}>
              {t('common.restart')}
            </Button>
            <Button variant="ghost" icon={<ExternalLink className="size-4" />} disabled={!up} title={t('video.engine.webUiHint')} onClick={() => attempt(() => api.videoOpenUi())}>
              {t('video.engine.webUi')}
            </Button>
            {eng.installPath && (
              <Button variant="ghost" icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(eng.installPath!)}>
                {t('engine.openFolder')}
              </Button>
            )}
            {eng.installPath && !eng.external && (
              <Button variant="ghost" icon={<Wrench className="size-4" />} disabled={up} title={up ? t('video.engine.repairHint') : ''} onClick={() => attempt(() => api.videoInstallStart(eng.installPath!))}>
                {t('video.engine.repair')}
              </Button>
            )}
          </div>
          <p className="mt-4 text-[12.5px] text-dim">{t('video.engine.autoStart')}</p>
        </div>
      </div>
      {state === 'error' && eng.lastError && (
        <div className="relative mt-6 rounded-2xl border border-rose/25 bg-rose/10 p-4">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-medium text-rose">
            <TriangleAlert className="size-4" /> {t('engine.lastError')}
          </div>
          <pre className="console max-h-40 overflow-auto whitespace-pre-wrap text-rose/85">{eng.lastError}</pre>
        </div>
      )}
      {eng.musicPaused && (
        <div className="relative mt-5 rounded-2xl border border-amber/25 bg-amber/10 px-4 py-3 text-[13px] text-amber">{t('video.musicPaused')}</div>
      )}
      <div className="relative mt-5 truncate font-mono text-[11.5px] text-dim">{eng.installPath}</div>
    </Card>
  )
}

// ─── Models ──────────────────────────────────────────────────────────────────
function ModelsSection() {
  const t = useT()
  const models = useApp((s) => s.videoModels)
  const settings = useApp((s) => s.settings)
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<VideoModelKind>('diffusion')
  const [adding, setAdding] = useState(false)
  const groups: { id: string; kinds: VideoModelKind[]; icon: React.ReactNode }[] = [
    { id: 'diffusion', kinds: ['diffusion'], icon: <Film className="size-4" /> },
    { id: 'lora', kinds: ['lora'], icon: <Sparkles className="size-4" /> },
    { id: 'core', kinds: ['text_encoder', 'vae'], icon: <Boxes className="size-4" /> },
  ]
  const add = async () => {
    setAdding(true)
    const r = await attempt(() => api.videoModelAddUrl(url, kind), t('video.models.added'))
    setAdding(false)
    if (r) setUrl('')
  }
  return (
    <section className="mt-7">
      <h2 className="mb-3 flex items-center gap-2 font-display text-[18px] font-semibold">
        <Boxes className="size-5 text-orchid" /> {t('video.models.title')}
      </h2>
      <Card className="mb-5">
        <CardTitle icon={<Link2 className="size-4" />}>{t('video.models.add')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="field min-w-[280px] flex-1 font-mono !text-[12.5px]"
            placeholder="https://huggingface.co/<org>/<repo>/blob/main/<file>.safetensors"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && url.trim()) void add()
            }}
          />
          <Segmented
            value={kind}
            onChange={setKind}
            options={[
              { value: 'diffusion', label: t('video.models.kind.diffusion') },
              { value: 'lora', label: 'LoRA' },
            ]}
          />
          <Button variant="primary" icon={<Download className="size-4" />} loading={adding} disabled={!url.trim()} onClick={add}>
            {t('video.models.addBtn')}
          </Button>
          <Button
            variant="soft"
            icon={<Upload className="size-4" />}
            onClick={async () => {
              const p = await api.pickModelFile()
              if (p) await attempt(() => api.videoModelImport(p, kind), t('video.models.imported'))
            }}
          >
            {t('video.models.import')}
          </Button>
        </div>
        <p className="mt-2.5 text-[12px] text-dim">{t('video.models.addHint')}</p>
      </Card>
      <div className="space-y-6">
        {groups.map((g) => {
          const list = models.filter((m) => g.kinds.includes(m.kind))
          if (!list.length && g.id === 'lora') return null
          return (
            <div key={g.id}>
              <h3 className="mb-2.5 flex items-center gap-2 font-display text-[14.5px] font-semibold text-muted">
                <span className="text-orchid">{g.icon}</span>
                {t(`video.models.group.${g.id}`)}
              </h3>
              <div className="grid grid-cols-2 gap-4 max-[1280px]:grid-cols-1">
                {list.map((m) => (
                  <ModelCard key={`${m.kind}/${m.file}`} m={m} isDefault={m.kind === 'diffusion' && settings?.videoModel === m.file} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ModelCard({ m, isDefault }: { m: VideoModelInfo; isDefault: boolean }) {
  const t = useT()
  const desc = m.bundled ? t(`video.models.desc.${m.kind}`) : m.url ? sourceOf(m.url) : t('video.models.local')
  return (
    <Card className="!p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium" title={m.file}>
              {m.file}
            </span>
            {m.installed && (
              <Badge tone="mint">
                <CircleCheck className="size-3" /> {t('models.installed')}
              </Badge>
            )}
            {isDefault && (
              <Badge tone="violet">
                <Star className="size-3" /> {t('models.default')}
              </Badge>
            )}
          </div>
          <p className="mt-1.5 truncate text-[12.5px] leading-snug text-muted" title={m.url ?? ''}>
            {desc}
          </p>
          <div className="mt-1.5 text-[11.5px] text-dim">{m.installed ? fmtBytes(m.sizeBytes) : m.approxGB ? `~${m.approxGB} GB` : ''}</div>
          {m.error && !m.downloading && <div className="mt-1.5 text-[12px] text-rose">{m.error}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!m.installed && !m.downloading && m.url && (
            <Button size="sm" variant="soft" icon={<Download className="size-3.5" />} onClick={() => attempt(() => api.videoModelDownload(m.kind, m.file))}>
              {t('common.download')}
            </Button>
          )}
          {m.downloading && (
            <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => api.videoModelCancel(m.kind, m.file)}>
              {t('common.cancel')}
            </Button>
          )}
          {m.installed && m.kind === 'diffusion' && !isDefault && (
            <Button size="sm" variant="ghost" onClick={() => attempt(() => api.setSettings({ videoModel: m.file }))}>
              {t('models.setDefault')}
            </Button>
          )}
          {(m.kind === 'diffusion' || m.kind === 'lora') && (m.installed || m.custom) && !m.downloading && (
            <IconButton
              tone="danger"
              title={t('common.delete')}
              onClick={() => {
                if (confirm(t('video.models.confirmRemove', { f: m.file }))) void attempt(() => api.videoModelRemove(m.kind, m.file))
              }}
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
        </div>
      </div>
      {m.downloading && (
        <div className="mt-3 flex items-center gap-3">
          <ProgressBar value={m.progress} className="flex-1" />
          <span className="w-10 text-right font-mono text-[12px] text-muted">{m.progress !== null ? `${Math.round(m.progress * 100)}%` : ''}</span>
        </div>
      )}
    </Card>
  )
}

function sourceOf(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'huggingface.co') return `huggingface.co/${u.pathname.split('/').slice(1, 3).join('/')}`
    return u.hostname
  } catch {
    return url
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────
function VideoSettingsCard() {
  const t = useT()
  const s = useApp((st) => st.settings)
  const [port, setPort] = useState(String(s?.videoPort ?? 8188))
  useEffect(() => setPort(String(s?.videoPort ?? 8188)), [s?.videoPort])
  if (!s) return null
  const set = (patch: Parameters<typeof api.videoSetSettings>[0]) => attempt(() => api.videoSetSettings(patch))
  return (
    <Card className="mt-7">
      <CardTitle icon={<Settings2 className="size-4" />}>{t('video.settings.title')}</CardTitle>
      <div className="grid grid-cols-2 gap-x-8 gap-y-5 max-[1100px]:grid-cols-1">
        <Toggle checked={s.videoGpuSwap} onChange={(videoGpuSwap) => set({ videoGpuSwap })} label={t('video.settings.gpuSwap')} hint={t('video.settings.gpuSwapHint')} />
        <Toggle checked={s.videoLowVram} onChange={(videoLowVram) => set({ videoLowVram })} label={t('video.settings.lowVram')} hint={t('video.settings.lowVramHint')} />
        <Field label={t('video.settings.output')}>
          <div className="flex gap-2">
            <input className="field font-mono !text-[12.5px]" value={s.videoOutputDir} readOnly />
            <Button
              variant="soft"
              icon={<FolderOpen className="size-4" />}
              onClick={async () => {
                const p = await api.pickFolder(s.videoOutputDir)
                if (p) await set({ videoOutputDir: p })
              }}
            >
              {t('common.browse')}
            </Button>
          </div>
        </Field>
        <Field label={t('video.settings.port')} hint={t('video.settings.portHint')}>
          <input
            className="field !w-32 font-mono"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
            onBlur={() => {
              const n = Number(port)
              if (n >= 1024 && n <= 65535 && n !== s.videoPort) void set({ videoPort: n })
              else setPort(String(s.videoPort))
            }}
          />
        </Field>
      </div>
    </Card>
  )
}
