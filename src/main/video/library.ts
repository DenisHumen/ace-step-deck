import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { VideoClip } from '@shared/video'
import { emit, readJson, writeJson } from '../util'

const indexFile = () => join(app.getPath('userData'), 'video-library.json')

class VideoLibrary {
  private clips: VideoClip[] = []

  async load(): Promise<void> {
    const saved = await readJson<VideoClip[]>(indexFile(), [])
    this.clips = saved.filter((c) => existsSync(c.file))
    if (this.clips.length !== saved.length) await this.save()
  }

  list(): VideoClip[] {
    return this.clips
  }

  get(id: string): VideoClip | undefined {
    return this.clips.find((c) => c.id === id)
  }

  private async save(): Promise<void> {
    await writeJson(indexFile(), this.clips)
    emit('video:library', this.clips)
  }

  async add(clip: VideoClip): Promise<void> {
    this.clips.unshift(clip)
    const { file, ...meta } = clip
    await fsp.writeFile(file.replace(/\.[^.]+$/, '.json'), JSON.stringify({ ...meta, video: basename(file) }, null, 2), 'utf8').catch(() => {})
    await this.save()
  }

  async update(id: string, patch: Partial<Pick<VideoClip, 'title' | 'favorite'>>): Promise<VideoClip | undefined> {
    const c = this.get(id)
    if (!c) return undefined
    Object.assign(c, patch)
    await this.save()
    return c
  }

  async remove(id: string): Promise<void> {
    const c = this.get(id)
    if (!c) return
    for (const f of [c.file, c.file.replace(/\.[^.]+$/, '.json')]) {
      if (existsSync(f)) await shell.trashItem(f).catch(() => {})
    }
    this.clips = this.clips.filter((x) => x.id !== id)
    await this.save()
  }

  async saveAs(id: string, win: BrowserWindow | null): Promise<string | null> {
    const c = this.get(id)
    if (!c) return null
    const ext = extname(c.file).slice(1)
    const opts = {
      title: 'Save video',
      defaultPath: join(app.getPath('downloads'), `${c.title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await fsp.copyFile(c.file, res.filePath)
    return res.filePath
  }

  reveal(id: string): void {
    const c = this.get(id)
    if (c) shell.showItemInFolder(c.file)
  }
}

export const videoLibrary = new VideoLibrary()
