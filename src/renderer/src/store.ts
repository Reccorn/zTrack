import { computed, reactive, ref, watch } from 'vue'
import { isRecurring, todayKey } from '@shared/recurrence'
import { emptyData, NO_REPEAT, type AppData, type Item, type Occurrence, type Tag } from '@shared/types'
import { TAG_COLORS, plural, uid } from './fmt'

export type View = 'today' | 'upcoming' | 'inbox' | 'all' | 'calendar' | 'done' | 'tag' | 'settings'

const api = window.api

export const state = reactive<{ data: AppData; loaded: boolean }>({ data: emptyData(), loaded: false })
export const today = ref(todayKey())

export const ui = reactive({
  view: 'today' as View,
  tagId: null as string | null,
  search: '',
  calMode: 'week' as 'month' | 'week',
  calCursor: todayKey(),
  selectedDay: todayKey()
})

export const settings = computed(() => state.data.settings)
export const tagsById = computed(() => new Map(state.data.tags.map((t) => [t.id, t])))

// ---------- тема ----------
const media = window.matchMedia('(prefers-color-scheme: dark)')
const systemDark = ref(media.matches)
media.addEventListener('change', (e) => (systemDark.value = e.matches))
export const theme = computed(() => {
  const t = state.data.settings.theme
  return t === 'system' ? (systemDark.value ? 'dark' : 'light') : t
})
watch(theme, (t) => document.documentElement.setAttribute('data-theme', t), { immediate: true })

// ---------- загрузка ----------
export async function init(): Promise<void> {
  state.data = await api.getData()
  ui.calMode = state.data.settings.calMode
  state.loaded = true
  // запоминаем выбранный вид календаря
  watch(
    () => ui.calMode,
    (m) => {
      if (m !== state.data.settings.calMode) api.updateSettings({ calMode: m })
    }
  )
  api.onDataChanged((d) => {
    state.data = d
  })
  setInterval(() => {
    const t = todayKey()
    if (t !== today.value) {
      // наступил новый день
      if (ui.selectedDay === today.value) ui.selectedDay = t
      today.value = t
    }
  }, 20_000)
}

// ---------- тосты ----------
export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}
export const toasts = ref<Toast[]>([])
let toastSeq = 0
export function toast(text: string, action?: Toast['action'], ms = 5000): void {
  const id = ++toastSeq
  toasts.value.push({ id, text, action })
  if (toasts.value.length > 3) toasts.value.shift()
  setTimeout(() => (toasts.value = toasts.value.filter((t) => t.id !== id)), ms)
}
export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

// ---------- диалог подтверждения ----------
export interface ConfirmButton {
  label: string
  value: string
  kind?: 'primary' | 'danger' | 'ghost'
}
export const confirmState = reactive({
  open: false,
  title: '',
  message: '',
  buttons: [] as ConfirmButton[],
  resolve: null as ((v: string | null) => void) | null
})
export function ask(title: string, message: string, buttons: ConfirmButton[]): Promise<string | null> {
  return new Promise((resolve) => {
    Object.assign(confirmState, { open: true, title, message, buttons, resolve })
  })
}
export function closeConfirm(value: string | null): void {
  confirmState.resolve?.(value)
  confirmState.open = false
  confirmState.resolve = null
}

// ---------- редактор ----------
export const editor = reactive({
  open: false,
  isNew: false,
  item: null as Item | null,
  occDate: null as string | null,
  /** форма заполнена ИИ — показываем плашку «проверьте» */
  aiFilled: false,
  /** метки, которые предложил ИИ, но их ещё нет */
  aiNewTags: [] as string[]
})

export function blankItem(partial: Partial<Item> = {}): Item {
  const now = new Date().toISOString()
  return {
    id: uid(),
    type: 'task',
    title: '',
    notes: '',
    date: null,
    time: null,
    endTime: null,
    priority: 0,
    tags: [],
    reminder: state.data.settings.defaultReminder,
    recurrence: { ...NO_REPEAT, weekdays: [] },
    done: false,
    doneAt: null,
    completedDates: [],
    excludedDates: [],
    subtasks: [],
    createdAt: now,
    updatedAt: now,
    ...partial
  }
}

export function openNew(partial: Partial<Item> = {}): void {
  let date: string | null = today.value
  if (ui.view === 'inbox') date = null
  if (ui.view === 'calendar') date = ui.selectedDay
  const tags = ui.view === 'tag' && ui.tagId ? [ui.tagId] : []
  editor.item = blankItem({ date, tags, ...partial })
  editor.occDate = null
  editor.isNew = true
  editor.aiFilled = false
  editor.aiNewTags = []
  editor.open = true
}

/** Открыть форму с черновиком от ИИ */
export function openAiDraft(partial: Partial<Item>, newTags: string[]): void {
  openNew(partial)
  editor.aiFilled = true
  editor.aiNewTags = newTags
}

export function openEdit(item: Item, occDate: string | null = null): void {
  editor.item = JSON.parse(JSON.stringify(item))
  editor.occDate = occDate
  editor.isNew = false
  editor.aiFilled = false
  editor.aiNewTags = []
  editor.open = true
}

