import { clsx } from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUpCircle,
  Activity,
  Bot,
  Boxes,
  Cpu,
  Download,
  ListMusic,
  Music2,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Library as LibraryIcon,
  Power,
  CircleAlert,
  CircleCheck,
  Info,
  Clapperboard,
  Film,
  MonitorPlay,
} from 'lucide-react'
import type { PageId } from '@shared/types'
import { useApp, attempt } from './lib/store'
import { useT } from './i18n'
import { api } from './lib/api'
import { engineTone, isTransitional, isUp } from './lib/engine-ui'
import { Button, StatusDot, WaveBars } from './components/ui'
import { PlayerBar } from './components/PlayerBar'
import { CreatePage } from './pages/Create'
import { QueuePage } from './pages/Queue'
import { LibraryPage } from './pages/Library'
import { EnginePage } from './pages/Engine'
import { DiagnosticsPage } from './pages/Diagnostics'
import { ModelsPage } from './pages/Models'
import { SetupPage } from './pages/Setup'
import { SettingsPage } from './pages/Settings'
import { ClaudePage } from './pages/Claude'
import { VideoStudioPage } from './pages/VideoStudio'
import { VideoLibraryPage } from './pages/VideoLibrary'
import { VideoEnginePage } from './pages/VideoEngine'
import { Logo } from './components/Logo'

const NAV: { group: string; items: { id: PageId; icon: typeof Music2; label: string }[] }[] = [
  {
    group: 'nav.group.studio',
    items: [
      { id: 'create', icon: Sparkles, label: 'nav.create' },
      { id: 'queue', icon: ListMusic, label: 'nav.queue' },
      { id: 'library', icon: LibraryIcon, label: 'nav.library' },
    ],
  },
  {
    group: 'nav.group.video',
    items: [
      { id: 'video', icon: Clapperboard, label: 'nav.video' },
      { id: 'videoLibrary', icon: Film, label: 'nav.videoLibrary' },
      { id: 'videoEngine', icon: MonitorPlay, label: 'nav.videoEngine' },
    ],
  },
  {
    group: 'nav.group.engine',
    items: [
      { id: 'engine', icon: Cpu, label: 'nav.engine' },
      { id: 'diagnostics', icon: Activity, label: 'nav.diagnostics' },
      { id: 'models', icon: Boxes, label: 'nav.models' },
      { id: 'setup', icon: Download, label: 'nav.setup' },
    ],
  },
  {
    group: 'nav.group.system',
    items: [
      { id: 'claude', icon: Bot, label: 'nav.claude' },
      { id: 'settings', icon: SettingsIcon, label: 'nav.settings' },
    ],
  },
]

