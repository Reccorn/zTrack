<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Toggle from './Toggle.vue'
import { aiOn, api, closeEditor, createTag, deleteOcc, editor, saveItem, settings, state, today, toast, toggleOcc } from '../store'
import { PRIORITIES, REMINDER_OPTIONS, WD_SHORT, hhmm, minutesOf, recurrenceLabel, dayMonth, shortDate, uid } from '../fmt'
import { isRecurring, makeOcc, addDays } from '@shared/recurrence'
import { parseQuick, type Parsed } from '../parse'
import { useVoice } from '../useVoice'
import type { AiDraft, Item, RepeatFreq } from '@shared/types'

const titleInput = ref<HTMLTextAreaElement | null>(null)
const error = ref('')
const newTag = ref('')
const addingTag = ref(false)
const tagInput = ref<HTMLInputElement | null>(null)

const it = computed(() => editor.item as Item)
const allDay = computed({
  get: () => !it.value.time,
  set: (v: boolean) => {
    if (v) {
      it.value.time = null
      it.value.endTime = null
    } else {
      const now = new Date()
      const next = Math.min(23 * 60, (now.getHours() + 1) * 60)
      it.value.time = hhmm(next)
      if (it.value.type === 'event') it.value.endTime = hhmm(next + 60)
    }
  }
})

watch(
  () => editor.open,
  async (open) => {
    if (!open) {
      // форму закрыли во время записи/расшифровки/разбора — результат больше не нужен
      voice.cancel()
      parseGen++
      parseBusy.value = false
      return
    }
    error.value = ''
    addingTag.value = false
    quickNewTags.value = []
    skipShift = false
    newStep.value = ''
    await nextTick()
    titleInput.value?.focus()
    autoGrow()
  }
)

watch(
  () => it.value?.type,
  (t, prev) => {
    if (!editor.open || !prev || t === prev) return
    if (t === 'event' && !it.value.date) it.value.date = today.value
    if (t === 'event' && it.value.time && !it.value.endTime) it.value.endTime = hhmm(minutesOf(it.value.time) + 60)
  }
)

// при сдвиге начала сдвигаем конец, сохраняя длительность
watch(
  () => it.value?.time,
  (t, prev) => {
    // время и конец выставлены вместе (быстрый набор / ИИ) — конец уже правильный
    if (skipShift) {
      skipShift = false
      return
    }
    if (!editor.open || !t || !prev || !it.value.endTime) return
    const dur = minutesOf(it.value.endTime) - minutesOf(prev)
    if (dur > 0) it.value.endTime = hhmm(minutesOf(t) + dur)
  }
)

