<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import Icon from './Icon.vue'
import Toggle from './Toggle.vue'
import type { AiStatus, Settings } from '@shared/types'
import { api, ask, settings, toast } from '../store'

const status = ref<AiStatus | null>(null)
const checking = ref(false)

const CHAT_PRESETS = [
  { name: 'gemma4:e2b-it-qat', note: 'рекомендуется · ≈4.3 ГБ' },
  { name: 'gemma4:e4b-it-qat', note: 'умнее, тяжелее · ≈6.1 ГБ' }
]
const EMBED_PRESETS = [{ name: 'embeddinggemma', note: 'поиск по смыслу · ≈0.6 ГБ' }]

async function refresh(): Promise<void> {
  checking.value = true
  status.value = await api.aiStatus()
  checking.value = false
}

function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  api.updateSettings({ [key]: value } as Partial<Settings>)
}

async function setModel(key: 'aiModel' | 'aiEmbedModel', value: string): Promise<void> {
  const v = value.trim()
  if (!v || v === settings.value[key]) return
  await api.updateSettings({ [key]: v })
  refresh()
}

function installed(name: string): boolean {
  const norm = (m: string): string => (m.includes(':') ? m : m + ':latest').toLowerCase()
  return !!status.value?.models.some((m) => norm(m.name) === norm(name))
}

// ---------- скачивание ----------
const pulls = reactive<Record<string, { pct: number; text: string; error?: string }>>({})
let off: (() => void) | null = null

onMounted(() => {
  refresh()
  off = api.onAiPullProgress((p) => {
    const pct = p.total ? Math.round((p.completed / p.total) * 100) : (pulls[p.model]?.pct ?? 0)
    pulls[p.model] = { pct, text: p.error ? p.error : statusText(p.status), error: p.error }
  })
})
onUnmounted(() => off?.())

function statusText(s: string): string {
  if (s.startsWith('pulling manifest')) return 'Получаю описание модели…'
  if (s.startsWith('pulling') || s.startsWith('downloading')) return 'Скачиваю…'
  if (s.startsWith('verifying')) return 'Проверяю…'
  if (s.startsWith('writing')) return 'Сохраняю…'
  if (s === 'success') return 'Готово'
  return s
}

async function pull(model: string): Promise<void> {
  pulls[model] = { pct: 0, text: 'Начинаю…' }
  const r = await api.aiPull(model)
  if (r.ok) {
    toast(`Модель ${model} скачана`)
    delete pulls[model]
  } else {
    pulls[model] = { pct: pulls[model]?.pct ?? 0, text: r.error, error: r.error }
  }
  refresh()
}

function cancelPull(): void {
  api.aiCancel()
}

// ---------- установленные модели ----------
function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(bytes > 10 * 1024 ** 3 ? 0 : 1) + ' ГБ'
}

const used = computed(() => [settings.value.aiModel, settings.value.aiEmbedModel])
function isUsed(name: string): boolean {
  const norm = (m: string): string => (m.includes(':') ? m : m + ':latest').toLowerCase()
  return used.value.some((u) => norm(u) === norm(name))
}

async function remove(name: string, size: number): Promise<void> {
  const r = await ask(
    'Удалить модель из Ollama',
    `«${name}» (${gb(size)}) будет удалена с диска. ${isUsed(name) ? 'Её использует zTrack — ИИ-функции перестанут работать, пока не скачаете снова.' : 'zTrack её не использует.'}`,
    [
      { label: 'Отмена', value: 'no', kind: 'ghost' },
      { label: 'Удалить', value: 'yes', kind: 'danger' }
    ]
  )
  if (r !== 'yes') return
  const res = await api.aiDeleteModel(name)
  if (res.ok) toast(`Модель ${name} удалена`)
  else toast(res.error, undefined, 7000)
  refresh()
}

const totalSize = computed(() => (status.value?.models ?? []).reduce((s, m) => s + m.size, 0))
</script>

