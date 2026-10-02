<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import type { Occurrence } from '@shared/types'
import { isRecurring } from '@shared/recurrence'
import { priorityColor, recurrenceLabel, reminderLabel, shortDate, timeRange } from '../fmt'
import { deleteOcc, openEdit, tagsById, today, toggleOcc } from '../store'

const props = defineProps<{ occ: Occurrence; showDate?: boolean; compact?: boolean }>()

const item = computed(() => props.occ.item)
const overdue = computed(() => !props.occ.done && !!props.occ.date && props.occ.date < today.value)
const tags = computed(() => item.value.tags.map((id) => tagsById.value.get(id)).filter(Boolean))
const isEvent = computed(() => item.value.type === 'event')
const pColor = computed(() => (isEvent.value && !item.value.priority ? 'var(--event)' : priorityColor(item.value.priority)))
</script>

<template>
  <div
    class="row"
    :class="{ done: occ.done, compact, event: isEvent }"
    tabindex="0"
    @click="openEdit(item, occ.date)"
    @keydown.enter.self="openEdit(item, occ.date)"
    @keydown.space.self.prevent="toggleOcc(occ)"
    @keydown.delete.self="deleteOcc(item, occ.date)"
  >
    <button
      class="check"
      :class="{ checked: occ.done, square: isEvent }"
      :style="{ '--pc': pColor }"
      :title="occ.done ? 'Вернуть в работу' : 'Отметить выполненным'"
      @click.stop="toggleOcc(occ)"
    >
      <Icon v-if="occ.done" name="check" :size="12" :stroke="3.2" />
    </button>

    <div class="content">
      <div class="title">
        <Icon v-if="isEvent" name="event" :size="14" class="type-icon" />
        <span class="text">{{ item.title || 'Без названия' }}</span>
      </div>
      <div class="meta" v-if="!compact || item.time || tags.length">
        <span v-if="showDate && occ.date" class="m" :class="{ danger: overdue }">
          <Icon name="calendar" :size="12" />{{ shortDate(occ.date, today) }}
        </span>
        <span v-if="item.time" class="m" :class="{ danger: overdue && !showDate }">
          <Icon name="clock" :size="12" />{{ timeRange(item) }}
        </span>
        <span v-if="isRecurring(item)" class="m" :title="recurrenceLabel(item)"><Icon name="repeat" :size="12" /></span>
        <span v-if="item.reminder !== null && item.date" class="m" :title="reminderLabel(item.reminder)">
          <Icon name="bell" :size="12" />
        </span>
        <span v-if="item.subtasks.length" class="m" :title="`Шаги: ${item.subtasks.filter((st) => st.done).length} из ${item.subtasks.length}`">
          <Icon name="checklist" :size="12" />{{ item.subtasks.filter((st) => st.done).length }}/{{ item.subtasks.length }}
        </span>
        <span v-if="item.notes" class="m notes" :title="item.notes">
          <Icon name="note" :size="12" /><span class="notes-text">{{ item.notes }}</span>
        </span>
        <span v-for="t in tags" :key="t!.id" class="tag">
          <span class="dot" :style="{ background: t!.color }" />{{ t!.name }}
        </span>
      </div>
    </div>

    <div class="actions">
      <button class="icon-btn" title="Редактировать" @click.stop="openEdit(item, occ.date)">
        <Icon name="edit" :size="15" />
      </button>
      <button class="icon-btn danger" title="Удалить" @click.stop="deleteOcc(item, occ.date)">
        <Icon name="trash" :size="15" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 10px 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  position: relative;
  transition: background 0.1s;
  outline: none;
}
.row:hover,
.row:focus-visible {
  background: var(--hover);
}
.row:focus-visible {
  box-shadow: inset 0 0 0 1px var(--accent);
}
.row.compact {
  padding: 7px 8px;
}
.check {
  --pc: var(--muted);
  flex: none;
  width: 19px;
  height: 19px;
  margin-top: 1px;
  border-radius: 50%;
  border: 2px solid var(--pc);
  display: grid;
  place-items: center;
  color: #fff;
  transition: background 0.15s, transform 0.1s;
  background: color-mix(in srgb, var(--pc) 8%, transparent);
}
.check.square {
  border-radius: 6px;
}
.check:hover {
  background: color-mix(in srgb, var(--pc) 25%, transparent);
}
.check:active {
  transform: scale(0.9);
}
.check.checked {
  background: var(--pc);
  border-color: var(--pc);
}
.content {
  flex: 1;
  min-width: 0;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.type-icon {
  color: var(--event);
}
.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.done .text {
  text-decoration: line-through;
  color: var(--muted);
}
.done .check {
  opacity: 0.7;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.meta:empty {
  display: none;
}
.m {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.m.danger {
  color: var(--danger);
}
.notes {
  min-width: 0;
  max-width: 320px;
}
.notes-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--text-2);
}
.tag .dot {
  width: 7px;
  height: 7px;
}
.actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.1s;
  margin: -4px 0;
}
.row:hover .actions,
.row:focus-within .actions {
  opacity: 1;
}
</style>
