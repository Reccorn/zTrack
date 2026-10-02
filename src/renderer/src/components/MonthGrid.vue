<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { addDays, fromKey, isRecurring, occurrencesInRange, compareOcc } from '@shared/recurrence'
import type { Item, Occurrence } from '@shared/types'
import { WD_SHORT, weekStart } from '../fmt'
import { visibleItems } from '../queries'
import { moveItem, openEdit, openNew, settings, state, tagsById, today, ui } from '../store'

const cellsEl = ref<HTMLDivElement | null>(null)
const rowH = ref(110)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    if (cellsEl.value) rowH.value = cellsEl.value.clientHeight / 6
  })
  if (cellsEl.value) ro.observe(cellsEl.value)
})
onUnmounted(() => ro?.disconnect())
/** сколько строк помещается в ячейку */
const fit = computed(() => Math.max(1, Math.floor((rowH.value - 36) / 23)))
function visible(k: string): Occurrence[] {
  const list = byDay.value.get(k) ?? []
  return list.length > fit.value ? list.slice(0, Math.max(1, fit.value - 1)) : list
}
function hidden(k: string): number {
  return (byDay.value.get(k)?.length ?? 0) - visible(k).length
}

const days = computed(() => {
  const first = fromKey(ui.calCursor)
  first.setDate(1)
  const firstKey = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`
  const start = weekStart(firstKey, settings.value.weekStartsOn)
  return Array.from({ length: 42 }, (_, i) => addDays(start, i))
})

const month = computed(() => fromKey(ui.calCursor).getMonth())

const byDay = computed(() => {
  const map = new Map<string, Occurrence[]>()
  const list = occurrencesInRange(visibleItems.value, days.value[0], days.value[41])
  for (const o of list) {
    if (!settings.value.showCompleted && o.done) continue
    const arr = map.get(o.date!) ?? []
    arr.push(o)
    map.set(o.date!, arr)
  }
  for (const arr of map.values()) arr.sort(compareOcc)
  return map
})

const headers = computed(() => {
  const order = settings.value.weekStartsOn === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]
  return order.map((d) => ({ d, label: WD_SHORT[d], weekend: d === 0 || d === 6 }))
})

function color(item: Item): string {
  const t = item.tags.length ? tagsById.value.get(item.tags[0]) : undefined
  return t?.color ?? (item.type === 'event' ? 'var(--event)' : 'var(--accent)')
}

function select(k: string): void {
  ui.selectedDay = k
}

// ---------- drag & drop ----------
const dragOver = ref<string | null>(null)
function onDragStart(e: DragEvent, o: Occurrence): void {
  if (isRecurring(o.item)) {
    e.preventDefault()
    return
  }
  e.dataTransfer!.setData('text/ztrack-id', o.item.id)
  e.dataTransfer!.effectAllowed = 'move'
}
function onDrop(e: DragEvent, k: string): void {
  dragOver.value = null
  const id = e.dataTransfer?.getData('text/ztrack-id')
  const item = state.data.items.find((i) => i.id === id)
  if (item && item.date !== k) moveItem(item, k)
}
</script>

<template>
  <div class="month">
    <div class="wd">
      <div v-for="h in headers" :key="h.d" :class="{ weekend: h.weekend }">{{ h.label }}</div>
    </div>
    <div ref="cellsEl" class="cells">
      <div
        v-for="k in days"
        :key="k"
        class="cell"
        :class="{
          other: fromKey(k).getMonth() !== month,
          today: k === today,
          selected: k === ui.selectedDay,
          weekend: [0, 6].includes(fromKey(k).getDay()),
          over: dragOver === k
        }"
        @click="select(k)"
        @dblclick.self="openNew({ date: k })"
        @dragover.prevent="dragOver = k"
        @dragleave="dragOver === k && (dragOver = null)"
        @drop.prevent="onDrop($event, k)"
      >
        <div class="num" @dblclick="openNew({ date: k })">
          <span>{{ fromKey(k).getDate() }}</span>
        </div>
        <div class="chips" @dblclick.self="openNew({ date: k })">
          <button
            v-for="o in visible(k)"
            :key="o.key"
            class="c"
            :class="{ done: o.done, event: o.item.type === 'event' }"
            :style="{ '--c': color(o.item) }"
            :draggable="!isRecurring(o.item)"
            :title="o.item.title"
            @click.stop="select(k); openEdit(o.item, o.date)"
            @dragstart="onDragStart($event, o)"
          >
            <span class="bullet" />
            <span v-if="o.item.time" class="t">{{ o.item.time }}</span>
            <span class="tt">{{ o.item.title }}</span>
          </button>
          <button v-if="hidden(k) > 0" class="more" @click.stop="select(k)">
            ещё {{ hidden(k) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.wd {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: none;
  border-bottom: 1px solid var(--border);
}
.wd div {
  padding: 8px 10px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  font-weight: 600;
}
.wd .weekend {
  color: color-mix(in srgb, var(--danger) 60%, var(--muted));
}
.cells {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, 1fr);
  min-height: 0;
}
.cell {
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: 4px 5px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  cursor: default;
  transition: background 0.1s;
}
.cell:nth-child(7n) {
  border-right: none;
}
.cell:nth-last-child(-n + 7) {
  border-bottom: none;
}
.cell.weekend {
  background: color-mix(in srgb, var(--surface) 40%, transparent);
}
.cell:hover {
  background: var(--hover);
}
.cell.selected {
  background: var(--accent-soft);
}
.cell.over {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 2px var(--accent);
}
.cell.other .num,
.cell.other .chips {
  opacity: 0.4;
}
.num {
  display: flex;
  justify-content: flex-end;
  padding: 2px 2px 3px;
  font-size: 12.5px;
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.num span {
  min-width: 24px;
  height: 24px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  padding: 0 5px;
}
.today .num span {
  background: var(--accent);
  color: #fff;
  font-weight: 700;
}
.chips {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 0;
}
.c {
  --c: var(--accent);
  display: flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 6px;
  border-radius: 5px;
  font-size: 12px;
  text-align: left;
  min-width: 0;
  color: var(--text);
  background: transparent;
  flex: none;
}
.c:hover {
  background: color-mix(in srgb, var(--c) 18%, transparent);
}
.c.event {
  background: color-mix(in srgb, var(--c) 20%, transparent);
}
.c.event:hover {
  background: color-mix(in srgb, var(--c) 30%, transparent);
}
.bullet {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1.5px solid var(--c);
  flex: none;
}
.c.event .bullet {
  background: var(--c);
  border-radius: 2px;
}
.c.done .bullet {
  background: var(--c);
}
.c.done .tt {
  text-decoration: line-through;
  color: var(--muted);
}
.t {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  flex: none;
  font-size: 11px;
}
.tt {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more {
  font-size: 11.5px;
  color: var(--muted);
  text-align: left;
  padding: 1px 6px;
  border-radius: 5px;
}
.more:hover {
  color: var(--text);
  background: var(--hover);
}
</style>
