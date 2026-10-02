import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, NO_REPEAT, emptyData, type AppData, type Item, type Tag } from '@shared/types'

const FILE_NAME = 'ztrack-data.json'

function dataDir(): string {
  return app.getPath('userData')
}

export function dataFile(): string {
  return path.join(dataDir(), FILE_NAME)
}

export function backupsDir(): string {
  return path.join(dataDir(), 'backups')
}

function str(v: unknown, def = ''): string {
  return typeof v === 'string' ? v : def
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function normalizeItem(raw: any): Item | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return null
  const now = new Date().toISOString()
  const r = raw.recurrence && typeof raw.recurrence === 'object' ? raw.recurrence : NO_REPEAT
  const freq = ['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(r.freq) ? r.freq : 'none'
  return {
    id: raw.id,
    type: raw.type === 'event' ? 'event' : 'task',
    title: str(raw.title, 'Без названия'),
    notes: str(raw.notes),
    date: strOrNull(raw.date),
    time: strOrNull(raw.time),
    endTime: strOrNull(raw.endTime),
    priority: [0, 1, 2, 3].includes(raw.priority) ? raw.priority : 0,
    tags: strArr(raw.tags),
    reminder: typeof raw.reminder === 'number' && raw.reminder >= 0 ? raw.reminder : null,
    recurrence: {
      freq,
      interval: Math.max(1, Number(r.interval) || 1),
      weekdays: Array.isArray(r.weekdays) ? r.weekdays.filter((d: unknown) => typeof d === 'number' && d >= 0 && d <= 6) : [],
      until: strOrNull(r.until)
    },
    done: !!raw.done,
    doneAt: strOrNull(raw.doneAt),
    completedDates: strArr(raw.completedDates),
    excludedDates: strArr(raw.excludedDates),
    subtasks: Array.isArray(raw.subtasks)
      ? raw.subtasks
          .filter((st: any) => st && typeof st.title === 'string' && st.title.trim())
          .map((st: any, i: number) => ({
            id: typeof st.id === 'string' ? st.id : `${raw.id}-s${i}`,
            title: String(st.title).trim().slice(0, 200),
            done: !!st.done
          }))
      : [],
    createdAt: str(raw.createdAt, now),
    updatedAt: str(raw.updatedAt, now)
  }
}

function normalizeTag(raw: any): Tag | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null
  return { id: raw.id, name: raw.name, color: str(raw.color, '#7c5cff') }
}

export function normalizeData(raw: any): AppData {
  const base = emptyData()
  if (!raw || typeof raw !== 'object') return base
  const data: AppData = {
    version: 1,
    items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) as Item[] : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(normalizeTag).filter(Boolean) as Tag[] : [],
    settings: normalizeSettings(raw.settings),
    notified: raw.notified && typeof raw.notified === 'object' ? raw.notified : {}
  }
  dedupeTags(data)
  return data
}

/** Склеивает метки с одинаковым названием (без учёта регистра), переназначая их у задач. Возвращает true, если что-то изменилось */
export function dedupeTags(data: AppData): boolean {
  const byName = new Map<string, Tag>()
  const remap = new Map<string, string>()
  const kept: Tag[] = []
  for (const t of data.tags) {
    const key = t.name.trim().toLowerCase()
    const first = byName.get(key)
    if (first) remap.set(t.id, first.id)
    else {
      byName.set(key, t)
      kept.push(t)
    }
  }
  const known = new Set(kept.map((t) => t.id))
  let changed = kept.length !== data.tags.length
  data.tags = kept
  for (const item of data.items) {
    const next = [...new Set(item.tags.map((id) => remap.get(id) ?? id))].filter((id) => known.has(id))
    if (next.length !== item.tags.length || next.some((id, i) => id !== item.tags[i])) {
      item.tags = next
      changed = true
    }
  }
  return changed
}

function normalizeSettings(raw: any): AppData['settings'] {
  const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
  if (typeof s.aiUrl !== 'string' || !/^https?:\/\//.test(s.aiUrl)) s.aiUrl = DEFAULT_SETTINGS.aiUrl
  if (typeof s.aiModel !== 'string' || !s.aiModel.trim()) s.aiModel = DEFAULT_SETTINGS.aiModel
  if (typeof s.aiEmbedModel !== 'string' || !s.aiEmbedModel.trim()) s.aiEmbedModel = DEFAULT_SETTINGS.aiEmbedModel
  if (typeof s.aiKeepAlive !== 'number' || s.aiKeepAlive < 0) s.aiKeepAlive = DEFAULT_SETTINGS.aiKeepAlive
  return s
}

let data: AppData = emptyData()

export function getData(): AppData {
  return data
}

export function setData(next: AppData): void {
  data = next
  save()
}

export function load(): AppData {
  const file = dataFile()
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
      data = normalizeData(raw)
      // если при загрузке склеились дубликаты меток — сохраняем исправленные данные
      if (Array.isArray(raw.tags) && raw.tags.length !== data.tags.length) save()
      return data
    }
  } catch (e) {
    console.error('[zTrack] Не удалось прочитать данные, пробую резервную копию', e)
    try {
      // сохраняем повреждённый файл, чтобы ничего не потерять
      fs.copyFileSync(file, file + '.broken-' + Date.now())
    } catch {
      /* ignore */
    }
    try {
      const bak = file + '.bak'
      if (fs.existsSync(bak)) {
        data = normalizeData(JSON.parse(fs.readFileSync(bak, 'utf-8')))
        return data
      }
    } catch (e2) {
      console.error('[zTrack] Резервная копия тоже не читается', e2)
    }
  }
  data = emptyData()
  return data
}

export function save(): void {
  const file = dataFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.bak')
    } catch {
      /* ignore */
    }
  }
  fs.renameSync(tmp, file)
}

/** Ежедневная копия данных, хранятся последние 14 */
export function dailyBackup(): void {
  try {
    const dir = backupsDir()
    fs.mkdirSync(dir, { recursive: true })
    const d = new Date()
    const name = `ztrack-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`
    const target = path.join(dir, name)
    if (!fs.existsSync(target) && data.items.length) {
      fs.writeFileSync(target, JSON.stringify(exportable(), null, 2), 'utf-8')
    }
    const files = fs.readdirSync(dir).filter((f) => /^ztrack-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(dir, f))
  } catch (e) {
    console.error('[zTrack] backup failed', e)
  }
}

export function exportable(): Omit<AppData, 'notified'> & { app: string; exportedAt: string } {
  const { notified: _n, ...rest } = data
  return { app: 'zTrack', exportedAt: new Date().toISOString(), ...rest }
}
