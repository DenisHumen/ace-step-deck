import { Boxes, Brain, CircleCheck, Download, Music4, Star } from 'lucide-react'
import type { ModelInfo } from '@shared/types'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { Badge, Button, Card, PageHeader, ProgressBar } from '../components/ui'

export function ModelsPage() {
  const t = useT()
  const models = useApp((s) => s.models)
  const settings = useApp((s) => s.settings)
  const engine = useApp((s) => s.engine)
  const dir = settings?.installPath ? `${settings.installPath}\\checkpoints` : '—'
  const groups: { kind: ModelInfo['kind']; icon: React.ReactNode }[] = [
    { kind: 'dit', icon: <Music4 className="size-4" /> },
    { kind: 'lm', icon: <Brain className="size-4" /> },
    { kind: 'core', icon: <Boxes className="size-4" /> },
  ]
  const setDefault = async (m: ModelInfo) => {
    await attempt(() => api.setSettings(m.kind === 'dit' ? { ditModel: m.name } : { lmModel: m.name }), t('models.restartHint'))
  }
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('models.title')} subtitle={t('models.subtitle', { dir })} />
      <div className="space-y-7">
        {groups.map((g) => (
          <section key={g.kind}>
            <h2 className="mb-3 flex items-center gap-2 font-display text-[16px] font-semibold">
              <span className="text-orchid">{g.icon}</span>
              {t(`models.kind.${g.kind}`)}
            </h2>
            <div className="grid grid-cols-2 gap-4 max-[1280px]:grid-cols-1">
              {models
                .filter((m) => m.kind === g.kind)
                .map((m) => {
                  const isDefault = (m.kind === 'dit' && settings?.ditModel === m.name) || (m.kind === 'lm' && settings?.lmModel === m.name)
                  return (
                    <Card key={m.name} className="!p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[13.5px] font-medium">{m.name}</span>
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
                          <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{t(`models.desc.${m.name}`)}</p>
                          <div className="mt-2 text-[11.5px] text-dim">
                            ~{m.approxGB} GB · {m.bundled ? t('models.bundled') : m.repo}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-2">
                          {!m.installed && !m.downloading && (
                            <Button size="sm" variant="soft" icon={<Download className="size-3.5" />} disabled={!engine?.installed} onClick={() => attempt(() => api.modelDownload(m.name))}>
                              {t('common.download')}
                            </Button>
                          )}
                          {m.installed && m.kind !== 'core' && !isDefault && (
                            <Button size="sm" variant="ghost" onClick={() => setDefault(m)}>
                              {t('models.setDefault')}
                            </Button>
                          )}
                        </div>
                      </div>
                      {m.downloading && (
                        <div className="mt-3 flex items-center gap-3">
                          <ProgressBar value={m.progress} className="flex-1" />
                          <span className="w-10 text-right font-mono text-[12px] text-muted">{Math.round((m.progress ?? 0) * 100)}%</span>
                        </div>
                      )}
                    </Card>
                  )
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
