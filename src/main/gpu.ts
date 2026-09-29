// One GPU, two engines. ACE-Step (music) and ComfyUI (video) take turns job by job: before a video
// renders, a loaded music engine that leaves too little VRAM is stopped (and restarted once the
// video queue is empty); before a song renders, ComfyUI is asked to unload its models.
import { VIDEO_MIN_FREE_VRAM_MB } from '@shared/video'
import { engine } from './engine'
import { videoEngine } from './video/engine'
import { gpuInfo } from './system'
import { getSettings } from './settings'
import { sleep } from './util'

export type GpuOwner = 'music' | 'video'

class GpuArbiter {
  private owner: GpuOwner | null = null
  private waiters: (() => void)[] = []
  /** We stopped the music engine to make room for video and owe it a restart. */
  private musicStoppedForVideo = false

  get busyWith(): GpuOwner | null {
    return this.owner
  }

  /** Wait for the GPU, prepare it for `who` and return the release function. */
  async acquire(who: GpuOwner): Promise<() => void> {
    await new Promise<void>((resolve) => {
      const grant = () => {
        this.owner = who
        resolve()
      }
      if (this.owner === null) grant()
      else this.waiters.push(grant)
    })
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.owner = null
      this.waiters.shift()?.()
    }
    try {
      await (who === 'video' ? this.prepareVideo() : this.prepareMusic())
    } catch (e: any) {
      videoEngine.log(`[gpu] ${e?.message ?? e}`, 'err')
    }
    return release
  }

  private async prepareMusic(): Promise<void> {
    if (this.musicStoppedForVideo) {
      // The music queue starts the engine itself; nothing is owed any more.
      this.musicStoppedForVideo = false
      videoEngine.setMusicPaused(false)
    }
    if (videoEngine.running && (await videoEngine.freeVram())) {
      videoEngine.log('[gpu] Unloaded video models to make room for music.')
      await sleep(1500)
    }
  }

  private async prepareVideo(): Promise<void> {
    if (!getSettings().videoGpuSwap || !engine.running || engine.status.external) return
    // A music engine that is still starting has not claimed its VRAM yet — free memory says nothing.
    const loading = engine.status.state === 'starting' || engine.status.state === 'loading'
    const gpu = (await gpuInfo())[0]
    if (!gpu) return
    const free = gpu.memoryTotalMB - gpu.memoryUsedMB
    if (!loading && free >= VIDEO_MIN_FREE_VRAM_MB) return
    videoEngine.log(`[gpu] ${loading ? 'Music engine is loading' : `${free} MB VRAM free`} — stopping the music engine while the video renders (it restarts afterwards).`)
    engine.log('Stopping to free VRAM for a video render; AceDeck restarts the engine afterwards.')
    this.musicStoppedForVideo = true
    videoEngine.setMusicPaused(true)
    await engine.stop()
  }

  /** Called when the video queue has nothing left: give the music engine back if we took it. */
  async videoIdle(): Promise<void> {
    if (!this.musicStoppedForVideo || this.owner === 'music') return
    this.musicStoppedForVideo = false
    videoEngine.setMusicPaused(false)
    await videoEngine.freeVram()
    await sleep(1500)
    engine.log('Video queue finished — restarting the music engine.')
    void engine.start().catch(() => {})
  }
}

export const gpu = new GpuArbiter()
