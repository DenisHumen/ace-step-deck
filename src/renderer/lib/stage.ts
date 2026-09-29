/** Map ACE-Step's raw stage strings to friendly, localizable labels. */
export function stageKey(stage: string): string | null {
  const s = stage.toLowerCase()
  if (/audio codes|phase 2/.test(s)) return 'stage.melody'
  if (/phase 1|sample|format|compos|lyrics|cot/.test(s)) return 'stage.compose'
  if (/generating music|diffusion|dit/.test(s)) return 'stage.render'
  if (/decod|vae/.test(s)) return 'stage.decode'
  if (/preparing|normaliz/.test(s)) return 'stage.finish'
  if (/^saving/.test(s)) return 'stage.save'
  if (/submitting/.test(s)) return 'stage.submit'
  if (/queued on engine/.test(s)) return 'stage.engineQueue'
  if (/^running$/.test(s)) return 'stage.compose'
  if (/starting engine/.test(s)) return 'stage.startEngine'
  if (/waiting for the engine/.test(s)) return 'stage.waitEngine'
  if (/waiting for the gpu/.test(s)) return 'stage.waitGpu'
  if (/^queued$/.test(s)) return 'stage.queued'
  if (/^done$/.test(s)) return 'stage.done'
  return null
}

export function stageLabel(stage: string, t: (k: string) => string): string {
  const k = stageKey(stage)
  return k ? t(k) : stage
}
