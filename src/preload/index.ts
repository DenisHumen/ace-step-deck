import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: async (method: string, ...args: unknown[]) => {
    const r = await ipcRenderer.invoke('invoke', method, ...args)
    if (!r.ok) throw new Error(r.error)
    return r.data
  },
  on: (channel: string, cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
}

contextBridge.exposeInMainWorld('acedeck', api)
export type PreloadApi = typeof api
