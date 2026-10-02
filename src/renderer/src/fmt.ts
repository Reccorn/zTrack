import { addDays, diffDays, fromKey } from '@shared/recurrence'
import type { Item } from '@shared/types'

export const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
export const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** «1 октября», с годом если не текущий */
export function dayMonth(key: string, withYear = false): string {
  const d = fromKey(key)
  const y = withYear || d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : ''
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${y}`
}

/** Короткая метка даты для строк: Сегодня / Завтра / Вчера / пт, 3 окт */
export function shortDate(key: string, today: string): string {
  const diff = diffDays(today, key)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Завтра'
  if (diff === -1) return 'Вчера'
  const d = fromKey(key)
  const y = d.getFullYear() !== fromKey(today).getFullYear() ? ` ${d.getFullYear()}` : ''
  if (diff > 1 && diff < 7) return `${cap(WD_SHORT[d.getDay()])}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}${y}`
}

/** Заголовок группы: «Сегодня · среда, 30 сентября» */
export function groupTitle(key: string, today: string): { main: string; sub: string } {
  const diff = diffDays(today, key)
  const d = fromKey(key)
  const full = `${WD_LONG[d.getDay()]}, ${dayMonth(key)}`
  if (diff === 0) return { main: 'Сегодня', sub: full }
  if (diff === 1) return { main: 'Завтра', sub: full }
  if (diff === -1) return { main: 'Вчера', sub: full }
  return { main: cap(full), sub: '' }
}

export function timeRange(item: Item): string {
  if (!item.time) return ''
  return item.endTime ? `${item.time}–${item.endTime}` : item.time
}

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: 'Без напоминания' },
  { value: 0, label: 'В момент начала' },
  { value: 5, label: 'За 5 минут' },
  { value: 10, label: 'За 10 минут' },
  { value: 15, label: 'За 15 минут' },
  { value: 30, label: 'За 30 минут' },
  { value: 60, label: 'За 1 час' },
  { value: 120, label: 'За 2 часа' },
  { value: 1440, label: 'За 1 день' }
]

export function reminderLabel(v: number | null): string {
  return REMINDER_OPTIONS.find((o) => o.value === v)?.label ?? `За ${v} мин`
}

export const PRIORITIES = [
  { value: 0, label: 'Нет', color: 'var(--muted)' },
  { value: 1, label: 'Низкий', color: 'var(--p1)' },
  { value: 2, label: 'Средний', color: 'var(--p2)' },
  { value: 3, label: 'Высокий', color: 'var(--p3)' }
] as const

export function priorityColor(p: number): string {
  return PRIORITIES[p]?.color ?? 'var(--muted)'
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export function recurrenceLabel(item: Item): string {
  const r = item.recurrence
  if (r.freq === 'none') return ''
  const n = r.interval
  let s = ''
  switch (r.freq) {
    case 'daily':
      s = n === 1 ? 'Каждый день' : `Каждые ${n} ${plural(n, 'день', 'дня', 'дней')}`
      break
    case 'weekly': {
      s = n === 1 ? 'Каждую неделю' : `Каждые ${n} ${plural(n, 'неделю', 'недели', 'недель')}`
      if (r.weekdays.length) {
        const order = [1, 2, 3, 4, 5, 6, 0]
        s += ': ' + order.filter((d) => r.weekdays.includes(d)).map((d) => WD_SHORT[d]).join(', ')
      }
      break
    }
    case 'monthly':
      s = n === 1 ? 'Каждый месяц' : `Каждые ${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`
      break
    case 'yearly':
      s = n === 1 ? 'Каждый год' : `Каждые ${n} ${plural(n, 'год', 'года', 'лет')}`
      break
  }
  if (r.until) s += ` до ${dayMonth(r.until)}`
  return s
}

/** Понедельник (или воскресенье) недели, в которую попадает дата */
export function weekStart(key: string, weekStartsOn: 0 | 1): string {
  const d = fromKey(key)
  const shift = (d.getDay() - weekStartsOn + 7) % 7
  return addDays(key, -shift)
}

export function minutesOf(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function hhmm(mins: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export const TAG_COLORS = ['#7c5cff', '#38bdf8', '#22c55e', '#f59e0b', '#f43f5e', '#ec4899', '#14b8a6', '#a3e635', '#fb923c', '#94a3b8']

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9)
}
