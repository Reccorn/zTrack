import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AiPullProgress, AppData, ZApi } from '@shared/types'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: ZApi = {
  getData: () => ipcRenderer.invoke('data:get'),
  upsertItem: (item) => ipcRenderer.invoke('item:upsert', item),
  deleteItem: (id) => ipcRenderer.invoke('item:delete', id),
  restoreItem: (item) => ipcRenderer.invoke('item:restore', item),
  toggleOccurrence: (id, date, done) => ipcRenderer.invoke('item:toggle', id, date, done),
  excludeOccurrence: (id, date) => ipcRenderer.invoke('item:exclude', id, date),
  upsertTag: (tag) => ipcRenderer.invoke('tag:upsert', tag),
  deleteTag: (id) => ipcRenderer.invoke('tag:delete', id),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  openDataFolder: () => ipcRenderer.invoke('data:open-folder'),
  testNotification: () => ipcRenderer.invoke('notify:test'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  onDataChanged: (cb) => on<[AppData]>('data-changed', cb),
  onOpenItem: (cb) => on<[string]>('open-item', cb),
  onNewItem: (cb) => on<[]>('new-item', cb),
  aiStatus: () => ipcRenderer.invoke('ai:status'),
  aiPull: (model) => ipcRenderer.invoke('ai:pull', model),
  aiDeleteModel: (model) => ipcRenderer.invoke('ai:delete', model),
  aiCancel: () => ipcRenderer.invoke('ai:cancel'),
  aiParseTask: (text, ctx) => ipcRenderer.invoke('ai:parse', text, ctx),
  aiBreakdown: (title, notes, existing) => ipcRenderer.invoke('ai:breakdown', title, notes, existing),
  aiPlanWeek: (weekStart) => ipcRenderer.invoke('ai:plan-week', weekStart),
  aiSearch: (q) => ipcRenderer.invoke('ai:search', q),
  aiTranscribe: (wav) => ipcRenderer.invoke('ai:transcribe', wav),
  onAiPullProgress: (cb) => on<[AiPullProgress]>('ai-pull-progress', cb)
}

contextBridge.exposeInMainWorld('api', api)
