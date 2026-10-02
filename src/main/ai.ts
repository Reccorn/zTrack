/**
 * Локальный ИИ через Ollama (http://127.0.0.1:11434).
 *
 * Принципы:
 *  - модель загружается только по запросу и выгружается Ollama через aiKeepAlive минут простоя;
 *  - ответы модели ограничены JSON-схемой (параметр format) и всегда проверяются здесь;
 *  - ИИ ничего не сохраняет сам — только возвращает черновики/предложения интерфейсу;
 *  - запросы выполняются по одному (очередь), чтобы не держать в памяти несколько контекстов.
 */
import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  AiDraft,
  AiModelInfo,
  AiPullProgress,
  AiSearchHit,
  AiStatus,
  AiWeekPlan,
  AiWeekSuggestion,
  Item,
  Priority,
  RepeatFreq
} from '@shared/types'
import { addDays, diffDays, fromKey, isRecurring, occurrencesInRange, todayKey } from '@shared/recurrence'
import { getData } from './store'

const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440]

export class AiError extends Error {}

// ---------- HTTP к Ollama ----------

const active = new Set<AbortController>()

function settings() {
  return getData().settings
}

function baseUrl(): string {
  return settings().aiUrl.replace(/\/+$/, '')
}

function keepAlive(): string {
  return `${Math.max(0, Math.round(settings().aiKeepAlive))}m`
}

async function request(pathname: string, body?: unknown, timeoutMs = 180_000, method?: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  active.add(ctrl)
  try {
    const res = await fetch(baseUrl() + pathname, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new AiError(httpError(res.status, text))
    }
    return res
  } catch (e) {
    if (e instanceof AiError) throw e
    if ((e as Error)?.name === 'AbortError') throw new AiError('Запрос к ИИ отменён или занял слишком много времени')
    throw new AiError(`Ollama не отвечает по адресу ${baseUrl()}. Запустите Ollama и попробуйте снова.`)
  } finally {
    clearTimeout(timer)
    active.delete(ctrl)
  }
}

function httpError(status: number, text: string): string {
  let msg = text
  try {
    msg = JSON.parse(text).error ?? text
  } catch {
    /* не JSON */
  }
  if (status === 404 && /not found/i.test(msg)) {
    return 'Модель не скачана. Откройте «Настройки → Локальный ИИ» и нажмите «Скачать».'
  }
  return `Ollama: ${msg || 'ошибка ' + status}`
}

export function cancelAll(): void {
  for (const c of active) c.abort()
}

// ---------- очередь: одна генерация за раз ----------

let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.catch(() => undefined)
  return run
}

// ---------- статус и модели ----------

function sameModel(a: string, b: string): boolean {
  const norm = (m: string): string => (m.includes(':') ? m : m + ':latest').toLowerCase()
  return norm(a) === norm(b)
}

export async function status(): Promise<AiStatus> {
  const s = settings()
  const out: AiStatus = { running: false, version: null, models: [], hasModel: false, hasEmbedModel: false, error: null }
  try {
    const v = (await (await request('/api/version', undefined, 4000)).json()) as { version?: string }
    out.running = true
    out.version = v.version ?? null
    const tags = (await (await request('/api/tags', undefined, 8000)).json()) as {
      models?: { name: string; size: number; modified_at: string }[]
    }
    out.models = (tags.models ?? [])
      .map((m): AiModelInfo => ({ name: m.name, size: m.size, modifiedAt: m.modified_at }))
      .sort((a, b) => a.name.localeCompare(b.name))
    out.hasModel = out.models.some((m) => sameModel(m.name, s.aiModel))
    out.hasEmbedModel = out.models.some((m) => sameModel(m.name, s.aiEmbedModel))
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e)
  }
  return out
}

export async function deleteModel(model: string): Promise<void> {
  await request('/api/delete', { model, name: model }, 30_000, 'DELETE')
}

