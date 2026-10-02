<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
import ItemRow from './ItemRow.vue'
import QuickAdd from './QuickAdd.vue'
import { dayOccs } from '../queries'
import { groupTitle } from '../fmt'
import { openNew, settings, today, ui } from '../store'

const title = computed(() => groupTitle(ui.selectedDay, today.value))
const occs = computed(() => dayOccs(ui.selectedDay).filter((o) => settings.value.showCompleted || !o.done))
const left = computed(() => occs.value.filter((o) => !o.done).length)
</script>

<template>
  <aside class="panel island">
    <div class="p-head">
      <div>
        <div class="p-title">{{ title.main }}</div>
        <div v-if="title.sub" class="p-sub">{{ title.sub }}</div>
        <div v-else class="p-sub">{{ left ? `${left} в работе` : 'Свободный день' }}</div>
      </div>
      <button class="icon-btn" title="Добавить на этот день" @click="openNew({ date: ui.selectedDay })">
        <Icon name="plus" />
      </button>
    </div>
    <div class="p-body">
      <QuickAdd :date="ui.selectedDay" placeholder="Добавить на этот день…" />
      <ItemRow v-for="o in occs" :key="o.key" :occ="o" compact />
      <p v-if="!occs.length" class="empty">Ничего не запланировано.<br />Двойной клик по дню в календаре — быстро создать.</p>
    </div>
  </aside>
</template>

<style scoped>
.panel {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.p-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 14px 10px 18px;
}
.p-title {
  font-size: 16px;
  font-weight: 650;
}
.p-sub {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 2px;
}
.p-sub::first-letter {
  text-transform: uppercase;
}
.p-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 20px;
}
.empty {
  color: var(--muted);
  font-size: 12.5px;
  text-align: center;
  margin-top: 30px;
  line-height: 1.6;
}
</style>
