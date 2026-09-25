import { useEffect, useState } from 'react'
import { Cpu, ExternalLink, FolderOpen, Globe2, Info, Settings2 } from 'lucide-react'
import type { AppInfo, Settings } from '@shared/types'
import { PROJECT_URL } from '@shared/constants'
import { useApp, attempt } from '../lib/store'
import { api } from '../lib/api'
import { useT } from '../i18n'
import { Button, Card, CardTitle, Field, PageHeader, Select, Toggle } from '../components/ui'
import { Logo } from '../components/Logo'

export function SettingsPage() {
  const t = useT()
  const s = useApp((x) => x.settings)
  const models = useApp((x) => x.models)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [port, setPort] = useState(String(s?.port ?? 8001))
  useEffect(() => {
    void api.appInfo().then(setInfo)
  }, [])
  if (!s) return null
  const save = (patch: Partial<Settings>) => attempt(() => api.setSettings(patch))
  const dits = models.filter((m) => m.kind === 'dit').map((m) => ({ value: m.name, label: `${m.name}${m.installed ? '' : ' ⤓'}` }))
  const lms = models.filter((m) => m.kind === 'lm').map((m) => ({ value: m.name, label: `${m.name}${m.installed ? '' : ' ⤓'}` }))

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title={t('settings.title')} />
      <div className="grid grid-cols-2 items-start gap-5 max-[1280px]:grid-cols-1">
        <div className="space-y-5">
          <Card>
            <CardTitle icon={<Globe2 className="size-4" />}>{t('settings.general')}</CardTitle>
            <div className="space-y-4">
              <Field label={t('settings.language')}>
                <Select value={s.language} onChange={(language) => save({ language })} options={[{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }]} />
              </Field>
              <Field label={t('settings.outputDir')}>
                <div className="flex gap-2">
                  <input className="field font-mono !text-[12.5px]" readOnly value={s.outputDir} />
                  <Button
                    variant="soft"
                    icon={<FolderOpen className="size-4" />}
                    onClick={async () => {
                      const p = await api.pickFolder(s.outputDir)
                      if (p) void save({ outputDir: p })
                    }}
                  />
                </div>
              </Field>
              <Toggle checked={s.notifyOnFinish} onChange={(notifyOnFinish) => save({ notifyOnFinish })} label={t('settings.notify')} />
            </div>
          </Card>
          <Card>
            <CardTitle icon={<Settings2 className="size-4" />}>{t('settings.startup')}</CardTitle>
            <div className="space-y-4">
              <Toggle checked={s.preloadModels} onChange={(preloadModels) => save({ preloadModels })} label={t('settings.preload')} />
              <Toggle checked={s.autoStartEngine} onChange={(autoStartEngine) => save({ autoStartEngine })} label={t('settings.autostart')} />
              <Toggle checked={s.stopEngineOnExit} onChange={(stopEngineOnExit) => save({ stopEngineOnExit })} label={t('settings.stopOnExit')} />
              <p className="text-[12px] text-dim">{t('settings.restartHint')}</p>
            </div>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardTitle icon={<Cpu className="size-4" />}>{t('settings.engine')}</CardTitle>
            <div className="space-y-4">
              <Field label={t('settings.installPath')}>
                <div className="flex gap-2">
                  <input className="field font-mono !text-[12.5px]" readOnly value={s.installPath ?? '—'} />
                  <Button
                    variant="soft"
                    icon={<FolderOpen className="size-4" />}
                    onClick={async () => {
                      const p = await api.pickFolder(s.installPath ?? undefined)
                      if (p) await attempt(() => api.engineUseInstall(p))
                    }}
                  />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('settings.defaultDit')}>
                  <Select value={s.ditModel} onChange={(ditModel) => save({ ditModel })} options={dits} />
                </Field>
                <Field label={t('settings.defaultLm')}>
                  <Select value={s.lmModel} onChange={(lmModel) => save({ lmModel })} options={lms} />
                </Field>
                <Field label={t('settings.port')}>
                  <input className="field font-mono" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} onBlur={() => Number(port) > 1024 && save({ port: Number(port) })} />
                </Field>
                <Field label={t('settings.initLlm')}>
                  <Select value={s.initLlm} onChange={(initLlm) => save({ initLlm })} options={[{ value: 'auto', label: t('common.auto') }, { value: 'true', label: t('common.on') }, { value: 'false', label: t('common.off') }]} />
                </Field>
              </div>
              <Field label={t('settings.lmBackend')} hint={t('settings.lmBackend.hint')}>
                <Select value={s.lmBackend} onChange={(lmBackend) => save({ lmBackend })} options={[{ value: 'auto', label: t('common.auto') }, { value: 'pt', label: 'PyTorch' }, { value: 'vllm', label: 'vLLM (nano-vllm)' }]} />
              </Field>
              <Field label={t('settings.offload')} hint={t('settings.offload.hint')}>
                <Select value={s.offload} onChange={(offload) => save({ offload })} options={[{ value: 'auto', label: t('common.auto') }, { value: 'on', label: t('common.on') }, { value: 'off', label: t('common.off') }]} />
              </Field>
            </div>
          </Card>
          <Card>
            <CardTitle icon={<Info className="size-4" />}>{t('settings.about')}</CardTitle>
            <div className="flex items-center gap-3">
              <Logo size={44} />
              <div>
                <div className="font-display text-[18px] font-semibold">AceDeck</div>
                <div className="text-[12.5px] text-muted">v{info?.version ?? '—'} · MIT</div>
              </div>
            </div>
            <p className="mt-3 text-[13px] text-muted">{t('settings.about.text')}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="soft" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openExternal(PROJECT_URL)}>
                {t('settings.github')}
              </Button>
              <Button size="sm" variant="soft" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openExternal('https://github.com/ace-step/ACE-Step-1.5')}>
                {t('settings.acestep')}
              </Button>
              {info && (
                <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => api.openPath(info.userData)}>
                  userData
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
