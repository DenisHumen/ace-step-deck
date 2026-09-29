import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_PARAMS,
  WAN_TEXT_ENCODER,
  WAN_VAE,
  WF,
  buildWanWorkflow,
  clipCost,
  clipProgress,
  clipSeconds,
  normalizeVideoParams,
  parseModelUrl,
  stageForNode,
  videoJobTitle,
} from '../src/shared/video'

describe('parseModelUrl', () => {
  it('turns a Hugging Face blob page into a resolve link', () => {
    expect(parseModelUrl('https://huggingface.co/org/repo/blob/cab8a15/sub/model_e14.safetensors')).toEqual({
      url: 'https://huggingface.co/org/repo/resolve/cab8a15/sub/model_e14.safetensors',
      file: 'model_e14.safetensors',
    })
  })

  it('keeps resolve links and drops ?download=true', () => {
    expect(parseModelUrl(' https://huggingface.co/org/repo/resolve/main/lora.safetensors?download=true ')?.url).toBe('https://huggingface.co/org/repo/resolve/main/lora.safetensors')
  })

  it('accepts direct https links to .safetensors', () => {
    expect(parseModelUrl('https://example.com/files/a%20b.safetensors')).toEqual({ url: 'https://example.com/files/a%20b.safetensors', file: 'a b.safetensors' })
  })

  it('rejects repo pages, other file types and http', () => {
    expect(parseModelUrl('https://huggingface.co/org/repo')).toBeNull()
    expect(parseModelUrl('https://huggingface.co/org/repo/blob/main/README.md')).toBeNull()
    expect(parseModelUrl('http://example.com/x.safetensors')).toBeNull()
    expect(parseModelUrl('not a url')).toBeNull()
  })
})

describe('normalizeVideoParams', () => {
  it('fills defaults', () => {
    expect(normalizeVideoParams({ prompt: '  fox  ' })).toEqual({ ...DEFAULT_VIDEO_PARAMS, prompt: 'fox' })
  })

  it('snaps sizes to multiples of 16 and frames to 4n+1', () => {
    const p = normalizeVideoParams({ width: 830, height: 470, frames: 80 })
    expect(p.width % 16).toBe(0)
    expect(p.height % 16).toBe(0)
    expect((p.frames - 1) % 4).toBe(0)
    expect(p.frames).toBe(77)
  })

  it('clamps numbers and rejects unknown samplers', () => {
    const p = normalizeVideoParams({ steps: 999, cfg: -3, width: 99999, sampler: 'rm -rf', scheduler: 'karras' })
    expect(p.steps).toBe(100)
    expect(p.cfg).toBe(1)
    expect(p.width).toBe(1280)
    expect(p.sampler).toBe(DEFAULT_VIDEO_PARAMS.sampler)
    expect(p.scheduler).toBe('karras')
  })

  it('keeps at most four LoRAs with clamped strength', () => {
    const loras = Array.from({ length: 6 }, (_, i) => ({ file: `l${i}.safetensors`, strength: 5 }))
    const p = normalizeVideoParams({ loras })
    expect(p.loras).toHaveLength(4)
    expect(p.loras[0].strength).toBe(2)
  })
})

describe('buildWanWorkflow', () => {
  const p = normalizeVideoParams({ prompt: 'a fox', model: 'my_wan_finetune.safetensors', frames: 33 })

  it('wires the Wan 2.1 text-to-video graph', () => {
    const wf = buildWanWorkflow(p, 42, 'acedeck/test')
    expect(wf[WF.unet].inputs.unet_name).toBe('my_wan_finetune.safetensors')
    expect(wf[WF.clip].inputs).toMatchObject({ clip_name: WAN_TEXT_ENCODER, type: 'wan' })
    expect(wf[WF.vae].inputs.vae_name).toBe(WAN_VAE)
    expect(wf[WF.sampling].inputs.model).toEqual([WF.unet, 0])
    expect(wf[WF.sampler].inputs).toMatchObject({ seed: 42, steps: p.steps, cfg: p.cfg, model: [WF.sampling, 0] })
    expect(wf[WF.latent].inputs).toMatchObject({ width: 832, height: 480, length: 33 })
    expect(wf[WF.save]).toMatchObject({ class_type: 'SaveVideo', inputs: { filename_prefix: 'acedeck/test', format: 'mp4' } })
    // Every link points at a node that exists.
    for (const node of Object.values(wf)) {
      for (const v of Object.values(node.inputs)) if (Array.isArray(v)) expect(wf[v[0] as string]).toBeDefined()
    }
  })

  it('chains LoRAs between the model loader and the sampler', () => {
    const wf = buildWanWorkflow({ ...p, loras: [{ file: 'a.safetensors', strength: 0.8 }, { file: 'b.safetensors', strength: 1 }] }, 1, 'x')
    const a = String(WF.loraBase)
    const b = String(WF.loraBase + 1)
    expect(wf[a].inputs).toMatchObject({ model: [WF.unet, 0], lora_name: 'a.safetensors', strength_model: 0.8 })
    expect(wf[b].inputs.model).toEqual([a, 0])
    expect(wf[WF.sampling].inputs.model).toEqual([b, 0])
  })
})

describe('progress helpers', () => {
  it('maps node ids to stages', () => {
    expect(stageForNode(WF.unet)).toBe('loading')
    expect(stageForNode(String(WF.loraBase + 2))).toBe('loading')
    expect(stageForNode(WF.positive)).toBe('encoding')
    expect(stageForNode(WF.sampler)).toBe('sampling')
    expect(stageForNode(WF.decode)).toBe('decoding')
    expect(stageForNode(WF.save)).toBe('saving')
    expect(stageForNode(null)).toBeNull()
  })

  it('grows monotonically through the stages', () => {
    const seq = [clipProgress('loading', 0, 30), clipProgress('encoding', 0, 30), clipProgress('sampling', 1, 30), clipProgress('sampling', 30, 30), clipProgress('decoding', 0, 0), clipProgress('saving', 0, 0), clipProgress('done', 0, 0)]
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThan(seq[i - 1])
    expect(seq.at(-1)).toBe(1)
  })

  it('computes clip length and titles', () => {
    expect(clipSeconds(81, 16)).toBe(5)
    expect(videoJobTitle({ prompt: 'x'.repeat(100) }).length).toBe(60)
    expect(videoJobTitle({ prompt: '' })).toBe('Untitled clip')
  })
})

describe('clipCost', () => {
  it('is 1 for the reference clip and grows faster than linearly with length', () => {
    expect(clipCost({ width: 832, height: 480, frames: 81, steps: 30 })).toBeCloseTo(1, 6)
    const short = clipCost({ width: 832, height: 480, frames: 17, steps: 30 })
    expect(short).toBeLessThan(17 / 81)
    expect(clipCost({ width: 832, height: 480, frames: 81, steps: 15 })).toBeCloseTo(0.5, 6)
  })

  it('matches the measured 5060 Ti ratio within 15%', () => {
    // 640×368×17 @ 20 steps ≈ 22 s, 832×480×81 @ 30 steps ≈ 489 s of sampling.
    const ratio = clipCost({ width: 640, height: 368, frames: 17, steps: 20 })
    expect(Math.abs(ratio - 22 / 489) / (22 / 489)).toBeLessThan(0.15)
  })
})
