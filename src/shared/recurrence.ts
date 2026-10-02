import type { Item, Occurrence } from './types'

const DAY = 86400000

export function pad(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fromKey(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayKey(): string {
  return toKey(new Date())
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key)
  d.setDate(d.getDate() + n)
  return toKey(d)
}

/** разница в днях b - a (устойчиво к переходу на летнее время) */
export function diffDays(a: string, b: string): number {
  const da = fromKey(a)
  const db = fromKey(b)
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
  return Math.round((ub - ua) / DAY)
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

export function isRecurring(item: Item): boolean {
  return item.recurrence.freq !== 'none' && !!item.date
}

/** Происходит ли событие/задача в указанный день */
export function occursOn(item: Item, key: string): boolean {
  if (!item.date) return false
  const r = item.recurrence
  if (r.freq === 'none') return item.date === key
  if (key < item.date) return false
  if (r.until && key > r.until) return false
  if (item.excludedDates.includes(key)) return false

  const interval = Math.max(1, r.interval || 1)
  const start = fromKey(item.date)
  const d = fromKey(key)

  switch (r.freq) {
    case 'daily':
      return diffDays(item.date, key) % interval === 0
    case 'weekly': {
      const days = r.weekdays.length ? r.weekdays : [start.getDay()]
      if (!days.includes(d.getDay())) return false
      // номер недели считаем от понедельника недели старта
      const startMonday = addDays(item.date, -((start.getDay() + 6) % 7))
      const weeks = Math.floor(diffDays(startMonday, key) / 7)
      return weeks % interval === 0
    }
    case 'monthly': {
      const months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth())
      if (months % interval !== 0) return false
      const target = Math.min(start.getDate(), daysInMonth(d.getFullYear(), d.getMonth()))
      return d.getDate() === target
    }
    case 'yearly': {
      const years = d.getFullYear() - start.getFullYear()
      if (years % interval !== 0) return false
      if (d.getMonth() !== start.getMonth()) return false
      const target = Math.min(start.getDate(), daysInMonth(d.getFullYear(), d.getMonth()))
      return d.getDate() === target
    }
  }
  return false
}

export function isDoneOn(item: Item, key: string | null): boolean {
  if (isRecurring(item)) return key ? item.completedDates.includes(key) : false
  return item.done
}

export function occurrenceKey(item: Item, date: string | null): string {
  return `${item.id}|${date ?? 'nodate'}`
}

export function makeOcc(item: Item, date: string | null): Occurrence {
  return { item, date, done: isDoneOn(item, date), key: occurrenceKey(item, date) }
}

/** Все вхождения в диапазоне [from, to] включительно */
export function occurrencesInRange(items: Item[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = []
  const len = diffDays(from, to)
  for (const item of items) {
    if (!item.date) continue
    if (!isRecurring(item)) {
      if (item.date >= from && item.date <= to) out.push(makeOcc(item, item.date))
      continue
    }
    if (item.recurrence.until && item.recurrence.until < from) continue
    if (item.date > to) continue
    for (let i = 0; i <= len; i++) {
      const k = addDays(from, i)
      if (occursOn(item, k)) out.push(makeOcc(item, k))
    }
  }
  return out
}

/** Ближайшее вхождение начиная с даты (включительно), не далее чем через ~2 года */
export function nextOccurrence(item: Item, fromKeyStr: string): string | null {
  if (!item.date) return null
  if (!isRecurring(item)) return item.date
  let k = item.date > fromKeyStr ? item.date : fromKeyStr
  for (let i = 0; i < 800; i++) {
    if (item.recurrence.until && k > item.recurrence.until) return null
    if (occursOn(item, k)) return k
    k = addDays(k, 1)
  }
  return null
}

/** Время начала вхождения как Date */
export function occurrenceStart(item: Item, date: string): Date {
  const d = fromKey(date)
  if (item.time) {
    const [h, m] = item.time.split(':').map(Number)
    d.setHours(h, m, 0, 0)
  } else {
    d.setHours(9, 0, 0, 0) // задачи «на весь день» — напоминаем от 9:00
  }
  return d
}

export function compareOcc(a: Occurrence, b: Occurrence): number {
  if (a.done !== b.done) return a.done ? 1 : -1
  const da = a.date ?? '9999-99-99'
  const db = b.date ?? '9999-99-99'
  if (da !== db) return da < db ? -1 : 1
  const ta = a.item.time ?? ''
  const tb = b.item.time ?? ''
  if (ta !== tb) {
    if (!ta) return -1
    if (!tb) return 1
    return ta < tb ? -1 : 1
  }
  if (a.item.priority !== b.item.priority) return b.item.priority - a.item.priority
  return a.item.createdAt < b.item.createdAt ? -1 : 1
}
