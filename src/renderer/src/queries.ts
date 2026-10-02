import { computed } from 'vue'
import { addDays, compareOcc, isRecurring, makeOcc, nextOccurrence, occurrencesInRange } from '@shared/recurrence'
import type { Item, Occurrence } from '@shared/types'
import { state, today, ui } from './store'

export interface Group {
  key: string
  title: string
  sub?: string
  tone?: 'danger'
  occs: Occurrence[]
  /** дата группы — для быстрого добавления */
  date?: string | null
}

function matchesSearch(item: Item, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  if (item.title.toLowerCase().includes(s) || item.notes.toLowerCase().includes(s)) return true
  if (item.subtasks.some((st) => st.title.toLowerCase().includes(s))) return true
  return item.tags.some((id) => state.data.tags.find((t) => t.id === id)?.name.toLowerCase().includes(s))
}

/** Элементы с учётом поиска */
export const visibleItems = computed(() => state.data.items.filter((i) => matchesSearch(i, ui.search.trim())))

export const overdue = computed<Occurrence[]>(() =>
  visibleItems.value
    .filter((i) => !isRecurring(i) && i.date && i.date < today.value && !i.done)
    .map((i) => makeOcc(i, i.date))
    .sort(compareOcc)
)

export function dayOccs(key: string, items = visibleItems.value): Occurrence[] {
  return occurrencesInRange(items, key, key).sort(compareOcc)
}

export const todayOccs = computed(() => dayOccs(today.value))

export const inboxOccs = computed(() =>
  visibleItems.value
    .filter((i) => !i.date)
    .map((i) => makeOcc(i, null))
    .sort(compareOcc)
)

export const counts = computed(() => {
  const all = state.data.items
  const t = today.value
  const od = all.filter((i) => !isRecurring(i) && i.date && i.date < t && !i.done).length
  const td = occurrencesInRange(all, t, t).filter((o) => !o.done).length
  const up = occurrencesInRange(all, addDays(t, 1), addDays(t, 7)).filter((o) => !o.done).length
  const inbox = all.filter((i) => !i.date && !i.done).length
  const tags: Record<string, number> = {}
  for (const i of all) {
    if (i.done && !isRecurring(i)) continue
    for (const tg of i.tags) tags[tg] = (tags[tg] ?? 0) + 1
  }
  return { today: od + td, overdue: od, upcoming: up, inbox, tags }
})

/** Активные элементы: просроченные, по датам (ближайшее вхождение), без даты */
export function activeGroups(items: Item[]): Group[] {
  const t = today.value
  const groups: Group[] = []
  const od = items.filter((i) => !isRecurring(i) && i.date && i.date < t && !i.done).map((i) => makeOcc(i, i.date))
  if (od.length) groups.push({ key: 'overdue', title: 'Просрочено', tone: 'danger', occs: od.sort(compareOcc) })

  const dated = new Map<string, Occurrence[]>()
  for (const i of items) {
    if (!i.date) continue
    if (!isRecurring(i) && (i.done || i.date < t)) continue
    const next = nextOccurrence(i, t)
    if (!next) continue
    // для повторяющихся пропускаем уже выполненное сегодня — показываем следующее
    let k: string | null = next
    if (isRecurring(i) && i.completedDates.includes(k)) k = nextOccurrence(i, addDays(k, 1))
    if (!k) continue
    const arr = dated.get(k) ?? []
    arr.push(makeOcc(i, k))
    dated.set(k, arr)
  }
  for (const k of [...dated.keys()].sort()) {
    groups.push({ key: k, title: k, date: k, occs: dated.get(k)!.sort(compareOcc) })
  }

  const nodate = items.filter((i) => !i.date && !i.done).map((i) => makeOcc(i, null))
  if (nodate.length) groups.push({ key: 'nodate', title: 'Без даты', occs: nodate.sort(compareOcc), date: null })
  return groups
}

export const doneOccs = computed<Occurrence[]>(() => {
  const out: Occurrence[] = []
  for (const i of visibleItems.value) {
    if (isRecurring(i)) for (const d of i.completedDates) out.push(makeOcc(i, d))
    else if (i.done) out.push(makeOcc(i, i.date))
  }
  return out.sort((a, b) => {
    const ka = a.item.doneAt && !isRecurring(a.item) ? a.item.doneAt : (a.date ?? '')
    const kb = b.item.doneAt && !isRecurring(b.item) ? b.item.doneAt : (b.date ?? '')
    return ka < kb ? 1 : -1
  })
})