function autoGrow(): void {
  const el = titleInput.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ---------- название новой задачи: быстрый набор, разбор ИИ, голос ----------
const titleFocused = ref(false)
/** метки из «#метка», которых ещё нет: создаются только при сохранении, чтобы после «Отмены» не оставалось лишних */
const quickNewTags = ref<string[]>([])
const parseBusy = ref(false)
let parseGen = 0
let skipShift = false

/** что распознано в названии прямо сейчас — для чипов под полем */
const quick = computed(() => (editor.open && editor.isNew && editor.item ? parseQuick(it.value.title, today.value) : null))
const wordy = computed(() => it.value.title.trim().split(/\s+/).length >= 5)

const voiceOn = computed(() => aiOn.value && settings.value.aiVoice)
const voice = useVoice(async (t) => {
  if (!editor.open || !editor.isNew) return
  it.value.title = t
  await nextTick()
  autoGrow()
  await aiParse()
})
const { recording, seconds: recSeconds, level: recLevel, transcribing } = voice
const inputBusy = computed(() => recording.value || transcribing.value || parseBusy.value)

const titlePlaceholder = computed(() => {
  if (recording.value) return `Говорите… 0:${String(recSeconds.value).padStart(2, '0')}  ·  Enter — готово, Esc — отмена`
  if (transcribing.value) return 'Расшифровываю…'
  return it.value.type === 'task' ? 'Что нужно сделать?' : 'Название события'
})

function findTag(name: string): { id: string; color: string } | undefined {
  return state.data.tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
}

function addTagByName(name: string): void {
  const t = findTag(name)
  if (t) {
    if (!it.value.tags.includes(t.id)) it.value.tags.push(t.id)
  } else if (!quickNewTags.value.some((n) => n.toLowerCase() === name.toLowerCase())) {
    quickNewTags.value.push(name)
  }
}

function removeQuickTag(name: string): void {
  quickNewTags.value = quickNewTags.value.filter((n) => n !== name)
}

/** выставить начало и конец разом, без автосдвига конца */
function setTimes(time: string | null, endTime: string | null): void {
  if (it.value.time !== time) skipShift = true
  it.value.time = time
  it.value.endTime = endTime
}

/** время из быстрого набора: без даты — на сегодня; у события сохраняем длительность (или час) */
function applyTime(t: string): void {
  const item = it.value
  if (!item.date) setDate(today.value)
  let end: string | null = null
  if (item.type === 'event') {
    const dur = item.time && item.endTime ? minutesOf(item.endTime) - minutesOf(item.time) : 0
    end = hhmm(minutesOf(t) + (dur > 0 ? dur : 60))
  }
  setTimes(t, end)
}

function applyParsed(p: Parsed, withTitle: boolean): void {
  if (withTitle) it.value.title = p.title
  if (p.date) setDate(p.date)
  if (p.time) applyTime(p.time)
  if (p.priority) it.value.priority = p.priority
  for (const n of p.tags) addTagByName(n)
}

/** «завтра 18:30 !2 #дом» в названии → поля формы (при уходе из названия и при сохранении) */
function applyQuick(): void {
  if (!editor.open || !editor.isNew || inputBusy.value) return
  const p = parseQuick(it.value.title, today.value)
  if (!p.hints.length) return
  applyParsed(p, true)
  nextTick(autoGrow)
}

function onTitleBlur(): void {
  titleFocused.value = false
  // переключились в другое окно — недописанный текст не трогаем
  if (!document.hasFocus()) return
  applyQuick()
}

/** ответ ИИ → поля формы; то, о чём модель не сказала, остаётся как было */
function mergeDraft(d: AiDraft): void {
  const item = it.value
  const a = d.item
  if (a.title) item.title = a.title
  if (a.notes) item.notes = item.notes.trim() ? `${item.notes.trimEnd()}\n${a.notes}` : a.notes
  if (a.type === 'event') item.type = 'event'
  // без названной даты ИИ возвращает текущую дату формы (contextDate)
  if (a.date !== undefined) setDate(a.date ?? '')
  if (a.time && item.date) setTimes(a.time, item.type === 'event' ? (a.endTime ?? hhmm(minutesOf(a.time) + 60)) : null)
  if (a.priority) item.priority = a.priority
  if (a.reminder !== undefined && a.reminder !== state.data.settings.defaultReminder) item.reminder = a.reminder
  if (a.recurrence && item.date) item.recurrence = { ...a.recurrence, weekdays: [...a.recurrence.weekdays] }
  for (const id of a.tags ?? []) if (!item.tags.includes(id)) item.tags.push(id)
  for (const n of d.newTags) {
    if (!editor.aiNewTags.some((x) => x.toLowerCase() === n.toLowerCase())) editor.aiNewTags.push(n)
  }
  editor.aiFilled = true
}

/** разобрать введённый (или надиктованный) текст локальным ИИ и заполнить форму */
async function aiParse(): Promise<void> {
  if (!editor.open || !editor.isNew || !aiOn.value || parseBusy.value) return
  const raw = it.value.title.replace(/\s+/g, ' ').trim()
  if (!raw) return
  const id = it.value.id
  const my = ++parseGen
  parseBusy.value = true
  const r = await api.aiParseTask(raw, it.value.date)
  if (my !== parseGen) return
  parseBusy.value = false
  if (!editor.open || editor.item?.id !== id) return
  if (!r.ok) {
    toast(r.error, undefined, 7000)
    return
  }
  mergeDraft(r.data)
  // точные токены быстрого набора важнее догадок модели
  const local = parseQuick(raw, today.value)
  if (local.hints.length) applyParsed(local, false)
  // если модель оставила «завтра», «!2» и т. п. в названии — убираем
  const rest = parseQuick(it.value.title, today.value)
  if (rest.hints.length && rest.title) it.value.title = rest.title
  editor.aiNewTags = editor.aiNewTags.filter((n) => !quickNewTags.value.some((q) => q.toLowerCase() === n.toLowerCase()))
  await nextTick()
  autoGrow()
  titleInput.value?.focus()
}

function toggleMic(): void {
  if (!recording.value && (parseBusy.value || transcribing.value)) return
  void voice.toggle()
}

function onTitleEnter(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (recording.value) {
    e.preventDefault()
    void voice.finish()
    return
  }
  if (e.altKey) {
    e.preventDefault()
    void aiParse()
    return
  }
  // Ctrl+Enter — общий обработчик формы; Shift+Enter — перенос строки, как раньше
  if (e.ctrlKey || e.metaKey || e.shiftKey) return
  e.preventDefault()
  void save()
}

const freq = computed({
  get: () => it.value.recurrence.freq,
  set: (f: RepeatFreq) => {
    it.value.recurrence.freq = f
    if (f === 'weekly' && !it.value.recurrence.weekdays.length && it.value.date) {
      it.value.recurrence.weekdays = [new Date(it.value.date + 'T00:00').getDay()]
    }
  }
})

const unitLabel = computed(() => {
  switch (it.value.recurrence.freq) {
    case 'daily':
      return 'дн.'
    case 'weekly':
      return 'нед.'
    case 'monthly':
      return 'мес.'
    case 'yearly':
      return 'г.'
  }
  return ''
})

function toggleWeekday(d: number): void {
  const w = it.value.recurrence.weekdays
  const i = w.indexOf(d)
  if (i >= 0) {
    if (w.length > 1) w.splice(i, 1)
  } else w.push(d)
}

function toggleTag(id: string): void {
  const i = it.value.tags.indexOf(id)
  if (i >= 0) it.value.tags.splice(i, 1)
  else it.value.tags.push(id)
}

async function startTag(): Promise<void> {
  addingTag.value = true
  newTag.value = ''
  await nextTick()
  tagInput.value?.focus()
}

async function commitTag(): Promise<void> {
  // Enter убирает поле → срабатывает blur; второй вызов игнорируем
  if (!addingTag.value) return
  const name = newTag.value.trim()
  addingTag.value = false
  newTag.value = ''
  if (!name) return
  const t = await createTag(name)
  if (!it.value.tags.includes(t.id)) it.value.tags.push(t.id)
}

// ---------- шаги (подзадачи) ----------
const newStep = ref('')
const aiBusy = ref(false)
const stepFocused = ref(false)
/** подсказка «Enter — добавить» в поле нового шага */
const stepHint = computed(() => stepFocused.value || !!newStep.value.trim())

function addStep(): void {
  const t = newStep.value.replace(/\s+/g, ' ').trim()
  if (!t) return
  it.value.subtasks.push({ id: uid(), title: t, done: false })
  newStep.value = ''
}

function removeStep(i: number): void {
  it.value.subtasks.splice(i, 1)
}

async function aiSteps(): Promise<void> {
  const title = it.value.title.trim()
  if (!title) {
    error.value = 'Сначала введите название — по нему ИИ придумает шаги'
    titleInput.value?.focus()
    return
  }
  const id = it.value.id
  aiBusy.value = true
  const r = await api.aiBreakdown(title, it.value.notes, it.value.subtasks.map((s) => s.title))
  aiBusy.value = false
  if (!editor.open || editor.item?.id !== id) return
  if (!r.ok) {
    toast(r.error, undefined, 7000)
    return
  }
  for (const step of r.data) it.value.subtasks.push({ id: uid(), title: step, done: false })
  toast(`ИИ добавил шагов: ${r.data.length}. Лишние можно удалить, затем сохраните задачу`)
}

async function acceptAiTag(name: string): Promise<void> {
  const t = await createTag(name)
  if (!it.value.tags.includes(t.id)) it.value.tags.push(t.id)
  editor.aiNewTags = editor.aiNewTags.filter((n) => n !== name)
}

function setDate(v: string): void {
  it.value.date = v || null
  if (!v) {
    it.value.recurrence.freq = 'none'
  }
}

async function save(): Promise<void> {
  if (inputBusy.value) return
  applyQuick()
  const item = it.value
  item.title = item.title.replace(/\s+/g, ' ').trim()
  if (!item.title) {
    error.value = 'Введите название'
    titleInput.value?.focus()
    return
  }
  if (!item.time) item.time = null
  if (!item.endTime || !item.time) item.endTime = null
  if (item.time && item.endTime && minutesOf(item.endTime) <= minutesOf(item.time)) {
    error.value = 'Время окончания должно быть позже начала'
    return
  }
  if (item.recurrence.until && item.date && item.recurrence.until < item.date) {
    error.value = 'Дата окончания повторов раньше даты начала'
    return
  }
  if (item.type === 'task') item.endTime = null
  item.subtasks = item.subtasks
    .map((st) => ({ ...st, title: st.title.replace(/\s+/g, ' ').trim() }))
    .filter((st) => st.title)
  if (!item.date) {
    item.recurrence.freq = 'none'
    item.time = null
    item.endTime = null
  }
  // новые метки из «#метка» — только сейчас, когда задача точно сохраняется
  for (const name of quickNewTags.value) {
    const t = await createTag(name)
    if (!item.tags.includes(t.id)) item.tags.push(t.id)
  }
  quickNewTags.value = []
  await saveItem(item)
  closeEditor()
}

async function remove(): Promise<void> {
  const original = state.data.items.find((i) => i.id === it.value.id)
  if (!original) return closeEditor()
  if (await deleteOcc(original, editor.occDate)) closeEditor()
}

async function toggleDone(): Promise<void> {
  const original = state.data.items.find((i) => i.id === it.value.id)
  if (!original) return
  await toggleOcc(makeOcc(original, editor.occDate ?? original.date))
  closeEditor()
}

const isDoneNow = computed(() => {
  const original = state.data.items.find((i) => i.id === it.value?.id)
  if (!original) return false
  return makeOcc(original, editor.occDate ?? original.date).done
})

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.stopPropagation()
    // Esc во время записи — отменить запись, а не закрыть форму
    if (recording.value) voice.cancel()
    else closeEditor()
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    save()
  }
}