export function openById(id: string): void {
  const item = state.data.items.find((i) => i.id === id)
  if (item) openEdit(item, item.date)
}

export function closeEditor(): void {
  editor.open = false
}

// ---------- действия ----------
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export async function saveItem(item: Item): Promise<void> {
  await api.upsertItem(plain(item))
}

export async function toggleOcc(occ: Occurrence): Promise<void> {
  const next = !occ.done
  await api.toggleOccurrence(occ.item.id, occ.date, next)
  if (next) {
    toast(`«${occ.item.title}» — выполнено`, {
      label: 'Отменить',
      run: () => api.toggleOccurrence(occ.item.id, occ.date, false)
    }, 4000)
  }
}

export async function deleteOcc(item: Item, occDate: string | null): Promise<boolean> {
  if (isRecurring(item) && occDate) {
    const r = await ask('Удалить повторяющееся', `«${item.title}» повторяется. Что удалить?`, [
      { label: 'Отмена', value: 'cancel', kind: 'ghost' },
      { label: 'Только это', value: 'one' },
      { label: 'Всю серию', value: 'all', kind: 'danger' }
    ])
    if (r === 'one') {
      await api.excludeOccurrence(item.id, occDate)
      return true
    }
    if (r !== 'all') return false
  }
  const copy = plain(item)
  await api.deleteItem(item.id)
  toast(`Удалено: «${item.title}»`, { label: 'Вернуть', run: () => api.restoreItem(copy) }, 6000)
  return true
}

export async function moveItem(item: Item, date: string, time?: string | null): Promise<void> {
  const copy = plain(item)
  if (time !== undefined && time !== null && copy.time && copy.endTime) {
    // сохраняем длительность
    const [h1, m1] = copy.time.split(':').map(Number)
    const [h2, m2] = copy.endTime.split(':').map(Number)
    const dur = h2 * 60 + m2 - (h1 * 60 + m1)
    const [h, m] = time.split(':').map(Number)
    const end = Math.min(24 * 60 - 1, h * 60 + m + Math.max(15, dur))
    copy.endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
  }
  copy.date = date
  if (time !== undefined) copy.time = time
  await api.upsertItem(copy)
}

const pendingTags = new Map<string, Promise<Tag>>()

/** Создаёт метку или возвращает существующую с таким же названием (без учёта регистра) */
export function createTag(name: string): Promise<Tag> {
  const clean = name.trim().slice(0, 40)
  const key = clean.toLowerCase()
  const existing = state.data.tags.find((t) => t.name.toLowerCase() === key)
  if (existing) return Promise.resolve(existing)
  // защита от двойного вызова (например, Enter + потеря фокуса)
  const pending = pendingTags.get(key)
  if (pending) return pending
  const tag: Tag = { id: uid(), name: clean, color: TAG_COLORS[state.data.tags.length % TAG_COLORS.length] }
  const p = api
    .upsertTag(tag)
    .then((saved) => saved ?? tag)
    .finally(() => pendingTags.delete(key))
  pendingTags.set(key, p)
  return p
}

export async function renameTag(tag: Tag, name: string): Promise<void> {
  const clean = name.trim().slice(0, 40)
  if (!clean || clean === tag.name) return
  const saved = await api.upsertTag({ ...plain(tag), name: clean })
  if (saved && saved.id !== tag.id) toast(`Метка «${saved.name}» уже есть`)
}

export async function recolorTag(tag: Tag, color: string): Promise<void> {
  await api.upsertTag({ ...plain(tag), color })
}

export async function removeTag(tag: Tag): Promise<void> {
  const used = state.data.items.filter((i) => i.tags.includes(tag.id)).length
  const r = await ask(
    'Удалить метку',
    used
      ? `Метка «${tag.name}» стоит у ${used} ${plural(used, 'задачи', 'задач', 'задач')}. Задачи останутся, метка будет снята.`
      : `Удалить метку «${tag.name}»?`,
    [
      { label: 'Отмена', value: 'no', kind: 'ghost' },
      { label: 'Удалить', value: 'yes', kind: 'danger' }
    ]
  )
  if (r !== 'yes') return
  const copy = plain(tag)
  const itemIds = state.data.items.filter((i) => i.tags.includes(tag.id)).map((i) => i.id)
  await api.deleteTag(tag.id)
  toast(`Метка «${tag.name}» удалена`, {
    label: 'Вернуть',
    run: async () => {
      await api.upsertTag(copy)
      for (const id of itemIds) {
        const item = state.data.items.find((i) => i.id === id)
        if (item && !item.tags.includes(copy.id)) await api.upsertItem(plain({ ...item, tags: [...item.tags, copy.id] }))
      }
    }
  })
}

// если открыта метка, которую удалили, — возвращаемся на «Сегодня»
watch(
  () => state.data.tags.map((t) => t.id),
  (ids) => {
    if (ui.view === 'tag' && ui.tagId && !ids.includes(ui.tagId)) {
      ui.view = 'today'
      ui.tagId = null
    }
  }
)

export { api }

// ---------- локальный ИИ: доступность ----------
export const aiOn = computed(() => state.data.settings.aiEnabled)
