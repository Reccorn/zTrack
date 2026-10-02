<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from './Icon.vue'
import WeekCard from './WeekCard.vue'
import QuickAdd from './QuickAdd.vue'
import { addDays, fromKey, isRecurring } from '@shared/recurrence'
import type { Occurrence } from '@shared/types'
import { WD_LONG, WD_SHORT, MONTHS_SHORT, plural, weekStart } from '../fmt'
import { dayOccs } from '../queries'
import { moveItem, openNew, settings, state, today, toast, ui } from '../store'

const days = computed(() => {
  const s = weekStart(ui.calCursor, settings.value.weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
})

const columns = computed(() =>
  days.value.map((k) => {
    const d = fromKey(k)
    const occs = dayOccs(k).filter((o) => settings.value.showCompleted || !o.done)
    return {
      key: k,
      wd: WD_SHORT[d.getDay()],
      wdLong: WD_LONG[d.getDay()],
      num: d.getDate(),
      month: MONTHS_SHORT[d.getMonth()],
      isToday: k === today.value,
      past: k < today.value,
      weekend: d.getDay() === 0 || d.getDay() === 6,
      occs,
      left: occs.filter((o) => !o.done).length
    }
  })
)

// ---------- быстрое добавление в колонку ----------
const addingTo = ref<string | null>(null)

// ---------- drag & drop между днями ----------
const dragOver = ref<string | null>(null)
const dragging = ref<string | null>(null)

function onDragStart(e: DragEvent, occ: Occurrence): void {
  if (isRecurring(occ.item)) {
    e.preventDefault()
    toast('Повторяющуюся задачу нельзя перетащить — измените дату в карточке')
    return
  }
  dragging.value = occ.key
  e.dataTransfer!.setData('text/ztrack-id', occ.item.id)
  e.dataTransfer!.effectAllowed = 'move'
}

function onDragEnd(): void {
  dragging.value = null
  dragOver.value = null
}

function onDrop(e: DragEvent, k: string): void {
  dragOver.value = null
  dragging.value = null
  const id = e.dataTransfer?.getData('text/ztrack-id')
  const item = state.data.items.find((i) => i.id === id)
  if (item && item.date !== k) moveItem(item, k)
}
</script>

<template>
  <div class="board">
    <section
      v-for="c in columns"
      :key="c.key"
      class="col"
      :class="{ today: c.isToday, past: c.past, weekend: c.weekend, over: dragOver === c.key, selected: ui.selectedDay === c.key }"
      @dragover.prevent="dragOver = c.key"
      @dragleave.self="dragOver === c.key && (dragOver = null)"
      @drop.prevent="onDrop($event, c.key)"
    >
      <header class="col-head" :title="`${c.wdLong}, ${c.num} ${c.month}`" @click="ui.selectedDay = c.key">
        <div class="date">
          <span class="num">{{ c.num }}</span>
          <span class="wd">{{ c.wd }}</span>
          <span v-if="c.isToday" class="badge">сегодня</span>
        </div>
        <span class="count" v-if="c.left">{{ c.left }} {{ plural(c.left, 'задача', 'задачи', 'задач') }}</span>
      </header>

      <div class="cards" @dblclick.self="openNew({ date: c.key })">
        <WeekCard
          v-for="o in c.occs"
          :key="o.key"
          :occ="o"
          :class="{ dragging: dragging === o.key }"
          @dragstart="onDragStart"
          @dragend="onDragEnd"
        />

        <div v-if="!c.occs.length && addingTo !== c.key" class="empty" @dblclick="openNew({ date: c.key })">
          Свободно
        </div>

        <QuickAdd
          v-if="addingTo === c.key"
          :date="c.key"
          compact
          autofocus
          placeholder="Задача…"
          @close="addingTo = null"
        />
        <button v-else class="add" @click="addingTo = c.key">
          <Icon name="plus" :size="15" />Добавить
        </button>

      </div>
    </section>
  </div>
</template>

<style scoped>
.board {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(7, minmax(160px, 1fr));
  min-height: 0;
  overflow-x: auto;
}
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  border-right: 1px solid var(--border);
  transition: background 0.12s;
}
.col:last-child {
  border-right: none;
}
.col.weekend {
  background: color-mix(in srgb, var(--surface) 35%, transparent);
}
.col.today {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
}
.col.over {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 2px var(--accent);
}
.col-head {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 12px 10px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.col-head:hover {
  background: var(--hover);
}
.date {
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
}
.num {
  font-size: 22px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.wd {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
}
.weekend .wd {
  color: color-mix(in srgb, var(--danger) 60%, var(--muted));
}
.today .num,
.today .wd {
  color: var(--accent-text);
}
.badge {
  margin-left: auto;
  align-self: center;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}
.past .num {
  color: var(--muted);
}
.count {
  font-size: 12px;
  color: var(--muted);
}
.cards {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding: 10px 8px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cards :deep(.card.dragging) {
  opacity: 0.35;
}
.add {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 10px;
  border-radius: 9px;
  color: var(--muted);
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.12s, background 0.12s, color 0.12s;
}
.col:hover .add,
.add:focus-visible,
.col.today .add {
  opacity: 1;
}
.add:hover {
  background: var(--hover);
  color: var(--text);
}
.empty {
  min-height: 44px;
  display: grid;
  place-items: start center;
  padding-top: 10px;
  color: var(--muted);
  font-size: 12.5px;
  opacity: 0.55;
}
</style>
