<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Icon from '../components/Icon.vue'
import ItemRow from '../components/ItemRow.vue'
import QuickAdd from '../components/QuickAdd.vue'
import { addDays, compareOcc, isRecurring, makeOcc } from '@shared/recurrence'
import { activeGroups, dayOccs, doneOccs, inboxOccs, overdue, visibleItems, type Group } from '../queries'
import { aiOn, api, ask, openNew, settings, state, tagsById, today, toast, ui } from '../store'
import type { AiSearchHit } from '@shared/types'
import { groupTitle, dayMonth, WD_LONG, plural } from '../fmt'
import { fromKey } from '@shared/recurrence'

const showDone = computed(() => settings.value.showCompleted)

// ---------- поиск по смыслу (локальные эмбеддинги) ----------
const SEMANTIC_MIN_SCORE = 0.4
const semantic = ref<{ q: string; hits: AiSearchHit[] } | null>(null)
const semanticBusy = ref(false)
const semanticError = ref('')
let semTimer: number | undefined

watch(
  () => ui.search.trim(),
  (q) => {
    clearTimeout(semTimer)
    semantic.value = null
    semanticError.value = ''
    semanticBusy.value = false
    if (q.length < 3 || !aiOn.value || !settings.value.aiSemanticSearch) return
    semTimer = window.setTimeout(async () => {
      semanticBusy.value = true
      const r = await api.aiSearch(q)
      if (ui.search.trim() !== q) return // запрос уже поменялся
      semanticBusy.value = false
      if (r.ok) semantic.value = { q, hits: r.data }
      else semanticError.value = r.error
    }, 600)
  },
  { immediate: true }
)

function filterDone(g: Group): Group {
  return showDone.value ? g : { ...g, occs: g.occs.filter((o) => !o.done) }
}

const header = computed(() => {
  if (ui.search.trim()) return { title: `Поиск: «${ui.search.trim()}»`, sub: '', icon: 'search' }
  const d = fromKey(today.value)
  switch (ui.view) {
    case 'today':
      return { title: 'Сегодня', sub: `${WD_LONG[d.getDay()]}, ${dayMonth(today.value)}`, icon: 'sun' }
    case 'upcoming':
      return { title: 'Предстоящие', sub: 'Следующие 7 дней', icon: 'upcoming' }
    case 'inbox':
      return { title: 'Входящие', sub: 'Задачи без даты', icon: 'inbox' }
    case 'all':
      return { title: 'Все задачи', sub: 'Всё, что ещё не сделано', icon: 'list' }
    case 'done':
      return { title: 'Выполненные', sub: '', icon: 'checkCircle' }
    case 'tag': {
      const t = ui.tagId ? tagsById.value.get(ui.tagId) : null
      return { title: t?.name ?? 'Метка', sub: 'Задачи с меткой', icon: 'tag', color: t?.color }
    }
  }
  return { title: '', sub: '', icon: 'list' }
})

const groups = computed<Group[]>(() => {
  const t = today.value
  if (ui.search.trim()) {
    const occs = visibleItems.value
      .map((i) => makeOcc(i, i.date))
      .sort(compareOcc)
    const res: Group[] = [
      {
        key: 'search',
        title: occs.length ? `${occs.length} ${plural(occs.length, 'результат', 'результата', 'результатов')}` : 'Точных совпадений нет',
        occs
      }
    ]
    if (semantic.value) {
      const textIds = new Set(occs.map((o) => o.item.id))
      const similar = semantic.value.hits
        .filter((h) => h.score >= SEMANTIC_MIN_SCORE && !textIds.has(h.id))
        .map((h) => state.data.items.find((i) => i.id === h.id))
        .filter((i): i is NonNullable<typeof i> => !!i)
        .slice(0, 8)
        .map((i) => makeOcc(i, i.date))
      if (similar.length) res.push({ key: 'semantic', title: 'Похожие по смыслу', sub: 'нашёл локальный ИИ', occs: similar })
    }
    return res
  }
  switch (ui.view) {
    case 'today': {
      const res: Group[] = []
      if (overdue.value.length) res.push({ key: 'overdue', title: 'Просрочено', tone: 'danger', occs: overdue.value })
      res.push(filterDone({ key: 'today', title: 'Сегодня', occs: dayOccs(t), date: t }))
      return res
    }
    case 'upcoming': {
      const res: Group[] = []
      for (let i = 1; i <= 7; i++) {
        const k = addDays(t, i)
        const gt = groupTitle(k, t)
        res.push(filterDone({ key: k, title: gt.main, sub: gt.sub, occs: dayOccs(k), date: k }))
      }
      return res
    }
    case 'inbox':
      return [filterDone({ key: 'inbox', title: '', occs: inboxOccs.value, date: null })]
    case 'all':
      return titled(activeGroups(visibleItems.value))
    case 'tag':
      return titled(activeGroups(visibleItems.value.filter((i) => ui.tagId && i.tags.includes(ui.tagId))))
    case 'done':
      return [{ key: 'done', title: '', occs: doneOccs.value }]
  }
  return []
})

function titled(gs: Group[]): Group[] {
  return gs.map((g) => {
    if (g.key === 'overdue' || g.key === 'nodate') return g
    const gt = groupTitle(g.key, today.value)
    return { ...g, title: gt.main, sub: gt.sub }
  })
}

const total = computed(() => groups.value.reduce((n, g) => n + g.occs.length, 0))
const showDateInRows = ['overdue', 'search', 'done', 'semantic']

const quickDate = computed<string | null>(() => {
  if (ui.view === 'inbox') return null
  if (ui.view === 'upcoming') return addDays(today.value, 1)
  return today.value
})

