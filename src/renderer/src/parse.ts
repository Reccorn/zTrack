import { addDays, fromKey, pad, toKey } from '@shared/recurrence'
import type { Priority } from '@shared/types'

export interface Parsed {
  title: string
  date?: string | null
  time?: string | null
  priority?: Priority
  tags: string[]
  hints: string[]
}

const WEEKDAYS: Record<string, number> = {
  пн: 1, понедельник: 1, вт: 2, вторник: 2, ср: 3, среда: 3, среду: 3, чт: 4, четверг: 4,
  пт: 5, пятница: 5, пятницу: 5, сб: 6, суббота: 6, субботу: 6, вс: 0, воскресенье: 0
}

/**
 * Быстрый ввод: «Позвонить маме завтра 18:30 !2 #семья»
 * Понимает: сегодня / завтра / послезавтра, дни недели, 12.10(.2026), 18:30 или «в 18», !1-!3 или !!!, #метка
 */
export function parseQuick(input: string, today: string): Parsed {
  let text = ' ' + input + ' '
  const out: Parsed = { title: '', tags: [], hints: [] }

  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void): void => {
    const m = text.match(re)
    if (m && fn(m) !== false) text = text.replace(m[0], ' ')
  }

  // метки
  let m: RegExpMatchArray | null
  const tagRe = /\s#([\p{L}\p{N}_-]+)/u
  while ((m = text.match(tagRe))) {
    out.tags.push(m[1])
    text = text.replace(m[0], ' ')
  }

  // приоритет
  take(/\s!([1-3])(?=\s)/, (mm) => {
    out.priority = Number(mm[1]) as Priority
  })
  take(/\s(!{1,3})(?=\s)/, (mm) => {
    out.priority = mm[1].length as Priority
  })

  // время
  take(/\s(?:в\s)?([01]?\d|2[0-3])[:.]([0-5]\d)(?=\s)/i, (mm) => {
    out.time = `${pad(Number(mm[1]))}:${mm[2]}`
  })
  if (!out.time) {
    take(/\sв\s([01]?\d|2[0-3])(?=\s)/i, (mm) => {
      out.time = `${pad(Number(mm[1]))}:00`
    })
  }

  // дата
  take(/\s(сегодня|завтра|послезавтра)(?=\s)/i, (mm) => {
    const w = mm[1].toLowerCase()
    out.date = w === 'сегодня' ? today : w === 'завтра' ? addDays(today, 1) : addDays(today, 2)
  })
  if (out.date === undefined) {
    take(/\s(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s)/, (mm) => {
      const t = fromKey(today)
      let y = mm[3] ? Number(mm[3]) : t.getFullYear()
      if (y < 100) y += 2000
      const d = new Date(y, Number(mm[2]) - 1, Number(mm[1]))
      if (d.getMonth() !== Number(mm[2]) - 1) return false
      if (!mm[3] && toKey(d) < today) d.setFullYear(y + 1)
      out.date = toKey(d)
    })
  }
  if (out.date === undefined) {
    take(/\s(?:во?\s)?(пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среду?|четверг|пятницу?|субботу?|воскресенье)(?=\s)/i, (mm) => {
      const target = WEEKDAYS[mm[1].toLowerCase()]
      if (target === undefined) return false
      const cur = fromKey(today).getDay()
      let delta = (target - cur + 7) % 7
      if (delta === 0) delta = 7
      out.date = addDays(today, delta)
    })
  }

  out.title = text.replace(/\s+/g, ' ').trim()
  if (out.date) out.hints.push('date')
  if (out.time) out.hints.push('time')
  if (out.priority) out.hints.push('priority')
  if (out.tags.length) out.hints.push('tags')
  return out
}
