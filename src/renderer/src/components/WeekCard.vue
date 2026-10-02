<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import type { Occurrence } from '@shared/types'
import { isRecurring } from '@shared/recurrence'
import { PRIORITIES, priorityColor, recurrenceLabel, reminderLabel, timeRange } from '../fmt'
import { openEdit, tagsById, today, toggleOcc } from '../store'

const props = defineProps<{ occ: Occurrence }>()
const emit = defineEmits<{ dragstart: [e: DragEvent, occ: Occurrence] }>()

const item = computed(() => props.occ.item)
const isEvent = computed(() => item.value.type === 'event')
const tags = computed(() => item.value.tags.map((id) => tagsById.value.get(id)).filter((t) => !!t))
const overdue = computed(() => !props.occ.done && !!props.occ.date && props.occ.date < today.value && !isEvent.value)
const recurring = computed(() => isRecurring(item.value))

/** Цвет карточки — цвет первой метки; без меток — нейтральный (события — голубой) */
const color = computed(() => tags.value[0]?.color ?? (isEvent.value ? 'var(--event)' : 'var(--border-strong)'))

/** Полоса слева: при нескольких метках делится на цвета всех меток */
const stripe = computed(() => {
  const cs = tags.value.map((t) => t.color)
  if (cs.length <= 1) return color.value
  const step = 100 / cs.length
  return `linear-gradient(to bottom, ${cs.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`
})

const prio = computed(() => PRIORITIES[item.value.priority])
const steps = computed(() => {
  const all = item.value.subtasks
  return { done: all.filter((st) => st.done).length, total: all.length }
})
const checkColor = computed(() => (item.value.priority ? priorityColor(item.value.priority) : isEvent.value ? 'var(--event)' : 'var(--muted)'))
</script>

<template>
  <article
    class="card"
    :class="{ done: occ.done, event: isEvent, tagged: tags.length, high: item.priority === 3 }"
    :style="{ '--c': color, '--pc': checkColor, '--prio': prio.color }"
    tabindex="0"
    :draggable="!recurring"
    @click="openEdit(item, occ.date)"
    @keydown.enter.self="openEdit(item, occ.date)"
    @keydown.space.self.prevent="toggleOcc(occ)"
    @dragstart="emit('dragstart', $event, occ)"
  >
    <span class="stripe" :style="{ background: stripe }" />

    <header class="top">
      <button
        class="check"
        :class="{ checked: occ.done, square: isEvent }"
        :title="occ.done ? 'Вернуть в работу' : 'Отметить выполненным'"
        @click.stop="toggleOcc(occ)"
      >
        <Icon v-if="occ.done" name="check" :size="12" :stroke="3.2" />
      </button>
      <span class="time" :class="{ danger: overdue }">
        <template v-if="item.time">{{ timeRange(item) }}</template>
        <template v-else-if="isEvent">Весь день</template>
        <template v-else-if="overdue">Просрочено</template>
      </span>
      <span
        v-if="item.priority"
        class="prio"
        :title="`Приоритет: ${prio.label.toLowerCase()}`"
      >
        <Icon name="flag" :size="12" :stroke="2.4" />{{ '!'.repeat(item.priority) }}
      </span>
    </header>

    <h4 class="title">
      <Icon v-if="isEvent" name="event" :size="14" class="ev-icon" />{{ item.title || 'Без названия' }}
    </h4>

    <p v-if="item.notes" class="notes">{{ item.notes }}</p>

    <div v-if="steps.total" class="progress" :title="`Шаги: ${steps.done} из ${steps.total}`">
      <Icon name="checklist" :size="13" />
      <span class="bar"><span :style="{ width: (steps.done / steps.total) * 100 + '%' }" /></span>
      <span class="num">{{ steps.done }}/{{ steps.total }}</span>
    </div>

    <footer v-if="tags.length || recurring || (item.reminder !== null && item.date)" class="bottom">
      <span v-for="t in tags" :key="t.id" class="tag" :style="{ '--tc': t.color }">
        <span class="dot" />{{ t.name }}
      </span>
      <span class="icons">
        <span v-if="recurring" :title="recurrenceLabel(item)"><Icon name="repeat" :size="13" /></span>
        <span v-if="item.reminder !== null && item.date" :title="reminderLabel(item.reminder)"><Icon name="bell" :size="13" /></span>
      </span>
    </footer>
  </article>
</template>

<style scoped>
.card {
  --c: var(--border-strong);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 11px 10px 15px;
  border-radius: 11px;
  background: color-mix(in srgb, var(--c) 9%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--c) 28%, var(--border));
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s;
  outline: none;
  flex: none;
}
.card:not(.tagged):not(.event) {
  background: var(--surface);
}
.card:hover {
  border-color: color-mix(in srgb, var(--c) 55%, var(--border));
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
  transform: translateY(-1px);
}
.card:focus-visible {
  box-shadow: 0 0 0 2px var(--accent);
}
.card.high {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--prio) 45%, transparent);
}
.card.done {
  opacity: 0.55;
}
.card.done .title {
  text-decoration: line-through;
  color: var(--muted);
}
.stripe {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.check {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--pc);
  display: grid;
  place-items: center;
  color: #fff;
  background: color-mix(in srgb, var(--pc) 10%, transparent);
  transition: background 0.15s, transform 0.1s;
}
.check.square {
  border-radius: 5px;
}
.check:hover {
  background: color-mix(in srgb, var(--pc) 30%, transparent);
}
.check:active {
  transform: scale(0.9);
}
.check.checked {
  background: var(--pc);
}
.time {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.time.danger {
  color: var(--danger);
}
.prio {
  margin-left: auto;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px 0 6px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: var(--prio);
  background: color-mix(in srgb, var(--prio) 16%, transparent);
}
.title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text);
  overflow-wrap: anywhere;
  white-space: normal;
}
.ev-icon {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 5px;
  color: var(--event);
}
.notes {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: pre-line;
}
.progress {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-3);
  overflow: hidden;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--success);
  border-radius: 2px;
  transition: width 0.2s;
}
.bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin-top: 1px;
}
.tag {
  --tc: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  color: color-mix(in srgb, var(--tc) 65%, var(--text));
  background: color-mix(in srgb, var(--tc) 18%, transparent);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tc);
  flex: none;
}
.icons {
  display: inline-flex;
  gap: 6px;
  margin-left: auto;
  color: var(--muted);
}
</style>