/** Скачивание модели с прогрессом (потоковый ответ NDJSON) */
export async function pull(model: string, onProgress: (p: AiPullProgress) => void): Promise<void> {
  const ctrl = new AbortController()
  active.add(ctrl)
  try {
    let res: Response
    try {
      res = await fetch(baseUrl() + '/api/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, name: model, stream: true }),
        signal: ctrl.signal
      })
    } catch {
      throw new AiError(`Ollama не отвечает по адресу ${baseUrl()}`)
    }
    if (!res.ok || !res.body) throw new AiError(httpError(res.status, await res.text().catch(() => '')))
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        const msg = JSON.parse(line) as { status?: string; completed?: number; total?: number; error?: string }
        if (msg.error) throw new AiError(`Ollama: ${msg.error}`)
        onProgress({
          model,
          status: msg.status ?? '',
          completed: msg.completed ?? 0,
          total: msg.total ?? 0,
          done: msg.status === 'success'
        })
      }
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new AiError('Скачивание отменено')
    throw e
  } finally {
    active.delete(ctrl)
  }
}

// ---------- генерация JSON по схеме ----------

async function chatJSON<T>(system: string, user: string, schema: object, maxTokens: number): Promise<T> {
  const s = settings()
  const body: Record<string, unknown> = {
    model: s.aiModel,
    stream: false,
    think: false, // у Gemma 4 рассуждения включены по умолчанию — для коротких ответов они только замедляют
    format: schema,
    keep_alive: keepAlive(),
    options: { temperature: 0.2, num_ctx: 4096, num_predict: maxTokens },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  }
  let res: Response
  try {
    res = await request('/api/chat', body)
  } catch (e) {
    // старые версии Ollama или модели без режима рассуждений не знают параметр think
    if (e instanceof AiError && /think/i.test(e.message)) {
      delete body.think
      res = await request('/api/chat', body)
    } else throw e
  }
  const j = (await res.json()) as { message?: { content?: string } }
  const content = j.message?.content ?? ''
  try {
    return JSON.parse(extractJson(content)) as T
  } catch {
    throw new AiError('Модель вернула непонятный ответ. Попробуйте переформулировать.')
  }
}

function extractJson(s: string): string {
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  return start >= 0 && end > start ? s.slice(start, end + 1) : s
}

// ---------- общие помощники ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = fromKey(v)
  return isNaN(d.getTime()) ? null : v
}

function validTime(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const t = `${m[1].padStart(2, '0')}:${m[2]}`
  return TIME_RE.test(t) ? t : null
}

function minutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function hhmm(n: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, n))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Таблица ближайших дней — маленькой модели проще найти дату в списке, чем считать её */
function calendarHint(today: string, days = 14): string {
  const lines: string[] = []
  for (let i = 0; i < days; i++) {
    const k = addDays(today, i)
    const d = fromKey(k)
    const label = i === 0 ? ' (сегодня)' : i === 1 ? ' (завтра)' : i === 2 ? ' (послезавтра)' : ''
    lines.push(`${WD_SHORT[d.getDay()]} ${k}${label}`)
  }
  return lines.join('\n')
}

// ---------- 1. Разбор задачи из свободного текста ----------

const PARSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    type: { type: 'string', enum: ['task', 'event'] },
    date: { type: 'string', description: 'YYYY-MM-DD или пустая строка' },
    time: { type: 'string', description: 'HH:MM или пустая строка' },
    endTime: { type: 'string', description: 'HH:MM или пустая строка' },
    priority: { type: 'integer', enum: [0, 1, 2, 3] },
    reminder: { type: 'integer', description: 'минут до начала; -1 если не сказано' },
    repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: 'integer' },
    weekdays: { type: 'array', items: { type: 'integer' } },
    until: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' }
  },
  required: ['title', 'type', 'date', 'time', 'endTime', 'priority', 'reminder', 'repeat', 'interval', 'weekdays', 'until', 'tags', 'notes']
}

interface ParseOut {
  title: string
  type: 'task' | 'event'
  date: string
  time: string
  endTime: string
  priority: number
  reminder: number
  repeat: RepeatFreq
  interval: number
  weekdays: number[]
  until: string
  tags: string[]
  notes: string
}