function Sidebar() {
  const t = useT()
  const page = useApp((s) => s.page)
  const go = useApp((s) => s.go)
  const pending = useApp((s) => s.queue.jobs.filter((j) => j.status === 'pending' || j.status === 'running').length)
  const videoPending = useApp((s) => s.videoQueue.jobs.filter((j) => j.status === 'pending' || j.status === 'running').length)
  return (
    <aside className="glass-strong relative z-10 flex w-[248px] shrink-0 flex-col border-r border-white/[0.06] px-4 pb-4 max-[1150px]:w-[220px] max-[1150px]:px-3">
      <div className="drag flex h-[64px] items-center gap-2.5 px-2 pt-2">
        <Logo size={30} />
        <span className="font-display text-[18px] font-semibold tracking-tight">AceDeck</span>
      </div>
      <nav className="scroll-y -mx-1 mt-3 flex-1 px-1">
        {NAV.map((g) => (
          <div key={g.group} className="mb-5">
            <div className="label mb-2 px-3 !text-[10.5px]">{t(g.group)}</div>
            {g.items.map((it) => {
              const active = page === it.id
              const Icon = it.icon
              return (
                <button
                  key={it.id}
                  onClick={() => go(it.id)}
                  className={clsx(
                    'no-drag group mb-1 flex h-11 w-full items-center gap-3 rounded-full pr-3 pl-1.5 text-left transition-all',
                    active ? 'bg-white/[0.08] text-fg shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
                  )}
                >
                  <span
                    className={clsx(
                      'flex size-8 items-center justify-center rounded-full transition-all',
                      active ? 'brand-gradient text-white shadow-[0_6px_18px_-4px_rgba(240,67,198,0.7)]' : 'bg-white/[0.05] group-hover:bg-white/[0.08]',
                    )}
                  >
                    <Icon className="size-[16px]" />
                  </span>
                  <span className="font-display text-[13.5px] font-medium">{t(it.label)}</span>
                  {it.id === 'queue' && pending > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-magenta/90 px-1.5 text-[11px] font-semibold text-white">{pending}</span>
                  )}
                  {it.id === 'video' && videoPending > 0 && (
                    <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan/80 px-1.5 text-[11px] font-semibold text-ink-950">{videoPending}</span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <UpdatePill />
      <EngineCard />
    </aside>
  )
}

/** Shows up in the sidebar when a new AceDeck release is available, downloading or ready to install. */
function UpdatePill() {
  const t = useT()
  const u = useApp((s) => s.update)
  const go = useApp((s) => s.go)
  if (!u || (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'ready')) return null
  const label =
    u.state === 'available'
      ? t('update.sidebar.available', { v: u.latest ?? '' })
      : u.state === 'downloading'
        ? t('update.sidebar.downloading', { p: Math.round(u.percent * 100) })
        : t('update.sidebar.ready', { v: u.latest ?? '' })
  return (
    <button
      onClick={() => go('settings')}
      className="no-drag mb-3 flex w-full items-center gap-2.5 rounded-2xl border border-magenta/30 bg-magenta/10 px-3 py-2.5 text-left text-[12.5px] font-medium text-fg transition-colors hover:bg-magenta/15"
    >
      <span className="flex size-6 items-center justify-center rounded-full brand-gradient text-white">
        <ArrowUpCircle className="size-3.5" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function EngineCard() {
  const t = useT()
  const engine = useApp((s) => s.engine)
  const go = useApp((s) => s.go)
  const state = engine?.state
  const up = isUp(state)
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-white/[0.08] p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(240,67,198,0.28),transparent_60%),radial-gradient(circle_at_100%_100%,rgba(124,92,255,0.3),transparent_60%)]" />
      <div className="relative">
        <div className="flex items-center gap-2">
          <StatusDot tone={engineTone(state)} pulse={up || isTransitional(state)} />
          <span className="font-display text-[13px] font-semibold">{t('engineCard.title')}</span>
          <div className="ml-auto h-4 opacity-80">{state === 'busy' && <WaveBars count={8} seed="side" />}</div>
        </div>
        <div className="mt-1 text-[12px] text-muted">{t(`state.${state ?? 'not-installed'}`)}</div>
        {engine?.loadedModel && up && <div className="mt-0.5 truncate font-mono text-[11px] text-dim">{engine.loadedModel}</div>}
        <div className="mt-3">
          {state === 'not-installed' ? (
            <Button size="sm" variant="primary" className="w-full" icon={<Download className="size-3.5" />} onClick={() => go('setup')}>
              {t('engineCard.install')}
            </Button>
          ) : up || state === 'starting' || state === 'loading' ? (
            <Button size="sm" variant="soft" className="w-full" icon={<Power className="size-3.5" />} disabled={state === 'starting'} onClick={() => attempt(() => api.engineStop())}>
              {t('common.stop')}
            </Button>
          ) : (
            <Button size="sm" variant="primary" className="w-full" icon={<Power className="size-3.5" />} loading={state === 'stopping'} onClick={() => attempt(() => api.engineStart())}>
              {t('common.start')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function TopBar() {
  const t = useT()
  const search = useApp((s) => s.search)
  const setSearch = useApp((s) => s.setSearch)
  const go = useApp((s) => s.go)
  const tracks = useApp((s) => s.tracks.length)
  const gpu = useApp((s) => s.system?.gpus[0])
  const engine = useApp((s) => s.engine)
  const video = useApp((s) => s.videoEngine)
  const vram = gpu ? gpu.memoryUsedMB / Math.max(1, gpu.memoryTotalMB) : null
  return (
    <header className="drag relative z-10 flex h-[64px] shrink-0 items-center gap-3 pr-[150px] pl-8 max-[1150px]:pl-5">
      <div className="no-drag glass flex h-10 w-[340px] min-w-[180px] shrink items-center gap-2.5 rounded-full px-4">
        <Search className="size-4 text-dim" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            if (e.target.value) go('library')
          }}
          placeholder={t('search.placeholder')}
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-dim"
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {gpu && (
          <button onClick={() => go('engine')} className="no-drag glass flex h-9 items-center gap-2.5 rounded-full px-3.5 text-[12.5px] whitespace-nowrap text-muted hover:text-fg" title={gpu.name}>
            <Cpu className="size-3.5 text-cyan" />
            <span className="max-[1250px]:hidden">{t('top.vram')}</span>
            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-gradient-to-r from-cyan to-violet" style={{ width: `${(vram ?? 0) * 100}%` }} />
            </span>
            <span className="font-mono tabular-nums">{(gpu.memoryUsedMB / 1024).toFixed(1)}/{(gpu.memoryTotalMB / 1024).toFixed(0)} GB</span>
          </button>
        )}
        <button onClick={() => go('library')} className="no-drag glass flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] whitespace-nowrap text-muted hover:text-fg">
          <Music2 className="size-3.5 text-magenta" />
          {t('top.songs', { n: tracks })}
        </button>
        {video && (isUp(video.state) || isTransitional(video.state)) && (
          <button onClick={() => go('videoEngine')} className="no-drag glass flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] whitespace-nowrap text-muted hover:text-fg" title="ComfyUI">
            <Film className="size-3.5 text-cyan" />
            <StatusDot tone={engineTone(video.state)} pulse={isUp(video.state)} />
            <span className="max-[1250px]:hidden">{t(`video.state.${video.state}`)}</span>
          </button>
        )}
        <button onClick={() => go('engine')} className="no-drag glass flex h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] whitespace-nowrap text-muted hover:text-fg">
          <StatusDot tone={engineTone(engine?.state)} pulse={isUp(engine?.state)} />
          {t(`state.${engine?.state ?? 'not-installed'}`)}
        </button>
      </div>
    </header>
  )
}

function Toasts() {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed right-6 bottom-28 z-50 flex w-[380px] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 30 }}
            className="glass-strong pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3 text-[13px] shadow-2xl"
          >
            {t.kind === 'ok' ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-mint" /> : t.kind === 'err' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose" /> : <Info className="mt-0.5 size-4 shrink-0 text-cyan" />}
            <span className="min-w-0 break-words">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

const PAGES: Record<PageId, () => React.JSX.Element | null> = {
  create: CreatePage,
  queue: QueuePage,
  library: LibraryPage,
  engine: EnginePage,
  diagnostics: DiagnosticsPage,
  models: ModelsPage,
  setup: SetupPage,
  settings: SettingsPage,
  claude: ClaudePage,
  video: VideoStudioPage,
  videoLibrary: VideoLibraryPage,
  videoEngine: VideoEnginePage,
}

export function App() {
  const page = useApp((s) => s.page)
  const hasPlayer = useApp((s) => !!s.player.trackId)
  const Page = PAGES[page]
  return (
    <div className="flex h-full bg-ink-950">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Ambient glow like the reference hero */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="blob absolute -top-[260px] left-[5%] h-[520px] w-[620px] rounded-full bg-magenta/30 blur-[120px]" />
          <div className="blob absolute -top-[200px] right-[-5%] h-[520px] w-[640px] rounded-full bg-violet/30 blur-[130px]" style={{ animationDelay: '-6s' }} />
          <div className="absolute inset-x-0 top-[360px] bottom-0 bg-gradient-to-b from-transparent to-ink-950" />
        </div>
        <TopBar />
        <div className={clsx('scroll-y relative z-[1] flex-1 px-8 pt-2 max-[1150px]:px-5', hasPlayer ? 'pb-32' : 'pb-10')}>
          <AnimatePresence mode="wait">
            <motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              <Page />
            </motion.div>
          </AnimatePresence>
        </div>
        <PlayerBar />
      </main>
      <Toasts />
    </div>
  )
}
