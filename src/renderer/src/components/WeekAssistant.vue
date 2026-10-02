<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'
import type { AiWeekPlan, AiWeekSuggestion } from '@shared/types'
import { fromKey } from '@shared/recurrence'
import { WD_SHORT, weekStart } from '../fmt'
import { api, moveItem, settings, state, toast, ui } from '../store'

const emit = defineEmits<{ close: [] }>()

const start = computed(() => weekStart(ui.calCursor, settings.value.weekStartsOn))
const loading = ref(false)
const error = ref('')
const plan = ref<AiWeekPlan | null>(null)
const applied = ref(new Set<number>())
const hidden = ref(new Set<number>())

const moves = computed(() =>
  (plan.value?.suggestions ?? [])
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.kind === 'move' && !hidden.value.has(i))
)
const tips = computed(() => (plan.value?.suggestions ?? []).filter((s) => s.kind === 'tip'))
const pending = computed(() => moves.value.filter(({ i }) => !applied.value.has(i)))

function dayLabel(k?: string): string {
  if (!k) return ''
  const d = fromKey(k)
  return `${WD_SHORT[d.getDay()]} ${d.getDate()}`
}

async function run(): Promise<void> {
  loading.value = true
  error.value = ''
  plan.value = null
  applied.value = new Set()
  hidden.value = new Set()
  const weekAtStart = start.value
  const r = await api.aiPlanWeek(weekAtStart)
  if (weekAtStart !== start.value) return // неделю уже переключили — ответ устарел
  loading.value = false
  if (r.ok) plan.value = r.data
  else error.value = r.error
}

function cancel(): void {
  api.aiCancel()
  loading.value = false
}

async function apply(s: AiWeekSuggestion, i: number): Promise<boolean> {
  const item = state.data.items.find((x) => x.id === s.itemId)
  if (!item || !s.toDate) return false
  if (item.date !== s.fromDate) {
    toast(`«${item.title}» уже перенесена — предложение пропущено`)
    hidden.value.add(i)
    return false
  }
  await moveItem(item, s.toDate)
  applied.value = new Set(applied.value).add(i)
  return true
}

async function applyOne(s: AiWeekSuggestion, i: number): Promise<void> {
  if (await apply(s, i)) toast(`«${s.title}» → ${dayLabel(s.toDate)}`)
}

async function applyAll(): Promise<void> {
  let n = 0
  for (const { s, i } of pending.value) if (await apply(s, i)) n++
  if (n) toast(`Перенесено задач: ${n}`)
}

function hide(i: number): void {
  hidden.value = new Set(hidden.value).add(i)
}

watch(start, () => run())
onMounted(run)
</script>

<template>
  <aside class="assistant island">
    <header class="a-head">
      <div class="a-title"><Icon name="sparkles" :size="16" />Ассистент недели</div>
      <div class="a-actions">
        <button class="icon-btn" title="Проанализировать заново" :disabled="loading" @click="run"><Icon name="refresh" :size="15" /></button>
        <button class="icon-btn" title="Закрыть" @click="emit('close')"><Icon name="x" :size="16" /></button>
      </div>
    </header>

    <div class="a-body">
      <div v-if="loading" class="loading">
        <Icon name="sparkles" :size="22" class="spin" />
        <p>Gemma смотрит на неделю…</p>
        <p class="muted small">Первый запуск дольше: модель загружается в память</p>
        <button class="btn sm ghost" @click="cancel">Отменить</button>
      </div>

      <div v-else-if="error" class="err">
        <Icon name="alert" :size="18" />
        <p>{{ error }}</p>
        <button class="btn sm" @click="run">Повторить</button>
      </div>

      <template v-else-if="plan">
        <p v-if="plan.summary" class="summary">{{ plan.summary }}</p>

        <section v-if="moves.length" class="block">
          <div class="b-head">
            <span>Предлагаю перенести</span>
            <button v-if="pending.length > 1" class="btn sm" @click="applyAll">Применить все</button>
          </div>
          <div v-for="{ s, i } in moves" :key="i" class="sugg" :class="{ done: applied.has(i) }">
            <div class="s-title">{{ s.title }}</div>
            <div class="s-move">
              <span class="day">{{ dayLabel(s.fromDate) }}</span>
              <Icon name="chevronRight" :size="14" />
              <span class="day to">{{ dayLabel(s.toDate) }}</span>
            </div>
            <p v-if="s.text" class="s-reason">{{ s.text }}</p>
            <div class="s-actions">
              <template v-if="!applied.has(i)">
                <button class="btn sm primary" @click="applyOne(s, i)">Перенести</button>
                <button class="btn sm ghost" @click="hide(i)">Пропустить</button>
              </template>
              <span v-else class="ok"><Icon name="check" :size="14" :stroke="2.6" />Перенесено</span>
            </div>
          </div>
        </section>
        <p v-else class="muted">Переносить ничего не нужно — неделя выглядит сбалансированной.</p>

        <section v-if="tips.length" class="block">
          <div class="b-head"><span>Советы</span></div>
          <ul class="tips">
            <li v-for="(t, k) in tips" :key="k">{{ t.text }}</li>
          </ul>
        </section>

        <p class="foot muted small">Предложения делает локальная модель — ничего не меняется без вашего подтверждения.</p>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.assistant {
  width: 320px;
  flex: none;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.a-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 10px 10px 16px;
  border-bottom: 1px solid var(--border);
}
.a-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 650;
  color: var(--accent-text);
}
.a-actions {
  display: flex;
  gap: 2px;
}
.a-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.loading,
.err {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 40px 10px;
  color: var(--text-2);
}
.loading p,
.err p {
  margin: 0;
}
.err {
  color: var(--danger);
}
.err p {
  color: var(--text-2);
  margin-bottom: 8px;
}
.summary {
  margin: 0;
  padding: 12px 14px;
  border-radius: 11px;
  background: var(--accent-soft);
  line-height: 1.5;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.b-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
}
.sugg {
  padding: 11px 12px;
  border-radius: 11px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: opacity 0.2s;
}
.sugg.done {
  opacity: 0.6;
}
.s-title {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.s-move {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}
.day {
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-3);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}
.day.to {
  background: var(--accent-soft);
  color: var(--accent-text);
}
.s-reason {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.45;
}
.s-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.ok {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--success);
  font-size: 13px;
  font-weight: 600;
}
.tips {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  line-height: 1.45;
  color: var(--text-2);
}
.foot {
  margin: 0;
}
.small {
  font-size: 12px;
}
.spin {
  color: var(--accent-text);
  animation: spin 1.4s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