function parseSystemPrompt(today: string, tagNames: string[]): string {
  const d = fromKey(today)
  return `Ты превращаешь фразу пользователя в задачу для планировщика. Отвечай только JSON по схеме.

Сегодня ${today}, ${WD[d.getDay()]}. Ближайшие даты:
${calendarHint(today)}

Правила:
- title: коротко, что сделать, с заглавной буквы, БЕЗ слов о дате, времени, приоритете, напоминании и метках.
- date: дата из списка выше в формате YYYY-MM-DD; «в четверг» — ближайший четверг из списка (не сегодня); если дата не названа — "".
- time: HH:MM; «утром» 09:00, «днём» 13:00, «после обеда» 14:00, «вечером» 19:00, «ночью» 22:00; если не названо — "".
- endTime: если сказана длительность («на час», «на 30 минут», «с 10 до 12») — время окончания, иначе "".
- type: "event" для встреч, созвонов, приёмов, мероприятий и всего с длительностью; иначе "task".
- priority: 3 — «срочно», «очень важно»; 2 — «важно»; 1 — «не срочно», «когда-нибудь»; иначе 0.
- reminder: «напомни за 15 минут» → 15; «за час» → 60; «за день» → 1440; «напомни» без срока → 0; не сказано → -1.
- repeat: «каждый день» daily; «каждую неделю», «по вторникам» weekly; «каждый месяц» monthly; «каждый год», «ежегодно» yearly; иначе none.
- interval: «каждые 2 недели» → 2, иначе 1. weekdays (для weekly): 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб. until: дата окончания повторов или "".
- tags: выбирай из существующих меток, если фраза явно к ним относится: ${tagNames.length ? tagNames.join(', ') : '(меток пока нет)'}. Новую метку добавляй, только если пользователь прямо назвал её (#метка или «метка X»).
- notes: подробности, которые не вошли в название, иначе "".

Пример: «в четверг после обеда созвон с Аней на час, напомни за 15 минут» →
{"title":"Созвон с Аней","type":"event","date":"<дата ближайшего четверга>","time":"14:00","endTime":"15:00","priority":0,"reminder":15,"repeat":"none","interval":1,"weekdays":[],"until":"","tags":[],"notes":""}

Пример: «каждый понедельник и среду в 8 утра пробежка» →
{"title":"Пробежка","type":"task","date":"<ближайший понедельник или среда>","time":"08:00","endTime":"","priority":0,"reminder":-1,"repeat":"weekly","interval":1,"weekdays":[1,3],"until":"","tags":[],"notes":""}`
}

