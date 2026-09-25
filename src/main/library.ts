import { app, BrowserWindow, dialog, shell } from 'electron'
import { existsSync, promises as fsp } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { Track } from '@shared/types'
import { emit, readJson, writeJson } from './util'
import { numericOrNull, probeDuration } from './media'

const indexFile = () => join(app.getPath('userData'), 'library.json')

class Library {
  private tracks: Track[] = []

  async load(): Promise<void> {
    const saved = await readJson<Track[]>(indexFile(), [])
    // Drop entries whose audio was deleted outside the app.
    this.tracks = saved.filter((t) => existsSync(t.file))
    if (this.tracks.length !== saved.length) await this.save()
    void this.repairMetadata()
  }

  /** Older entries may hold "N/A" from the engine; read the real duration from the file. */
  private async repairMetadata(): Promise<void> {
    let changed = false
    for (const t of this.tracks) {
      if (numericOrNull(t.durationSec) === null) {
        t.durationSec = await probeDuration(t.file)
        changed = true
      }
      if (t.bpm !== null && numericOrNull(t.bpm) === null) {
        t.bpm = null
        changed = true
      }
      if (t.keyscale === 'N/A') {
        t.keyscale = ''
        changed = true
      }
    }
    if (changed) await this.save()
  }

  list(): Track[] {
    return this.tracks
  }

  get(id: string): Track | undefined {
    return this.tracks.find((t) => t.id === id)
  }

  private async save(): Promise<void> {
    await writeJson(indexFile(), this.tracks)
    emit('library:update', this.tracks)
  }

  async add(track: Track): Promise<void> {
    this.tracks.unshift(track)
    // Sidecar JSON keeps the prompt/lyrics/seed next to the audio for portability.
    const { file, ...meta } = track
    await fsp.writeFile(file.replace(/\.[^.]+$/, '.json'), JSON.stringify({ ...meta, audio: basename(file) }, null, 2), 'utf8').catch(() => {})
    await this.save()
  }

  async update(id: string, patch: Partial<Pick<Track, 'title' | 'favorite'>>): Promise<Track | undefined> {
    const t = this.get(id)
    if (!t) return undefined
    Object.assign(t, patch)
    await this.save()
    return t
  }

  async remove(id: string): Promise<void> {
    const t = this.get(id)
    if (!t) return
    // Recycle bin, never a hard delete.
    for (const f of [t.file, t.file.replace(/\.[^.]+$/, '.json')]) {
      if (existsSync(f)) await shell.trashItem(f).catch(() => {})
    }
    this.tracks = this.tracks.filter((x) => x.id !== id)
    await this.save()
  }

  async saveAs(id: string, win: BrowserWindow | null): Promise<string | null> {
    const t = this.get(id)
    if (!t) return null
    const ext = extname(t.file).slice(1)
    const opts = {
      title: 'Save track',
      defaultPath: join(app.getPath('downloads'), `${t.title.replace(/[\\/:*?"<>|]+/g, '_')}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    await fsp.copyFile(t.file, res.filePath)
    return res.filePath
  }

  reveal(id: string): void {
    const t = this.get(id)
    if (t) shell.showItemInFolder(t.file)
  }
}

export const library = new Library()
