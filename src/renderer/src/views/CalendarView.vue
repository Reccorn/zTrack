<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '../components/Icon.vue'
import MonthGrid from '../components/MonthGrid.vue'
import WeekGrid from '../components/WeekGrid.vue'
import DayPanel from '../components/DayPanel.vue'
import WeekAssistant from '../components/WeekAssistant.vue'
import { addDays, fromKey, toKey } from '@shared/recurrence'
import { MONTHS, MONTHS_GEN, weekStart } from '../fmt'
import { aiOn, settings, today, ui } from '../store'

const assistant = ref(false)

const title = computed(() => {
  const d = fromKey(ui.calCursor)
  if (ui.calMode === 'month') return { main: MONTHS[d.getMonth()], year: String(d.getFullYear()) }
  const s = fromKey(weekStart(ui.calCursor, settings.value.weekStartsOn))
  const e = fromKey(addDays(toKey(s), 6))
  const range =
    s.getMonth() === e.getMonth()
      ? `${s.getDate()}–${e.getDate()} ${MONTHS_GEN[s.getMonth()]}`
      : `${s.getDate()} ${MONTHS_GEN[s.getMonth()]} – ${e.getDate()} ${MONTHS_GEN[e.getMonth()]}`
  return { main: range, year: String(e.getFullYear()) }
})

function shift(dir: number): void {
  if (ui.calMode === 'month') {
    const d = fromKey(ui.calCursor)
    d.setDate(1)
    d.setMonth(d.getMonth() + dir)
    ui.calCursor = toKey(d)
  } else {
    ui.calCursor = addDays(ui.calCursor, dir * 7)
  }
}

function goToday(): void {
  ui.calCursor = today.value
  ui.selectedDay = today.value
}

function onKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement).closest('input, textarea, select')) return
  if (e.key === 'ArrowLeft' && e.altKey === false && e.ctrlKey) shift(-1)
  else if (e.key === 'ArrowRight' && e.ctrlKey) shift(1)
}
</script>

<template>
  <div class="cal" tabindex="-1" @keydown="onKey">
    <div class="cal-island island">
    <header class="head">
      <div class="h-left">
        <h1>
          {{ title.main }} <span class="year">{{ title.year }}</span>
        </h1>
      </div>
      <div class="h-right">
        <div class="nav">
          <button class="icon-btn" title="Назад (Ctrl ←)" @click="shift(-1)"><Icon name="chevronLeft" /></button>
          <button class="btn sm" @click="goToday">Сегодня</button>
          <button class="icon-btn" title="Вперёд (Ctrl →)" @click="shift(1)"><Icon name="chevronRight" /></button>
        </div>
        <button
          v-if="aiOn && ui.calMode === 'week'"
          class="btn sm ai-btn"
          :class="{ on: assistant }"
          title="Локальный ИИ предложит, как распределить задачи"
          @click="assistant = !assistant"
        >
          <Icon name="sparkles" :size="14" />Ассистент
        </button>
        <div class="seg">
          <button :class="{ active: ui.calMode === 'month' }" @click="ui.calMode = 'month'">Месяц</button>
          <button :class="{ active: ui.calMode === 'week' }" @click="ui.calMode = 'week'">Неделя</button>
        </div>
      </div>
    </header>
    <div class="body">
      <div class="grid-wrap">
        <MonthGrid v-if="ui.calMode === 'month'" />
        <WeekGrid v-else />
      </div>
    </div>
    </div>
    <DayPanel v-if="ui.calMode === 'month'" />
    <WeekAssistant v-else-if="assistant && aiOn" @close="assistant = false" />
  </div>
</template>

<style scoped>
.cal {
  display: flex;
  gap: 8px;
  height: 100%;
  min-height: 0;
  outline: none;
}
.cal-island {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 24px 14px;
  flex: none;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}
.ai-btn {
  color: var(--accent-text);
  background: var(--accent-soft);
  border-color: transparent;
}
.ai-btn.on {
  background: var(--accent);
  color: #fff;
}
.year {
  color: var(--muted);
  font-weight: 500;
}
.h-right {
  display: flex;
  align-items: center;
  gap: 14px;
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
  border-top: 1px solid var(--border);
}
.grid-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
</style>