const emptyText = computed(() => {
  if (ui.search.trim()) return 'Ничего не найдено'
  switch (ui.view) {
    case 'today':
      return 'На сегодня всё чисто. Можно отдыхать — или добавить задачу.'
    case 'inbox':
      return 'Входящие пусты. Сюда попадают задачи без даты.'
    case 'done':
      return 'Здесь появятся выполненные задачи.'
    default:
      return 'Задач пока нет.'
  }
})

async function clearDone(): Promise<void> {
  const items = state.data.items.filter((i) => i.done && !isRecurring(i))
  if (!items.length) return
  const r = await ask('Очистить выполненные', `Удалить ${items.length} ${plural(items.length, 'выполненную задачу', 'выполненные задачи', 'выполненных задач')}? Повторяющиеся не затрагиваются.`, [
    { label: 'Отмена', value: 'no', kind: 'ghost' },
    { label: 'Удалить', value: 'yes', kind: 'danger' }
  ])
  if (r !== 'yes') return
  for (const i of items) await api.deleteItem(i.id)
  toast('Выполненные задачи удалены')
}

function toggleShowDone(): void {
  api.updateSettings({ showCompleted: !showDone.value })
}
</script>

<template>
  <div class="list-view">
    <header class="head">
      <div class="h-left">
        <div class="h-icon" :style="header.color ? { background: header.color } : {}">
          <Icon :name="header.icon" :size="18" />
        </div>
        <div>
          <h1>{{ header.title }}</h1>
          <p v-if="header.sub" class="sub">{{ header.sub }}</p>
        </div>
      </div>
      <div class="h-right">
        <button v-if="ui.view === 'done' && !ui.search" class="btn sm ghost" @click="clearDone">
          <Icon name="trash" :size="14" />Очистить
        </button>
        <button
          v-if="['today', 'upcoming', 'inbox'].includes(ui.view) && !ui.search"
          class="btn sm ghost"
          :title="showDone ? 'Скрыть выполненные' : 'Показать выполненные'"
          @click="toggleShowDone"
        >
          <Icon :name="showDone ? 'checkCircle' : 'check'" :size="14" />
          {{ showDone ? 'Выполненные видны' : 'Выполненные скрыты' }}
        </button>
      </div>
    </header>

    <div class="scroll">
      <div class="inner">
        <QuickAdd
          v-if="ui.view !== 'done' && !ui.search"
          :date="quickDate"
          :tag-id="ui.view === 'tag' ? ui.tagId : null"
          :placeholder="ui.view === 'inbox' ? 'Добавить во входящие…' : 'Добавить задачу…'"
        />

        <p v-if="ui.search.trim() && semanticBusy" class="sem-status"><Icon name="sparkles" :size="13" class="spin" />Ищу по смыслу…</p>
        <p v-else-if="ui.search.trim() && semanticError" class="sem-status muted" :title="semanticError">
          <Icon name="alert" :size="13" />Поиск по смыслу недоступен: {{ semanticError }}
        </p>

        <section v-for="g in groups" :key="g.key" class="group">
          <div v-if="g.title" class="g-head" :class="g.tone">
            <span class="g-title">{{ g.title }}</span>
            <span v-if="g.sub" class="g-sub">{{ g.sub }}</span>
            <span class="g-count">{{ g.occs.filter((o) => !o.done).length || '' }}</span>
            <button
              v-if="g.date !== undefined && ui.view !== 'today'"
              class="icon-btn g-add"
              title="Добавить в этот день"
              @click="openNew({ date: g.date })"
            >
              <Icon name="plus" :size="14" />
            </button>
          </div>
          <TransitionGroup name="list" tag="div" class="rows">
            <ItemRow
              v-for="o in g.occs"
              :key="o.key"
              :occ="o"
              :show-date="showDateInRows.includes(g.key) || g.key === 'nodate' || ui.view === 'inbox'"
            />
          </TransitionGroup>
          <p v-if="!g.occs.length && ui.view === 'upcoming'" class="free">Свободно</p>
        </section>

        <div v-if="!total && ui.view !== 'upcoming' && !semanticBusy" class="empty">
          <div class="e-icon"><Icon :name="ui.search ? 'search' : header.icon" :size="28" :stroke="1.6" /></div>
          <p>{{ emptyText }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.list-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 22px 32px 14px;
  flex: none;
}
.h-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.h-icon {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  background: var(--accent-soft);
  color: var(--accent-text);
  display: grid;
  place-items: center;
}
.h-icon[style] {
  color: #fff;
}
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.2px;
}
.sub {
  margin: 1px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.sub::first-letter {
  text-transform: uppercase;
}
.h-right {
  display: flex;
  gap: 6px;
}
.scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.inner {
  max-width: 860px;
  padding: 4px 32px 60px;
}
.group {
  margin-top: 18px;
  position: relative;
}
.g-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 12px 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.g-title {
  font-weight: 650;
  font-size: 14px;
}
.g-head.danger .g-title {
  color: var(--danger);
}
.g-sub {
  color: var(--muted);
  font-size: 12.5px;
}
.g-count {
  color: var(--muted);
  font-size: 12px;
  margin-left: auto;
}
.g-add {
  width: 24px;
  height: 24px;
  align-self: center;
}
.rows {
  position: relative;
}
.free {
  color: var(--muted);
  font-size: 12.5px;
  margin: 6px 12px;
  opacity: 0.7;
}
.sem-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 6px 12px 0;
  font-size: 12.5px;
  color: var(--accent-text);
}
.sem-status.muted {
  color: var(--muted);
}
.spin {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.empty {
  text-align: center;
  padding: 70px 20px;
  color: var(--muted);
}
.e-icon {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  background: var(--surface-2);
  color: var(--accent-text);
}
</style>
