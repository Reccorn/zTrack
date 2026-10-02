import { Notification, powerMonitor } from 'electron'
import { addDays, occurrencesInRange, occurrenceStart, todayKey } from '@shared/recurrence'
import type { Item } from '@shared/types'
import { getData, save } from './store'

const TICK_MS = 15_000
/** Насколько «опоздавшие» напоминания ещё показывать (например, после сна ноутбука) */
const GRACE_MS = 60 * 60_000

type OnClick = (itemId: string) => void

// держим ссылки, иначе на Windows обработчик клика может потеряться при сборке мусора
const alive = new Set<Notification>()
let timer: NodeJS.Timeout | null = null
let iconPath = ''
let onClick: OnClick = () => {}

function notifKey(item: Item, date: string): string {
  return `${item.id}|${date}|${item.time ?? 'allday'}|${item.reminder}`
}

function describe(item: Item, date: string, start: Date): string {
  const parts: string[] = []
  parts.push(item.type === 'event' ? 'Событие' : 'Задача')
  const today = todayKey()
  let when = ''
  if (date === today) when = 'сегодня'
  else if (date === addDays(today, 1)) when = 'завтра'
  else when = start.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  if (item.time) {
    when += ` в ${item.time}`
    if (item.endTime) when += `–${item.endTime}`
  }
  parts.push(when)
  const mins = Math.round((start.getTime() - Date.now()) / 60000)
  if (item.time && mins > 0) {
    parts.push(mins >= 60 ? `через ${Math.floor(mins / 60)} ч ${mins % 60 ? (mins % 60) + ' мин' : ''}`.trim() : `через ${mins} мин`)
  }
  let body = parts.join(' · ')
  if (item.notes) body += '\n' + item.notes.slice(0, 120)
  return body
}

export function show(title: string, body: string, itemId?: string): void {
  if (!Notification.isSupported()) return
  const s = getData().settings
  const n = new Notification({
    title,
    body,
    icon: iconPath || undefined,
    silent: !s.notificationSound,
    timeoutType: 'default'
  })
  alive.add(n)
  n.on('click', () => {
    if (itemId) onClick(itemId)
    alive.delete(n)
  })
  n.on('close', () => alive.delete(n))
  n.show()
  setTimeout(() => alive.delete(n), 10 * 60_000)
}

export function tick(): void {
  const data = getData()
  if (!data.settings.notifications) return
  const now = Date.now()
  const today = todayKey()
  const candidates = data.items.filter((i) => i.reminder !== null && i.date)
  const occs = occurrencesInRange(candidates, addDays(today, -1), addDays(today, 2))
  let changed = false

  for (const occ of occs) {
    if (occ.done || !occ.date) continue
    const item = occ.item
    const start = occurrenceStart(item, occ.date)
    const fireAt = start.getTime() - (item.reminder ?? 0) * 60_000
    if (fireAt > now || now - fireAt > GRACE_MS) continue
    const key = notifKey(item, occ.date)
    if (data.notified[key]) continue
    data.notified[key] = now
    changed = true
    show(item.title, describe(item, occ.date, start), item.id)
  }

  // чистим старые отметки (старше 7 дней)
  for (const [k, t] of Object.entries(data.notified)) {
    if (now - t > 7 * 86400_000) {
      delete data.notified[k]
      changed = true
    }
  }
  if (changed) save()
}

/** При создании/изменении: уже прошедшие напоминания не показываем задним числом */
export function markPastAsNotified(item: Item): void {
  if (item.reminder === null || !item.date) return
  const data = getData()
  const now = Date.now()
  const today = todayKey()
  for (const occ of occurrencesInRange([item], addDays(today, -1), addDays(today, 2))) {
    if (!occ.date) continue
    // если само событие уже началось — не напоминаем; если ещё впереди, а время
    // напоминания прошло — напомним сразу (удобно для «через 5 минут созвон»)
    if (occurrenceStart(item, occ.date).getTime() <= now) data.notified[notifKey(item, occ.date)] = now
  }
}

export function startScheduler(icon: string, clickHandler: OnClick): void {
  iconPath = icon
  onClick = clickHandler
  if (timer) clearInterval(timer)
  timer = setInterval(tick, TICK_MS)
  setTimeout(tick, 3000)
  powerMonitor.on('resume', () => setTimeout(tick, 2000))
  powerMonitor.on('unlock-screen', () => setTimeout(tick, 2000))
}
