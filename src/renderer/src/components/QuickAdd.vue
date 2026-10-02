<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import Icon from './Icon.vue'
import { parseQuick } from '../parse'
import { aiOn, api, blankItem, createTag, openAiDraft, openNew, saveItem, settings, state, today, toast } from '../store'
import { MAX_SECONDS, startRecording, type Recording } from '../voice'
import { PRIORITIES, shortDate } from '../fmt'
import type { Item } from '@shared/types'

const props = defineProps<{
  date?: string | null
  tagId?: string | null
  placeholder?: string
  /** узкий вариант для колонок недели: без подсказок справа */
  compact?: boolean
  autofocus?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const input = ref<HTMLInputElement | null>(null)
onMounted(() => {
  if (props.autofocus) input.value?.focus()
})

function onBlur(): void {
  focused.value = false
  if (!text.value.trim() && !recording.value && !transcribing.value && !aiBusy.value) emit('close')
}

function onEsc(): void {
  if (recording.value) {
    cancelRecording()
    return
  }
  text.value = ''
  input.value?.blur()
  emit('close')
}

const text = ref('')
const focused = ref(false)
const parsed = computed(() => parseQuick(text.value, today.value))

async function build(): Promise<Partial<Item> | null> {
  const p = parsed.value
  if (!p.title) return null
  const tagIds: string[] = props.tagId ? [props.tagId] : []
  for (const name of p.tags) {
    const t = await createTag(name)
    if (!tagIds.includes(t.id)) tagIds.push(t.id)
  }
  return {
    title: p.title,
    date: p.date !== undefined ? p.date : (props.date ?? null),
    time: p.time ?? null,
    priority: p.priority ?? 0,
    tags: tagIds
  }
}

// ---------- разбор свободного текста локальным ИИ (Alt+Enter) ----------
const aiBusy = ref(false)
const wordy = computed(() => text.value.trim().split(/\s+/).length >= 5)

async function aiSubmit(): Promise<void> {
  const t = text.value.trim()
  if (!t || aiBusy.value) return
  aiBusy.value = true
  const r = await api.aiParseTask(t, props.date ?? null)
  aiBusy.value = false
  if (!r.ok) {
    toast(r.error, undefined, 7000)
    return
  }
  const tags = [...(r.data.item.tags ?? [])]
  if (props.tagId && !tags.includes(props.tagId)) tags.push(props.tagId)
  text.value = ''
  openAiDraft({ ...r.data.item, tags }, r.data.newTags)
}

// ---------- голосовой ввод ----------
const voiceOn = computed(() => aiOn.value && settings.value.aiVoice)
const recording = ref<Recording | null>(null)
const recSeconds = ref(0)
const recLevel = ref(0)
const transcribing = ref(false)
let recTimer: number | undefined
let recStarted = 0

async function toggleMic(): Promise<void> {
  if (recording.value) return finishRecording()
  if (transcribing.value || aiBusy.value) return
  try {
    recording.value = await startRecording()
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), undefined, 7000)
    return
  }
  recStarted = Date.now()
  recSeconds.value = 0
  recTimer = window.setInterval(() => {
    recSeconds.value = Math.floor((Date.now() - recStarted) / 1000)
    recLevel.value = recording.value?.level() ?? 0
    if (recSeconds.value >= MAX_SECONDS) finishRecording()
  }, 100)
}

function stopTimer(): void {
  clearInterval(recTimer)
  recLevel.value = 0
}

function cancelRecording(): void {
  stopTimer()
  recording.value?.cancel()
  recording.value = null
}

async function finishRecording(): Promise<void> {
  const rec = recording.value
  if (!rec) return
  stopTimer()
  recording.value = null
  transcribing.value = true
  try {
    const wav = await rec.stop()
    const r = await api.aiTranscribe(wav)
    if (!r.ok) {
      toast(r.error, undefined, 7000)
      return
    }
    text.value = r.data
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), undefined, 6000)
    return
  } finally {
    transcribing.value = false
  }
  // сразу разбираем расшифровку в задачу — форма откроется для проверки
  await aiSubmit()
}

onUnmounted(cancelRecording)

function onEnter(e: KeyboardEvent): void {
  if (recording.value) {
    e.preventDefault()
    finishRecording()
    return
  }
  if (e.altKey && aiOn.value) {
    e.preventDefault()
    aiSubmit()
  } else submit(e)
}