const quickDates = computed(() => [
  { label: 'Сегодня', value: today.value },
  { label: 'Завтра', value: addDays(today.value, 1) },
  { label: '+7 дней', value: addDays(today.value, 7) }
])
</script>

<template>
  <Transition name="fade">
    <div v-if="editor.open && editor.item" class="overlay" @mousedown.self="closeEditor" @keydown="onKey">
      <Transition name="pop" appear>
        <div class="modal" role="dialog" aria-modal="true">
          <div class="top">
            <div class="seg">
              <button :class="{ active: it.type === 'task' }" @click="it.type = 'task'">
                <Icon name="checkCircle" :size="15" />Задача
              </button>
              <button :class="{ active: it.type === 'event' }" @click="it.type = 'event'">
                <Icon name="event" :size="15" />Событие
              </button>
            </div>
            <span class="spacer" />
            <button
              v-if="!editor.isNew"
              class="btn sm"
              :class="{ primary: !isDoneNow }"
              @click="toggleDone"
            >
              <Icon name="check" :size="14" :stroke="2.6" />{{ isDoneNow ? 'Вернуть' : 'Выполнено' }}
            </button>
            <button class="icon-btn" title="Закрыть (Esc)" @click="closeEditor"><Icon name="x" /></button>
          </div>

          <div class="scroll">
            <div class="title-row">
              <textarea
                ref="titleInput"
                v-model="it.title"
                class="title-input"
                rows="1"
                :placeholder="titlePlaceholder"
                :readonly="inputBusy"
                @input="autoGrow(); error = ''"
                @focus="titleFocused = true"
                @blur="onTitleBlur"
                @keydown.enter="onTitleEnter"
              />
              <template v-if="editor.isNew">
                <button
                  v-if="aiOn && it.title.trim() && !inputBusy"
                  class="title-ai"
                  :class="{ hot: wordy }"
                  title="Разобрать текст локальным ИИ и заполнить поля (Alt+Enter)"
                  @mousedown.prevent
                  @click="aiParse"
                >
                  <Icon name="sparkles" :size="14" />ИИ
                </button>
                <span v-if="parseBusy" class="title-busy"><Icon name="sparkles" :size="14" class="spin" />ИИ разбирает…</span>
                <button
                  v-if="voiceOn && (!it.title.trim() || recording) && !parseBusy"
                  class="mic"
                  :class="{ rec: recording, busy: transcribing }"
                  :style="{ '--lvl': recLevel }"
                  :disabled="transcribing"
                  :title="recording ? 'Закончить запись (Enter)' : 'Надиктовать задачу голосом (до 30 с) — ИИ заполнит поля'"
                  @mousedown.prevent
                  @click="toggleMic"
                >
                  <Icon :name="recording ? 'stop' : 'mic'" :size="16" :stroke="2.2" />
                </button>
              </template>
            </div>

            <!-- подсказка быстрого набора / что распознано; место зарезервировано, чтобы форма не прыгала -->
            <div v-if="editor.isNew" class="quick-row">
              <template v-if="titleFocused && !inputBusy">
                <template v-if="quick && quick.hints.length">
                  <span v-if="quick.date" class="chip"><Icon name="calendar" :size="12" />{{ shortDate(quick.date, today) }}</span>
                  <span v-if="quick.time" class="chip"><Icon name="clock" :size="12" />{{ quick.time }}</span>
                  <span v-if="quick.priority" class="chip" :style="{ color: PRIORITIES[quick.priority].color }">
                    <Icon name="flag" :size="12" />{{ PRIORITIES[quick.priority].label }}
                  </span>
                  <span v-for="t in quick.tags" :key="t" class="chip" :title="findTag(t) ? '' : 'Новая метка — создастся при сохранении'">
                    <span class="dot" :style="{ background: findTag(t)?.color ?? 'var(--muted)' }" />{{ t }}
                  </span>
                  <span class="muted"><span class="kbd">Tab</span> — разнести по полям</span>
                </template>
                <template v-else>
                  <span class="muted">Быстрый набор: «завтра 18:30 !2 #дом»</span>
                  <span v-if="aiOn" class="muted">· <span class="kbd">Alt Enter</span> — разобрать ИИ</span>
                </template>
              </template>
            </div>

            <div v-if="editor.aiFilled" class="ai-banner">
              <Icon name="sparkles" :size="14" />
              <span>Заполнено ИИ — проверьте поля перед сохранением</span>
              <template v-if="editor.aiNewTags.length">
                <span class="muted">· новые метки:</span>
                <button v-for="n in editor.aiNewTags" :key="n" class="tag-chip add" title="Создать метку и добавить" @click="acceptAiTag(n)">
                  <Icon name="plus" :size="12" />{{ n }}
                </button>
              </template>
            </div>

            <p v-if="!editor.isNew && isRecurring(it)" class="series">
              <Icon name="repeat" :size="13" />
              Изменения применяются ко всей серии{{ editor.occDate ? ` (открыто вхождение ${dayMonth(editor.occDate)})` : '' }}
            </p>

            <div class="grid">
              <!-- Дата -->
              <label class="field-label"><Icon name="calendar" :size="15" />Дата</label>
              <div class="field">
                <div class="date-row">
                  <input type="date" class="input date" :value="it.date ?? ''" @change="setDate(($event.target as HTMLInputElement).value)" />
                  <button v-for="q in quickDates" :key="q.value" class="btn sm ghost" :class="{ on: it.date === q.value }" @click="setDate(q.value)">{{ q.label }}</button>
                  <button v-if="it.type === 'task'" class="btn sm ghost" :class="{ on: !it.date }" @click="setDate('')">Без даты</button>
                </div>
              </div>

              <!-- Время -->
              <template v-if="it.date">
                <label class="field-label"><Icon name="clock" :size="15" />Время</label>
                <div class="field time-row">
                  <label class="inline"><Toggle v-model="allDay" /> Весь день</label>
                  <template v-if="!allDay">
                    <input v-model="it.time" type="time" class="input time" required />
                    <template v-if="it.type === 'event'">
                      <span class="muted">—</span>
                      <input v-model="it.endTime" type="time" class="input time" />
                    </template>
                  </template>
                </div>
              </template>

              <!-- Напоминание -->
              <template v-if="it.date">
                <label class="field-label"><Icon name="bell" :size="15" />Напомнить</label>
                <div class="field">
                  <select v-model="it.reminder" class="select">
                    <option v-for="o in REMINDER_OPTIONS" :key="String(o.value)" :value="o.value">{{ o.label }}</option>
                  </select>
                  <p v-if="allDay && it.reminder !== null" class="hint">Для задач без времени отсчёт идёт от 9:00</p>
                </div>
              </template>

              <!-- Повтор -->
              <template v-if="it.date">
                <label class="field-label"><Icon name="repeat" :size="15" />Повтор</label>
                <div class="field">
                  <div class="repeat-row">
                    <select v-model="freq" class="select">
                      <option value="none">Не повторять</option>
                      <option value="daily">Ежедневно</option>
                      <option value="weekly">Еженедельно</option>
                      <option value="monthly">Ежемесячно</option>
                      <option value="yearly">Ежегодно</option>
                    </select>
                    <template v-if="it.recurrence.freq !== 'none'">
                      <span class="muted">каждые</span>
                      <input v-model.number="it.recurrence.interval" type="number" min="1" max="365" class="input num" />
                      <span class="muted">{{ unitLabel }}</span>
                    </template>
                  </div>
                  <div v-if="it.recurrence.freq === 'weekly'" class="weekdays">
                    <button
                      v-for="d in [1, 2, 3, 4, 5, 6, 0]"
                      :key="d"
                      :class="{ on: it.recurrence.weekdays.includes(d) }"
                      @click="toggleWeekday(d)"
                    >
                      {{ WD_SHORT[d] }}
                    </button>
                  </div>
                  <div v-if="it.recurrence.freq !== 'none'" class="until">
                    <span class="muted">До</span>
                    <input
                      type="date"
                      class="input date"
                      :value="it.recurrence.until ?? ''"
                      :min="it.date"
                      @change="it.recurrence.until = ($event.target as HTMLInputElement).value || null"
                    />
                    <span class="muted small">{{ it.recurrence.until ? '' : 'бессрочно' }}</span>
                  </div>
                  <p v-if="it.recurrence.freq !== 'none'" class="hint">{{ recurrenceLabel(it) }}</p>
                </div>
              </template>

              <!-- Приоритет -->
              <label class="field-label"><Icon name="flag" :size="15" />Приоритет</label>
              <div class="field">
                <div class="seg prio">
                  <button
                    v-for="p in PRIORITIES"
                    :key="p.value"
                    :class="{ active: it.priority === p.value }"
                    @click="it.priority = p.value"
                  >
                    <Icon name="flag" :size="13" :style="{ color: p.color }" />{{ p.label }}
                  </button>
                </div>
              </div>

              <!-- Метки -->
              <label class="field-label"><Icon name="tag" :size="15" />Метки</label>
              <div class="field tags">
                <button
                  v-for="t in state.data.tags"
                  :key="t.id"
                  class="tag-chip"
                  :class="{ on: it.tags.includes(t.id) }"
                  :style="{ '--c': t.color }"
                  @click="toggleTag(t.id)"
                >
                  <span class="dot" :style="{ background: t.color }" />{{ t.name }}
                </button>
                <input
                  v-if="addingTag"
                  ref="tagInput"
                  v-model="newTag"
                  class="input tag-new"
                  placeholder="Новая метка"
                  maxlength="40"
                  @keydown.enter.prevent.stop="commitTag"
                  @keydown.esc.stop="addingTag = false"
                  @blur="commitTag"
                />
                <button v-else class="tag-chip add" @click="startTag"><Icon name="plus" :size="12" />Метка</button>
                <button
                  v-for="n in quickNewTags"
                  :key="'new:' + n"
                  class="tag-chip on pending"
                  title="Новая метка — создастся при сохранении. Нажмите, чтобы убрать"
                  @click="removeQuickTag(n)"
                >
                  <Icon name="plus" :size="12" />{{ n }}
                </button>
              </div>

              <!-- Шаги -->
              <label class="field-label"><Icon name="checklist" :size="15" />Шаги</label>
              <div class="field steps">
                <div v-for="(st, i) in it.subtasks" :key="st.id" class="step">
                  <button class="step-check" :class="{ checked: st.done }" :title="st.done ? 'Не сделано' : 'Сделано'" @click="st.done = !st.done">
                    <Icon v-if="st.done" name="check" :size="11" :stroke="3" />
                  </button>
                  <input v-model="st.title" class="step-title" :class="{ done: st.done }" maxlength="200" @keydown.enter.prevent />
                  <button class="icon-btn step-del" title="Удалить шаг" @click="removeStep(i)"><Icon name="x" :size="13" /></button>
                </div>
                <div class="step-add">
                  <div class="step-input">
                    <input
                      v-model="newStep"
                      class="input"
                      :class="{ 'with-hint': stepHint }"
                      placeholder="Добавить шаг…"
                      maxlength="200"
                      @focus="stepFocused = true"
                      @blur="stepFocused = false"
                      @keydown.enter.prevent.stop="addStep"
                    />
                    <span v-if="stepHint" class="step-hint" :class="{ ready: newStep.trim() }"><span class="kbd">Enter</span> — добавить</span>
                  </div>
                  <button v-if="aiOn" class="btn sm ai-btn" :disabled="aiBusy" title="Локальный ИИ предложит шаги" @click="aiSteps">
                    <Icon name="sparkles" :size="14" :class="{ spin: aiBusy }" />{{ aiBusy ? 'Думаю…' : 'Разбить на шаги' }}
                  </button>
                </div>
              </div>

              <!-- Заметки -->
              <label class="field-label"><Icon name="note" :size="15" />Заметки</label>
              <div class="field">
                <textarea v-model="it.notes" class="textarea" placeholder="Подробности, ссылки, чек-лист…" />
              </div>
            </div>
          </div>

          <div class="footer">
            <button v-if="!editor.isNew" class="btn danger" @click="remove"><Icon name="trash" :size="15" />Удалить</button>
            <span v-if="error" class="error"><Icon name="alert" :size="14" />{{ error }}</span>
            <span class="spacer" />
            <span class="kbd">Ctrl Enter</span>
            <button class="btn" @click="closeEditor">Отмена</button>
            <button class="btn primary" :disabled="inputBusy" @click="save">{{ editor.isNew ? 'Создать' : 'Сохранить' }}</button>
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped>
.ai-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  margin: 2px 0 8px;
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--accent-text);
  background: var(--accent-soft);
}
.steps {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px 2px 8px;
  border-radius: 8px;
}
.step:hover {
  background: var(--hover);
}
.step-check {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 2px solid var(--border-strong);
  display: grid;
  place-items: center;
  color: #fff;
}
.step-check.checked {
  background: var(--success);
  border-color: var(--success);
}
.step-title {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: none;
  outline: none;
  background: transparent;
}
.step-title.done {
  text-decoration: line-through;
  color: var(--muted);
}
.step-del {
  width: 26px;
  height: 26px;
  opacity: 0;
}
.step:hover .step-del,
.step-del:focus-visible {
  opacity: 1;
}
.step-add {
  display: flex;
  gap: 6px;
  align-items: center;
}
.step-input {
  position: relative;
  flex: 1;
  min-width: 0;
}
.step-input .input {
  height: 32px;
}
.step-input .input.with-hint {
  padding-right: 112px;
}
.step-hint {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.55;
  transition: opacity 0.12s;
}
.step-hint.ready {
  opacity: 1;
}
.step-hint.ready .kbd {
  color: var(--accent-text);
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
}
.title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.title-row .title-input {
  flex: 1;
  width: auto;
  min-width: 0;
}
.title-ai,
.title-busy,
.mic {
  flex: none;
  margin-top: 5px;
}
.mic {
  margin-top: 4px;
}
.title-ai {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  transition: background 0.12s, color 0.12s;
}
.title-ai:hover,
.title-ai.hot {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.title-busy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  font-size: 12px;
  color: var(--accent-text);
  white-space: nowrap;
}
.mic {
  --lvl: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--accent-text);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  transition: background 0.12s, color 0.12s, box-shadow 0.1s;
}
.mic:hover {
  color: #fff;
  background: var(--accent);
}
.mic.rec {
  color: #fff;
  background: var(--danger);
  box-shadow: 0 0 0 calc(2px + var(--lvl) * 8px) color-mix(in srgb, var(--danger) 30%, transparent);
}
.mic.busy {
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.quick-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  min-height: 22px;
  margin: 0 0 4px;
  font-size: 12px;
}
.tag-chip.pending {
  --c: var(--accent);
  border-style: dashed;
}
.ai-btn {
  flex: none;
  color: var(--accent-text);
  background: var(--accent-soft);
  border-color: transparent;
}
.ai-btn:disabled {
  opacity: 0.7;
  cursor: progress;
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 12, 0.55);
  backdrop-filter: blur(3px);
  display: grid;
  place-items: center;
  z-index: 50;
  padding: 50px 20px 20px;
}
.modal {
  width: min(640px, 100%);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 0 20px;
}
.spacer {
  flex: 1;
}
.scroll {
  overflow-y: auto;
  padding: 12px 20px 16px;
}
.title-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  resize: none;
  font-size: 21px;
  font-weight: 600;
  line-height: 1.35;
  padding: 6px 0;
  overflow: hidden;
}
.title-input::placeholder {
  color: var(--muted);
  font-weight: 500;
}
.series {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 6px;
  font-size: 12.5px;
  color: var(--accent-text);
}
.grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px 12px;
  align-items: center;
  margin-top: 10px;
}
.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
  align-self: start;
  padding-top: 8px;
}
.field {
  min-width: 0;
}
.date-row,
.time-row,
.repeat-row,
.until {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.input.date {
  width: 150px;
}
.input.time {
  width: 110px;
}
.input.num {
  width: 70px;
}
.repeat-row .select {
  width: 170px;
}
.btn.on {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.inline {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 8px;
  color: var(--text-2);
  cursor: pointer;
  height: 36px;
}
.hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--muted);
}
.small {
  font-size: 12px;
}
.weekdays {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}
.weekdays button {
  width: 36px;
  height: 30px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 12.5px;
}
.weekdays button.on {
  background: var(--accent);
  border-color: transparent;
  color: #fff;
}
.until {
  margin-top: 8px;
}
.prio button {
  padding: 0 10px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 4px;
}
.tag-chip {
  --c: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 13px;
}
.tag-chip:hover {
  border-color: var(--border-strong);
}
.tag-chip.on {
  border-color: var(--c);
  background: color-mix(in srgb, var(--c) 18%, transparent);
  color: var(--text);
}
.tag-chip.add {
  border-style: dashed;
  color: var(--muted);
}
.tag-new {
  width: 160px;
  height: 28px;
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
}
.error {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--danger);
  font-size: 13px;
}
</style>