export function parseTask(text: string, contextDate: string | null): Promise<AiDraft> {
  return enqueue(async () => {
    const data = getData()
    const today = todayKey()
    const tagNames = data.tags.map((t) => t.name)
    const out = await chatJSON<ParseOut>(parseSystemPrompt(today, tagNames), text.trim(), PARSE_SCHEMA, 300)

    const item: Partial<Item> = {}
    item.title = String(out.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || text.trim().slice(0, 200)
    const t0 = item.title.charAt(0)
    item.title = t0.toUpperCase() + item.title.slice(1)
    item.notes = String(out.notes ?? '').trim()

    let date = validDate(out.date)
    // даты далеко в прошлом — скорее ошибка модели
    if (date && diffDays(today, date) < -1) date = null
    const time = validTime(out.time)
    let endTime = validTime(out.endTime)
    if (time && endTime && minutes(endTime) <= minutes(time)) endTime = null
    if (!time) endTime = null

    item.type = out.type === 'event' || endTime ? 'event' : 'task'
    item.date = date ?? (item.type === 'event' ? (contextDate ?? today) : contextDate)
    item.time = item.date ? time : null
    item.endTime = item.date && item.type === 'event' ? endTime : null
    if (item.type === 'event' && item.time && !item.endTime) item.endTime = hhmm(minutes(item.time) + 60)

    item.priority = ([0, 1, 2, 3].includes(out.priority) ? out.priority : 0) as Priority

    // напоминание: -1 — не сказано → значение по умолчанию; иначе ближайшее допустимое
    if (typeof out.reminder === 'number' && out.reminder >= 0) {
      item.reminder = REMINDERS.reduce((best, r) => (Math.abs(r - out.reminder) < Math.abs(best - out.reminder) ? r : best), 0)
    } else {
      item.reminder = data.settings.defaultReminder
    }

    const freq: RepeatFreq = ['daily', 'weekly', 'monthly', 'yearly'].includes(out.repeat) ? out.repeat : 'none'
    if (freq !== 'none' && item.date) {
      const weekdays = Array.isArray(out.weekdays) ? [...new Set(out.weekdays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))] : []
      const until = validDate(out.until)
      item.recurrence = {
        freq,
        interval: Math.min(365, Math.max(1, Math.round(Number(out.interval) || 1))),
        weekdays: freq === 'weekly' ? (weekdays.length ? weekdays : [fromKey(item.date).getDay()]) : [],
        until: until && until >= item.date ? until : null
      }
      // для «по понедельникам и средам» дата начала — ближайший подходящий день
      if (freq === 'weekly') {
        for (let i = 0; i < 7; i++) {
          const k = addDays(item.date, i)
          if (item.recurrence.weekdays.includes(fromKey(k).getDay())) {
            item.date = k
            break
          }
        }
      }
    }

    // метки: существующие по названию, остальные — предложение
    const tagIds: string[] = []
    const newTags: string[] = []
    for (const raw of Array.isArray(out.tags) ? out.tags : []) {
      const name = String(raw).replace(/^#/, '').trim().slice(0, 40)
      if (!name) continue
      const found = data.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (found) {
        if (!tagIds.includes(found.id)) tagIds.push(found.id)
      } else if (!newTags.some((n) => n.toLowerCase() === name.toLowerCase())) newTags.push(name)
    }
    item.tags = tagIds
    return { item, newTags }
  })
}

// ---------- 2. Разбить задачу на шаги ----------

const STEPS_SCHEMA = {
  type: 'object',
  properties: { steps: { type: 'array', items: { type: 'string' }, maxItems: 8 } },
  required: ['steps']
}

export function breakdown(title: string, notes: string, existing: string[]): Promise<string[]> {
  return enqueue(async () => {
    const system = `Ты помогаешь разбить задачу на конкретные шаги. Отвечай только JSON по схеме.
Правила: 3–7 шагов; каждый шаг — короткое действие с глагола («Собрать…», «Написать…»), до 8 слов; по-русски; без нумерации; не повторяй уже существующие шаги; не добавляй даты.`
    const user = [
      `Задача: ${title}`,
      notes ? `Подробности: ${notes}` : '',
      existing.length ? `Уже есть шаги: ${existing.join('; ')}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const out = await chatJSON<{ steps: string[] }>(system, user, STEPS_SCHEMA, 300)
    const seen = new Set(existing.map((s) => s.toLowerCase()))
    const steps: string[] = []
    for (const raw of Array.isArray(out.steps) ? out.steps : []) {
      const s = String(raw)
        .replace(/^\s*(\d+[.)]|[-•*])\s*/, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
      if (!s || seen.has(s.toLowerCase())) continue
      seen.add(s.toLowerCase())
      steps.push(s.charAt(0).toUpperCase() + s.slice(1))
      if (steps.length >= 8) break
    }
    if (!steps.length) throw new AiError('Не получилось придумать шаги — уточните название задачи')
    return steps
  })
}

// ---------- 3. Ассистент недели ----------
//
// Маленькая модель (E2B) плохо считает дела по списку, сама переводит даты в дни недели с ошибками
// и пишет пояснения, которые расходятся с выбранной датой. Поэтому:
//  - факты (сколько дел, какой день загружен) считает код, модель даёт только короткую оценку;
//  - id задач и дни переноса ограничены enum в схеме: модель выбирает «t2» и «пн», а не пишет даты;
//  - перенос принимается, только если он реально разгружает день (или ставит просроченное);
//  - пояснение, где модель называет дни или даты, заменяется пояснением, собранным кодом;
//  - на лёгкой неделе (нет загруженных дней и просрочек) переносы у модели не запрашиваются вовсе.

/** День считается загруженным, если в нём от BUSY_COUNT дел или больше BUSY_MINUTES минут */
const BUSY_COUNT = 4
const BUSY_MINUTES = 240

/** Текст упоминает день недели или дату */
const DAY_MENTION =
  /понедельн|вторник|сред[аеуы](?![а-яё])|четверг|пятниц|суббот|воскресен|(?<![а-яё])(пн|вт|ср|чт|пт|сб|вс)(?![а-яё])|\d{1,2}[./]\d{1,2}|\d{4}-\d{2}/i
/** Текст пересказывает количество дел — эти числа модель часто путает */
const COUNT_MENTION =
  /\d|(?<![а-яё])(одн|два|двух|две|три|трёх|трех|четыр|пять|пяти|шест|нескольк)[а-яё]*\s+(?:[а-яё]+\s+)?(задач|событ|дел)/i

function plural(n: number, forms: [string, string, string]): string {
  const a = n % 10
  const b = n % 100
  const f = a === 1 && b !== 11 ? forms[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? forms[1] : forms[2]
  return `${n} ${f}`
}
const DELA: [string, string, string] = ['дело', 'дела', 'дел']
const ZADACHI: [string, string, string] = ['задача', 'задачи', 'задач']
const SOBYTIYA: [string, string, string] = ['событие', 'события', 'событий']

/** «≈1,5 ч» */
function hrs(min: number): string {
  return `≈${String(Math.round(min / 6) / 10).replace('.', ',')} ч`
}

/** «вт 6» — как подписи дней в интерфейсе */
function dayName(k: string): string {
  const d = fromKey(k)
  return `${WD_SHORT[d.getDay()]} ${d.getDate()}`
}

/** «вт 6.10» */
function dayFull(k: string): string {
  const d = fromKey(k)
  return `${dayName(k)}.${String(d.getMonth() + 1).padStart(2, '0')}`
}

function sentence(s: string): string {
  const t = s.trim()
  return !t || /[.!?…]$/.test(t) ? t : t + '.'
}

/** Схема ответа. Без ids — неделя лёгкая, переносы не запрашиваем (и модель не тратит на них токены). */
function planSchema(ids: string[] | null, dayCodes: string[]): object {
  const properties: Record<string, unknown> = { comment: { type: 'string' } }
  const required = ['comment']
  if (ids) {
    properties.moves = {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: ids },
          to: { type: 'string', enum: dayCodes },
          reason: { type: 'string' }
        },
        required: ['id', 'to', 'reason']
      }
    }
    required.push('moves')
  }
  properties.tips = { type: 'array', items: { type: 'string' }, maxItems: 3 }
  required.push('tips')
  return { type: 'object', properties, required }
}

/** Оценка длительности: события — по времени, задачи — 30 минут */
function durationOf(item: Item): number {
  if (item.time && item.endTime) return Math.max(15, minutes(item.endTime) - minutes(item.time))
  if (item.type === 'event') return item.time ? 60 : 0
  return 30
}

export function planWeek(weekStart: string): Promise<AiWeekPlan> {
  return enqueue(async () => {
    const data = getData()
    const today = todayKey()
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const all = occurrencesInRange(data.items, days[0], days[6])
    const open = all.filter((o) => !o.done)
    const future = days.filter((k) => k >= today)
    if (!future.length) throw new AiError('Эта неделя уже прошла — откройте текущую или следующую')

    const overdue = data.items.filter((i) => !isRecurring(i) && i.date && i.date < today && !i.done && i.type === 'task')

    // нагрузка по дням (только невыполненное)
    const load = new Map<string, number>()
    const count = new Map<string, number>()
    for (const k of days) {
      const list = open.filter((o) => o.date === k)
      load.set(k, list.reduce((sum, o) => sum + durationOf(o.item), 0))
      count.set(k, list.length)
    }

    // ---- факты для пользователя считаем сами ----
    const events = all.filter((o) => o.item.type === 'event').length
    const tasks = all.length - events
    const doneCount = all.length - open.length
    const busiest = [...future].sort((a, b) => load.get(b)! - load.get(a)! || a.localeCompare(b))[0]
    const facts = !all.length
      ? 'На неделе пока ничего не запланировано.'
      : [
          `На неделе ${
            events && tasks
              ? `${plural(all.length, DELA)}: ${plural(events, SOBYTIYA)} и ${plural(tasks, ZADACHI)}`
              : events
                ? plural(events, SOBYTIYA)
                : plural(tasks, ZADACHI)
          }${doneCount ? `, выполнено ${doneCount}` : ''}.`,
          load.get(busiest)! > 0 ? `Больше всего занят ${dayName(busiest)} (${hrs(load.get(busiest)!)}).` : '',
          overdue.length ? `Просрочено: ${plural(overdue.length, ZADACHI)}.` : ''
        ]
          .filter(Boolean)
          .join(' ')

    // ---- список для модели ----
    // короткие id (t1, t2…) только у задач, которые можно переносить
    const short = new Map<string, { item: Item; date: string }>()
    const tagName = (id: string): string => data.tags.find((t) => t.id === id)?.name ?? ''
    const line = (item: Item, date: string, movable: boolean, extra = ''): string => {
      let sid = ''
      if (movable) {
        sid = `t${short.size + 1}`
        short.set(sid, { item, date })
      }
      const parts = [
        item.type === 'event' ? 'событие' : 'задача',
        `«${item.title}»`,
        extra,
        item.time ? (item.endTime ? `${item.time}–${item.endTime}` : item.time) : 'без времени',
        item.priority ? `приоритет ${['', 'низкий', 'средний', 'высокий'][item.priority]}` : '',
        item.tags.length ? `метки: ${item.tags.map(tagName).filter(Boolean).join(', ')}` : '',
        movable ? '' : 'нельзя переносить'
      ]
      return `  - ${sid ? sid + ': ' : ''}${parts.filter(Boolean).join(', ')}`
    }

    const blocks: string[] = []
    for (const k of days) {
      if (k < today) {
        blocks.push(`${dayFull(k)} (прошёл)`)
        continue
      }
      const list = open.filter((o) => o.date === k)
      const head = `${dayFull(k)}${k === today ? ' (сегодня)' : ''}: ${list.length ? `${plural(list.length, DELA)}, ${hrs(load.get(k)!)}` : 'свободно'}`
      const rows = list.map((o) => line(o.item, k, !isRecurring(o.item) && o.item.type === 'task'))
      blocks.push([head, ...rows].join('\n'))
    }
    const overdueBlock = overdue.length
      ? ['Просроченные задачи:', ...overdue.slice(0, 15).map((i) => line(i, i.date!, true, `была на ${dayFull(i.date!)}`))].join('\n')
      : ''

    if (!short.size) {
      return { summary: `${facts}${all.length ? ' Задач, которые можно переносить, нет.' : ''}`, suggestions: [] }
    }

    const busy = future.filter((k) => count.get(k)! >= BUSY_COUNT || load.get(k)! > BUSY_MINUTES)
    const light = !busy.length && !overdue.length
    const freest = [...future].sort((a, b) => load.get(a)! - load.get(b)! || a.localeCompare(b)).slice(0, 2)
    const hint = light
      ? 'Загруженных дней и просроченных задач нет — переносы не нужны.'
      : [
          busy.length
            ? `Загруженные дни: ${busy.map((k) => `${dayFull(k)} (${plural(count.get(k)!, DELA)}, ${hrs(load.get(k)!)})`).join('; ')}.`
            : 'Загруженных дней нет.',
          overdue.length ? 'Просроченные задачи поставь на ближайшие свободные дни.' : '',
          `Свободнее всего: ${freest.map((k) => `${dayFull(k)} (${hrs(load.get(k)!)})`).join(', ')}.`
        ]
          .filter(Boolean)
          .join(' ')

    const system = [
      'Ты — помощник по планированию недели. Отвечай только JSON по схеме, по-русски.',
      'Правила:',
      '- comment: одна короткая фраза — общая оценка недели (например: «Неделя спокойная, есть запас времени»). Не перечисляй дела, не называй дни и не считай дела — сводку пользователь уже видит.',
      light
        ? ''
        : '- moves: до 5 переносов, только если они разгружают загруженные дни или ставят просроченные задачи на свободные дни. id — номер задачи (t1, t2…) из списка; to — код дня (пн, вт, ср, чт, пт, сб, вс), куда перенести. Не переноси на день, где дел столько же или больше, чем в исходном. Если переносить нечего — moves пустой.',
      light ? '' : '- reason: зачем перенос, одним коротким предложением, без названий дней и дат.',
      '- tips: 0–3 коротких практичных совета по этой неделе. Не выдумывай дела, которых нет в списке.'
    ]
      .filter(Boolean)
      .join('\n')
    const user = [
      `Неделя ${dayFull(days[0])} — ${dayFull(days[6])}. Сегодня ${dayFull(today)}.`,
      ...blocks,
      overdueBlock,
      facts,
      hint
    ]
      .filter(Boolean)
      .join('\n\n')

    const codeToDate = new Map(future.map((k) => [WD_SHORT[fromKey(k).getDay()], k]))
    const out = await chatJSON<{ comment: string; moves?: { id: string; to: string; reason: string }[]; tips: string[] }>(
      system,
      user,
      planSchema(light ? null : [...short.keys()], [...codeToDate.keys()]),
      light ? 300 : 600
    )

    // ---- проверка переносов: только те, что реально помогают ----
    const suggestions: AiWeekSuggestion[] = []
    const used = new Set<string>()
    for (const m of !light && Array.isArray(out.moves) ? out.moves : []) {
      const ref = short.get(String(m.id).trim())
      const to = codeToDate.get(String(m.to).trim().toLowerCase())
      if (!ref || !to || used.has(ref.item.id) || to === ref.date) continue
      const dur = durationOf(ref.item)
      const wasOverdue = ref.date < today
      const fromLoad = wasOverdue ? 0 : load.get(ref.date)!
      const toLoad = load.get(to)!
      const earlierHigh = ref.item.priority === 3 && to < ref.date && toLoad + dur <= fromLoad
      const helps = wasOverdue || toLoad + dur < fromLoad || earlierHigh
      if (!helps) continue
      used.add(ref.item.id)
      load.set(to, toLoad + dur)
      if (!wasOverdue) load.set(ref.date, fromLoad - dur)

      const reason = String(m.reason ?? '').trim()
      const text =
        reason && !DAY_MENTION.test(reason)
          ? sentence(reason.slice(0, 200))
          : wasOverdue
            ? `Задача просрочена с ${dayFull(ref.date)} — ставим на свободный день.`
            : toLoad + dur < fromLoad
              ? `Исходный день загружен сильнее: ${hrs(fromLoad)} против ${hrs(toLoad)}.`
              : 'Высокий приоритет — лучше сделать пораньше.'
      suggestions.push({ kind: 'move', itemId: ref.item.id, title: ref.item.title, fromDate: ref.date, toDate: to, text })
    }
    for (const tip of Array.isArray(out.tips) ? out.tips.slice(0, 3) : []) {
      const text = String(tip).trim().slice(0, 200)
      if (text) suggestions.push({ kind: 'tip', text })
    }

    let comment = sentence(String(out.comment ?? '').slice(0, 200))
    if (DAY_MENTION.test(comment) || COUNT_MENTION.test(comment)) comment = ''
    if (!comment && light) comment = 'Загруженных дней нет.'
    return { summary: [facts, comment].filter(Boolean).join(' ').slice(0, 500), suggestions }
  })
}

// ---------- 4. Поиск по смыслу (эмбеддинги) ----------

const DIM = 256 // EmbeddingGemma обучена так, что первые 256 координат — полноценный вектор (Matryoshka)

interface IndexFile {
  model: string
  vectors: Record<string, { h: string; v: string }>
}

let index: IndexFile | null = null

function indexPath(): string {
  return path.join(app.getPath('userData'), 'embeddings.json')
}

function loadIndex(model: string): IndexFile {
  if (index && index.model === model) return index
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(), 'utf-8')) as IndexFile
    if (raw.model === model && raw.vectors) return (index = raw)
  } catch {
    /* нет файла — создадим */
  }
  return (index = { model, vectors: {} })
}

function saveIndex(): void {
  if (!index) return
  try {
    fs.writeFileSync(indexPath(), JSON.stringify(index), 'utf-8')
  } catch (e) {
    console.error('[zTrack] embeddings save failed', e)
  }
}

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function docText(item: Item): string {
  const data = getData()
  const tags = item.tags.map((id) => data.tags.find((t) => t.id === id)?.name).filter(Boolean)
  const body = [item.notes, item.subtasks.map((s) => s.title).join('; '), tags.length ? `метки: ${tags.join(', ')}` : '']
    .filter(Boolean)
    .join('. ')
  // формат документа, рекомендованный для EmbeddingGemma
  return `title: ${item.title} | text: ${body || item.title}`
}

function toVec(arr: number[]): Float32Array {
  const v = Float32Array.from(arr.slice(0, DIM))
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

function enc(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
}

function dec(s: string): Float32Array {
  // копируем в отдельный буфер: у Buffer из пула смещение может быть не кратно 4
  const b = Buffer.from(s, 'base64')
  const ab = new ArrayBuffer(b.length - (b.length % 4))
  new Uint8Array(ab).set(b.subarray(0, ab.byteLength))
  return new Float32Array(ab)
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const s = settings()
  const res = await request('/api/embed', { model: s.aiEmbedModel, input: texts, keep_alive: keepAlive(), truncate: true }, 120_000)
  const j = (await res.json()) as { embeddings?: number[][] }
  if (!j.embeddings || j.embeddings.length !== texts.length) throw new AiError('Модель эмбеддингов вернула неожиданный ответ')
  return j.embeddings.map(toVec)
}

/** Досчитывает векторы для новых и изменённых задач, удаляет векторы удалённых */
async function refreshIndex(): Promise<IndexFile> {
  const data = getData()
  const idx = loadIndex(settings().aiEmbedModel)
  const alive = new Set(data.items.map((i) => i.id))
  let changed = false
  for (const id of Object.keys(idx.vectors)) {
    if (!alive.has(id)) {
      delete idx.vectors[id]
      changed = true
    }
  }
  const stale = data.items
    .map((i) => ({ i, text: docText(i) }))
    .filter(({ i, text }) => idx.vectors[i.id]?.h !== hash(text))
  for (let k = 0; k < stale.length; k += 16) {
    const batch = stale.slice(k, k + 16)
    const vecs = await embed(batch.map((b) => b.text))
    batch.forEach((b, j) => (idx.vectors[b.i.id] = { h: hash(b.text), v: enc(vecs[j]) }))
    changed = true
  }
  if (changed) saveIndex()
  return idx
}

export function search(query: string): Promise<AiSearchHit[]> {
  return enqueue(async () => {
    const q = query.trim()
    if (q.length < 2) return []
    const idx = await refreshIndex()
    const [qv] = await embed([`task: search result | query: ${q}`])
    const hits: AiSearchHit[] = []
    for (const [id, { v }] of Object.entries(idx.vectors)) {
      const dv = dec(v)
      let dot = 0
      for (let i = 0; i < Math.min(dv.length, qv.length); i++) dot += dv[i] * qv[i]
      hits.push({ id, score: dot })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 12)
  })
}

// ---------- 5. Расшифровка голоса (Gemma 4 принимает звук) ----------

export function transcribe(wavBase64: string): Promise<string> {
  return enqueue(async () => {
    if (!wavBase64 || wavBase64.length > 4_000_000) throw new AiError('Запись слишком длинная — до 30 секунд')
    const s = settings()
    const body: Record<string, unknown> = {
      model: s.aiModel,
      stream: false,
      think: false,
      keep_alive: keepAlive(),
      // thinking:false в options — обход известной проблемы Ollama 0.30.x со звуком у Gemma 4
      options: { temperature: 0, num_ctx: 4096, num_predict: 300, thinking: false },
      messages: [
        {
          role: 'system',
          content:
            'Ты расшифровываешь короткую голосовую заметку для планировщика задач. Запиши дословно, что сказано, на языке речи (обычно русский). Только текст, без пояснений, кавычек и перевода.'
        },
        // Ollama передаёт аудио для Gemma 4 через поле images (base64 WAV)
        { role: 'user', content: 'Расшифруй запись.', images: [wavBase64] }
      ]
    }
    let res: Response
    try {
      res = await request('/api/chat', body, 120_000)
    } catch (e) {
      if (e instanceof AiError && /think/i.test(e.message)) {
        delete body.think
        res = await request('/api/chat', body, 120_000)
      } else if (e instanceof AiError && /image|audio|multimodal|vision/i.test(e.message)) {
        throw new AiError('Эта модель или версия Ollama не принимает звук. Нужна Gemma 4 (E2B/E4B) и свежая Ollama.')
      } else throw e
    }
    const j = (await res.json()) as { message?: { content?: string } }
    const text = (j.message?.content ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^["«»\s]+|["«»\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text || /could not transcribe|не удалось расшифровать|не могу расшифровать/i.test(text)) {
      throw new AiError('Не удалось разобрать речь — попробуйте ещё раз, ближе к микрофону')
    }
    return text.slice(0, 500)
  })
}