<template>
  <section class="card">
    <h2><Icon name="sparkles" :size="16" />Локальный ИИ</h2>

    <div class="row">
      <div class="txt">
        <div class="t">Использовать локальный ИИ</div>
        <div class="d">Gemma через Ollama на этом компьютере: разбор фраз, шаги задачи, ассистент недели, поиск по смыслу, голос</div>
      </div>
      <Toggle :model-value="settings.aiEnabled" @update:model-value="set('aiEnabled', $event)" />
    </div>

    <template v-if="settings.aiEnabled">
      <!-- статус Ollama -->
      <div class="row">
        <div class="txt">
          <div class="t status">
            <span class="dot" :class="status?.running ? 'ok' : status ? 'bad' : ''" />
            <template v-if="!status">Проверяю Ollama…</template>
            <template v-else-if="status.running">Ollama {{ status.version }} работает</template>
            <template v-else>Ollama не найдена</template>
          </div>
          <div v-if="status && !status.running" class="d">
            Установите Ollama с <a href="https://ollama.com/download" target="_blank">ollama.com</a> и запустите её, затем нажмите «Проверить».
            Адрес: {{ settings.aiUrl }}
          </div>
        </div>
        <button class="btn" :disabled="checking" @click="refresh"><Icon name="refresh" :size="15" />Проверить</button>
      </div>

      <!-- модели -->
      <div class="row model">
        <div class="txt">
          <div class="t">Языковая модель</div>
          <div class="d">Для разбора фраз, шагов, ассистента и расшифровки голоса</div>
        </div>
        <div class="model-ctl">
          <input
            class="input"
            list="chat-presets"
            :value="settings.aiModel"
            spellcheck="false"
            @change="setModel('aiModel', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="chat-presets">
            <option v-for="p in CHAT_PRESETS" :key="p.name" :value="p.name">{{ p.note }}</option>
          </datalist>
          <template v-if="status?.running">
            <span v-if="installed(settings.aiModel)" class="chip ok"><Icon name="check" :size="12" :stroke="2.6" />скачана</span>
            <button v-else-if="!pulls[settings.aiModel] || pulls[settings.aiModel].error" class="btn sm primary" @click="pull(settings.aiModel)">
              <Icon name="download" :size="14" />Скачать
            </button>
          </template>
        </div>
      </div>
      <div v-if="pulls[settings.aiModel]" class="progress" :class="{ err: pulls[settings.aiModel].error }">
        <span class="bar"><span :style="{ width: pulls[settings.aiModel].pct + '%' }" /></span>
        <span class="ptext">{{ pulls[settings.aiModel].text }} {{ pulls[settings.aiModel].error ? '' : pulls[settings.aiModel].pct + '%' }}</span>
        <button v-if="!pulls[settings.aiModel].error" class="btn sm ghost" @click="cancelPull">Отменить</button>
      </div>

      <div class="row model">
        <div class="txt">
          <div class="t">Модель для поиска по смыслу</div>
          <div class="d">Маленькая модель эмбеддингов, работает только когда вы ищете</div>
        </div>
        <div class="model-ctl">
          <input
            class="input"
            list="embed-presets"
            :value="settings.aiEmbedModel"
            spellcheck="false"
            @change="setModel('aiEmbedModel', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="embed-presets">
            <option v-for="p in EMBED_PRESETS" :key="p.name" :value="p.name">{{ p.note }}</option>
          </datalist>
          <template v-if="status?.running">
            <span v-if="installed(settings.aiEmbedModel)" class="chip ok"><Icon name="check" :size="12" :stroke="2.6" />скачана</span>
            <button
              v-else-if="!pulls[settings.aiEmbedModel] || pulls[settings.aiEmbedModel].error"
              class="btn sm primary"
              @click="pull(settings.aiEmbedModel)"
            >
              <Icon name="download" :size="14" />Скачать
            </button>
          </template>
        </div>
      </div>
      <div v-if="pulls[settings.aiEmbedModel]" class="progress" :class="{ err: pulls[settings.aiEmbedModel].error }">
        <span class="bar"><span :style="{ width: pulls[settings.aiEmbedModel].pct + '%' }" /></span>
        <span class="ptext">{{ pulls[settings.aiEmbedModel].text }} {{ pulls[settings.aiEmbedModel].error ? '' : pulls[settings.aiEmbedModel].pct + '%' }}</span>
        <button v-if="!pulls[settings.aiEmbedModel].error" class="btn sm ghost" @click="cancelPull">Отменить</button>
      </div>

      <!-- функции -->
      <div class="row">
        <div class="txt">
          <div class="t">Поиск по смыслу</div>
          <div class="d">В результатах поиска появится блок «Похожие по смыслу»</div>
        </div>
        <Toggle :model-value="settings.aiSemanticSearch" @update:model-value="set('aiSemanticSearch', $event)" />
      </div>
      <div class="row">
        <div class="txt">
          <div class="t">Голосовой ввод</div>
          <div class="d">Кнопка микрофона в строке быстрого ввода; до 30 секунд, расшифровывает Gemma</div>
        </div>
        <Toggle :model-value="settings.aiVoice" @update:model-value="set('aiVoice', $event)" />
      </div>
      <div class="row">
        <div class="txt">
          <div class="t">Выгружать модель из памяти</div>
          <div class="d">Через сколько минут простоя Ollama освобождает память. Следующий запрос будет на пару секунд дольше</div>
        </div>
        <select class="select narrow" :value="settings.aiKeepAlive" @change="set('aiKeepAlive', Number(($event.target as HTMLSelectElement).value))">
          <option :value="0">сразу после ответа</option>
          <option :value="1">через 1 минуту</option>
          <option :value="5">через 5 минут</option>
          <option :value="15">через 15 минут</option>
          <option :value="30">через 30 минут</option>
        </select>
      </div>
      <div class="row">
        <div class="txt">
          <div class="t">Адрес Ollama</div>
          <div class="d">Обычно менять не нужно</div>
        </div>
        <input
          class="input narrow"
          :value="settings.aiUrl"
          spellcheck="false"
          @change="set('aiUrl', ($event.target as HTMLInputElement).value.trim()); refresh()"
        />
      </div>

      <!-- установленные модели -->
      <div v-if="status?.running" class="models">
        <div class="m-head">
          <span>Модели в Ollama</span>
          <span class="muted">{{ status.models.length }} · {{ gb(totalSize) }}</span>
        </div>
        <div v-for="m in status.models" :key="m.name" class="m-row">
          <Icon name="cpu" :size="15" class="muted" />
          <span class="m-name">{{ m.name }}</span>
          <span v-if="isUsed(m.name)" class="chip ok">zTrack</span>
          <span class="m-size muted">{{ gb(m.size) }}</span>
          <button class="icon-btn danger" title="Удалить модель с диска" @click="remove(m.name, m.size)"><Icon name="trash" :size="15" /></button>
        </div>
        <p v-if="!status.models.length" class="d">Моделей пока нет.</p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 18px;
}
h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  margin: 0 0 6px;
  color: var(--accent-text);
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
h2 + .row {
  border-top: none;
}
.t {
  font-weight: 500;
}
.d {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 2px;
  line-height: 1.45;
}
.d a {
  color: var(--accent-text);
}
.status {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--muted);
}
.dot.ok {
  background: var(--success);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 25%, transparent);
}
.dot.bad {
  background: var(--danger);
}
.model-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.model-ctl .input {
  width: 220px;
}
.narrow {
  width: 220px;
  flex: none;
}
.chip.ok {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
}
.progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 0 12px;
  font-size: 12.5px;
  color: var(--text-2);
}
.progress.err {
  color: var(--danger);
}
.bar {
  width: 220px;
  height: 6px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
  flex: none;
}
.bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s;
}
.ptext {
  flex: 1;
}
.models {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.m-head {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--muted);
  margin-bottom: 4px;
}
.m-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px 4px 6px;
  border-radius: 8px;
}
.m-row:hover {
  background: var(--hover);
}
.m-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
}
.m-size {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
</style>
