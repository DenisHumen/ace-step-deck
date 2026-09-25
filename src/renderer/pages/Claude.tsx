import { useEffect, useState } from 'react'
import { Bot, Check, MessageSquareQuote, Plug, Terminal, Wrench, Sparkles } from 'lucide-react'
import { useApp, attempt } from '../lib/store'
import { api, type McpConfig } from '../lib/api'
import { useT } from '../i18n'
import { Badge, Button, Card, CardTitle, CopyButton, PageHeader, StatusDot, Toggle } from '../components/ui'

const TOOLS: [string, string][] = [
  ['acedeck_status', 'claude.tool.status'],
  ['engine_control', 'claude.tool.engine'],
  ['generate_music', 'claude.tool.generate'],
  ['transform_audio', 'claude.tool.transform'],
  ['draft_song', 'claude.tool.draft'],
  ['list_queue · get_job · job_control · queue_control', 'claude.tool.queue'],
  ['list_tracks', 'claude.tool.tracks'],
  ['run_diagnostics', 'claude.tool.diag'],
  ['engine_logs', 'claude.tool.logs'],
]

export function ClaudePage() {
  const t = useT()
  const s = useApp((x) => x.settings)
  const [cfg, setCfg] = useState<McpConfig | null>(null)
  const [added, setAdded] = useState(false)
  useEffect(() => {
    void api.mcpConfig().then(setCfg)
  }, [added])
  if (!s) return null
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title={t('claude.title')} subtitle={t('claude.subtitle')} />
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-5 max-[1280px]:grid-cols-1">
        <div className="space-y-5">
          <Card className="relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_0%_0%,rgba(217,119,87,0.22),transparent_60%)]" />
            <div className="relative">
              <CardTitle icon={<Sparkles className="size-4" />}>{t('claude.why')}</CardTitle>
              <p className="text-[13.5px] leading-relaxed text-muted">{t('claude.why.text')}</p>
            </div>
          </Card>
          <Card>
            <CardTitle icon={<Bot className="size-4" />} right={cfg?.desktopInstalled ? <Badge tone="mint"><Check className="size-3" />{t('claude.desktop.installed')}</Badge> : null}>
              {t('claude.desktop')}
            </CardTitle>
            <Button
              variant="primary"
              icon={<Plug className="size-4" />}
              onClick={async () => {
                const r = await attempt(() => api.installClaudeDesktop(), t('claude.desktop.added'))
                if (r) setAdded(true)
              }}
            >
              {t('claude.desktop.add')}
            </Button>
            <div className="mt-2 truncate font-mono text-[11px] text-dim">{cfg?.desktopConfigPath}</div>
          </Card>
          <Card>
            <CardTitle icon={<Terminal className="size-4" />} right={cfg && <CopyButton text={cfg.claudeCodeCommand} label={t('common.copy')} />}>
              {t('claude.code')}
            </CardTitle>
            <p className="mb-2 text-[13px] text-muted">{t('claude.code.desc')}</p>
            <pre className="console overflow-x-auto rounded-xl bg-black/40 p-3 break-all whitespace-pre-wrap text-[#e0c8ff] select-text">{cfg?.claudeCodeCommand}</pre>
          </Card>
          <Card>
            <CardTitle icon={<Wrench className="size-4" />} right={cfg && <CopyButton text={cfg.desktopJson} label={t('common.copy')} />}>
              {t('claude.json')}
            </CardTitle>
            <pre className="console max-h-56 overflow-auto rounded-xl bg-black/40 p-3 text-[#b9e6ff] select-text">{cfg?.desktopJson}</pre>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardTitle icon={<Plug className="size-4" />}>{t('claude.api')}</CardTitle>
            <Toggle
              checked={s.controlApiEnabled}
              onChange={(controlApiEnabled) => attempt(() => api.setSettings({ controlApiEnabled }))}
              label={
                <span className="flex items-center gap-2">
                  <StatusDot tone={s.controlApiEnabled ? 'mint' : 'dim'} pulse={s.controlApiEnabled} />
                  {t('claude.api.port', { port: s.controlApiPort })}
                </span>
              }
              hint={t('claude.api.desc')}
            />
          </Card>
          <Card>
            <CardTitle icon={<Wrench className="size-4" />}>{t('claude.tools')}</CardTitle>
            <div className="space-y-2">
              {TOOLS.map(([name, desc]) => (
                <div key={name} className="flex gap-3 border-b border-white/[0.05] pb-2 last:border-0">
                  <code className="shrink-0 font-mono text-[12px] text-orchid">{name}</code>
                  <span className="text-[12.5px] text-muted">{t(desc)}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardTitle icon={<MessageSquareQuote className="size-4" />}>{t('claude.examples')}</CardTitle>
            <div className="space-y-2">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="rounded-2xl rounded-tl-md bg-white/[0.05] px-4 py-2.5 text-[13px] text-fg/90">
                  {t(`claude.example.${n}`)}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
