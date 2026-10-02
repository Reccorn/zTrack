<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import Icon from './Icon.vue'
import Toggle from './Toggle.vue'
import { aiOn, api, closeEditor, createTag, deleteOcc, editor, saveItem, state, today, toast, toggleOcc } from '../store'
import { PRIORITIES, REMINDER_OPTIONS, WD_SHORT, hhmm, minutesOf, recurrenceLabel, dayMonth, uid } from '../fmt'
import { isRecurring, makeOcc, addDays } from '@shared/recurrence'
import type { Item, RepeatFreq } from '@shared/types'

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
    if (!open) return
    error.value = ''
    addingTag.value = false
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
    closeEditor()
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
            <textarea
              ref="titleInput"
              v-model="it.title"
              class="title-input"
              rows="1"
              :placeholder="it.type === 'task' ? 'Что нужно сделать?' : 'Название события'"
              @input="autoGrow(); error = ''"
              @keydown.enter.exact.prevent="save"
            />

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
                  <input v-model="newStep" class="input" placeholder="Добавить шаг…" maxlength="200" @keydown.enter.prevent.stop="addStep" />
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
            <button class="btn primary" @click="save">{{ editor.isNew ? 'Создать' : 'Сохранить' }}</button>
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
.step-add .input {
  height: 32px;
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