async function submit(e: KeyboardEvent): Promise<void> {
  const partial = await build()
  if (!partial) return
  if (e.ctrlKey || e.shiftKey) {
    openNew(partial)
  } else {
    await saveItem(blankItem(partial))
    if (partial.date && partial.date !== (props.date ?? null)) toast(`Добавлено на ${shortDate(partial.date, today.value).toLowerCase()}`)
  }
  text.value = ''
}
</script>

<template>
  <div class="quick" :class="{ focused, compact }">
    <Icon v-if="aiBusy" name="sparkles" :size="compact ? 15 : 18" class="plus spin" />
    <Icon v-else name="plus" :size="compact ? 15 : 18" class="plus" />
    <input
      ref="input"
      v-model="text"
      :placeholder="
        recording ? `Говорите… 0:${String(recSeconds).padStart(2, '0')}  ·  Enter — готово, Esc — отмена` : transcribing ? 'Расшифровываю…' : (placeholder ?? 'Добавить задачу…')
      "
      spellcheck="true"
      @focus="focused = true"
      @blur="onBlur"
      :disabled="aiBusy || transcribing"
      @keydown.enter="onEnter"
      @keydown.esc.stop="onEsc"
    />
    <button
      v-if="voiceOn && !text.trim() && !aiBusy"
      class="mic"
      :class="{ rec: recording, busy: transcribing }"
      :style="{ '--lvl': recLevel }"
      :disabled="transcribing"
      :title="recording ? 'Закончить запись (Enter)' : 'Надиктовать задачу голосом (до 30 с)'"
      @mousedown.prevent
      @click="toggleMic"
    >
      <Icon :name="recording ? 'stop' : 'mic'" :size="14" />
    </button>
    <button
      v-if="aiOn && text.trim() && !aiBusy"
      class="ai"
      :class="{ hot: wordy }"
      title="Разобрать фразу локальным ИИ (Alt+Enter)"
      @mousedown.prevent
      @click="aiSubmit"
    >
      <Icon name="sparkles" :size="14" /><span v-if="!compact">ИИ</span>
    </button>
    <span v-if="aiBusy" class="busy">{{ compact ? '' : 'ИИ разбирает…' }}</span>
    <div class="hints" v-if="text && !compact && !aiBusy">
      <span v-if="parsed.date" class="chip"><Icon name="calendar" :size="12" />{{ shortDate(parsed.date, today) }}</span>
      <span v-if="parsed.time" class="chip"><Icon name="clock" :size="12" />{{ parsed.time }}</span>
      <span v-if="parsed.priority" class="chip" :style="{ color: PRIORITIES[parsed.priority].color }">
        <Icon name="flag" :size="12" />{{ PRIORITIES[parsed.priority].label }}
      </span>
      <span v-for="t in parsed.tags" :key="t" class="chip">
        <span class="dot" :style="{ background: state.data.tags.find((x) => x.name.toLowerCase() === t.toLowerCase())?.color ?? 'var(--muted)' }" />{{ t }}
      </span>
      <span class="kbd">Enter</span>
    </div>
    <div class="hints help" v-else-if="focused && !compact && !recording && !transcribing">
      «завтра 18:30 !2 #дом» · <span class="kbd">Ctrl Enter</span> — подробно<template v-if="aiOn">
        · <span class="kbd">Alt Enter</span> — ИИ</template>
    </div>
  </div>
</template>

<style scoped>
.quick {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px dashed var(--border-strong);
  background: transparent;
  transition: border-color 0.12s, background 0.12s;
  margin-bottom: 6px;
}
.quick.focused {
  border-style: solid;
  border-color: var(--accent);
  background: var(--surface);
}
.quick.compact {
  height: 38px;
  padding: 0 10px;
  gap: 8px;
  border-radius: 10px;
  margin: 0;
  font-size: 13px;
}
.ai {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  transition: background 0.12s, color 0.12s;
}
.ai:hover,
.ai.hot {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.mic {
  --lvl: 0;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--muted);
  transition: background 0.12s, color 0.12s, box-shadow 0.1s;
}
.mic:hover {
  color: var(--accent-text);
  background: var(--accent-soft);
}
.mic.rec {
  color: #fff;
  background: var(--danger);
  box-shadow: 0 0 0 calc(2px + var(--lvl) * 8px) color-mix(in srgb, var(--danger) 30%, transparent);
}
.mic.busy {
  color: var(--accent-text);
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.4;
  }
}
.busy {
  font-size: 12px;
  color: var(--accent-text);
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.plus {
  color: var(--accent-text);
}
input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  min-width: 0;
}
input::placeholder {
  color: var(--muted);
}
.hints {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: none;
}
.help {
  font-size: 12px;
  color: var(--muted);
}
</style>
