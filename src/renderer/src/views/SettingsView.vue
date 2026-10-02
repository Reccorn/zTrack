<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Icon from '../components/Icon.vue'
import Toggle from '../components/Toggle.vue'
import AiSettings from '../components/AiSettings.vue'
import { api, recolorTag, removeTag, renameTag, settings, state, toast } from '../store'
import { REMINDER_OPTIONS, TAG_COLORS } from '../fmt'
import type { Settings } from '@shared/types'

const version = ref('')
onMounted(async () => (version.value = await api.getVersion()))

function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  api.updateSettings({ [key]: value } as Partial<Settings>)
}

async function doExport(): Promise<void> {
  const r = await api.exportData()
  if (r.ok) toast('Данные экспортированы')
  else if (r.error) toast('Ошибка экспорта: ' + r.error)
}

async function doImport(): Promise<void> {
  const r = await api.importData()
  if (r.ok) toast('Импорт выполнен')
  else if (r.error) toast('Ошибка импорта: ' + r.error, undefined, 7000)
}

async function test(): Promise<void> {
  await api.testNotification()
  toast('Тестовое уведомление отправлено')
}

const colorFor = ref<string | null>(null)
</script>

<template>
  <div class="settings">
    <header class="head">
      <div class="h-icon"><Icon name="settings" :size="18" /></div>
      <h1>Настройки</h1>
    </header>

    <div class="scroll">
      <div class="inner">
        <section class="card">
          <h2><Icon name="palette" :size="16" />Внешний вид</h2>
          <div class="row">
            <div class="txt">
              <div class="t">Тема</div>
              <div class="d">Тёмная — по умолчанию</div>
            </div>
            <div class="seg">
              <button :class="{ active: settings.theme === 'dark' }" @click="set('theme', 'dark')"><Icon name="moon" :size="14" />Тёмная</button>
              <button :class="{ active: settings.theme === 'light' }" @click="set('theme', 'light')"><Icon name="sun" :size="14" />Светлая</button>
              <button :class="{ active: settings.theme === 'system' }" @click="set('theme', 'system')"><Icon name="monitor" :size="14" />Как в системе</button>
            </div>
          </div>
          <div class="row">
            <div class="txt">
              <div class="t">Первый день недели</div>
            </div>
            <div class="seg">
              <button :class="{ active: settings.weekStartsOn === 1 }" @click="set('weekStartsOn', 1)">Понедельник</button>
              <button :class="{ active: settings.weekStartsOn === 0 }" @click="set('weekStartsOn', 0)">Воскресенье</button>
            </div>
          </div>
          <div class="row">
            <div class="txt">
              <div class="t">Показывать выполненные</div>
              <div class="d">В списках дней и в календаре</div>
            </div>
            <Toggle :model-value="settings.showCompleted" @update:model-value="set('showCompleted', $event)" />
          </div>
        </section>

        <section class="card">
          <h2><Icon name="power" :size="16" />Запуск и работа в фоне</h2>
          <div class="row">
            <div class="txt">
              <div class="t">Запускать вместе с Windows</div>
              <div class="d">zTrack будет стартовать при входе в систему, чтобы напоминания приходили вовремя</div>
            </div>
            <Toggle :model-value="settings.launchAtStartup" @update:model-value="set('launchAtStartup', $event)" />
          </div>
          <div class="row" :class="{ disabled: !settings.launchAtStartup }">
            <div class="txt">
              <div class="t">При автозапуске — сразу в трей</div>
              <div class="d">Окно не будет открываться, приложение тихо работает у часов</div>
            </div>
            <Toggle
              :model-value="settings.startMinimized"
              :disabled="!settings.launchAtStartup"
              @update:model-value="set('startMinimized', $event)"
            />
          </div>
          <div class="row">
            <div class="txt">
              <div class="t">Закрытие окна сворачивает в трей</div>
              <div class="d">Иначе крестик полностью закрывает приложение, и напоминания не придут</div>
            </div>
            <Toggle :model-value="settings.closeToTray" @update:model-value="set('closeToTray', $event)" />
          </div>
        </section>

        <section class="card">
          <h2><Icon name="bell" :size="16" />Уведомления</h2>
          <div class="row">
            <div class="txt">
              <div class="t">Системные уведомления</div>
              <div class="d">Напоминания в центре уведомлений Windows</div>
            </div>
            <Toggle :model-value="settings.notifications" @update:model-value="set('notifications', $event)" />
          </div>
          <div class="row" :class="{ disabled: !settings.notifications }">
            <div class="txt"><div class="t">Звук</div></div>
            <Toggle
              :model-value="settings.notificationSound"
              :disabled="!settings.notifications"
              @update:model-value="set('notificationSound', $event)"
            />
          </div>
          <div class="row">
            <div class="txt">
              <div class="t">Напоминание по умолчанию</div>
              <div class="d">Для новых задач и событий</div>
            </div>
            <select
              class="select narrow"
              :value="String(settings.defaultReminder)"
              @change="set('defaultReminder', ($event.target as HTMLSelectElement).value === 'null' ? null : Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="o in REMINDER_OPTIONS" :key="String(o.value)" :value="String(o.value)">{{ o.label }}</option>
            </select>
          </div>
          <div class="row">
            <div class="txt">
              <div class="t">Проверить</div>
              <div class="d">Если уведомление не появилось — проверьте «Параметры → Система → Уведомления» и режим «Не беспокоить»</div>
            </div>
            <button class="btn" @click="test"><Icon name="bell" :size="15" />Тестовое уведомление</button>
          </div>
        </section>

        <AiSettings />

        <section class="card">
          <h2><Icon name="tag" :size="16" />Метки</h2>
          <div v-for="t in state.data.tags" :key="t.id" class="tag-row">
            <div class="color-wrap">
              <button class="swatch" :style="{ background: t.color }" title="Цвет" @click="colorFor = colorFor === t.id ? null : t.id" />
              <div v-if="colorFor === t.id" class="palette">
                <button
                  v-for="c in TAG_COLORS"
                  :key="c"
                  class="swatch sm"
                  :class="{ on: c === t.color }"
                  :style="{ background: c }"
                  @click="recolorTag(t, c); colorFor = null"
                />
              </div>
            </div>
            <input class="input" :value="t.name" maxlength="40" @change="renameTag(t, ($event.target as HTMLInputElement).value).then(() => (($event.target as HTMLInputElement).value = t.name))" />
            <button class="icon-btn danger" title="Удалить метку" @click="removeTag(t)"><Icon name="trash" :size="15" /></button>
          </div>
          <p v-if="!state.data.tags.length" class="d">Меток пока нет. Создайте их в боковой панели или прямо в задаче (#метка при быстром вводе).</p>
        </section>

        <section class="card">
          <h2><Icon name="folder" :size="16" />Данные</h2>
          <p class="d">
            Всё хранится локально на этом компьютере, без интернета и внешних сервисов. Ежедневно создаётся автоматическая
            резервная копия (последние 14 дней).
          </p>
          <div class="buttons">
            <button class="btn" @click="doExport"><Icon name="download" :size="15" />Экспорт в JSON</button>
            <button class="btn" @click="doImport"><Icon name="upload" :size="15" />Импорт из JSON</button>
            <button class="btn ghost" @click="api.openDataFolder()"><Icon name="folder" :size="15" />Открыть папку данных</button>
          </div>
        </section>

        <section class="card about">
          <div class="logo">z</div>
          <div>
            <div class="t">zTrack {{ version }}</div>
            <div class="d">
              Горячие клавиши: <span class="kbd">Ctrl N</span> новая задача · <span class="kbd">Ctrl F</span> поиск ·
              <span class="kbd">Alt 1–6</span> разделы · <span class="kbd">Ctrl Enter</span> сохранить ·
              <span class="kbd">Пробел</span> отметить выбранную ·
              <span class="kbd">Alt Enter</span> разобрать фразу ИИ
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.head {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 32px 14px;
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
h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}
.scroll {
  flex: 1;
  overflow-y: auto;
}
.inner {
  max-width: 820px;
  padding: 4px 32px 60px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
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
  color: var(--text-2);
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
.row.disabled .txt {
  opacity: 0.5;
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
.narrow {
  width: 220px;
  flex: none;
}
.buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.tag-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.tag-row .input {
  max-width: 320px;
  height: 32px;
}
.color-wrap {
  position: relative;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  display: block;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15);
}
.swatch.sm {
  width: 20px;
  height: 20px;
}
.swatch.on {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--text);
}
.palette {
  position: absolute;
  top: 28px;
  left: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(5, 20px);
  gap: 8px;
  padding: 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.about {
  display: flex;
  gap: 14px;
  align-items: center;
}
.logo {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 11px;
  background: linear-gradient(135deg, #7c5cff, #38bdf8);
  color: #fff;
  font-weight: 800;
  font-size: 22px;
  display: grid;
  place-items: center;
  padding-bottom: 3px;
}
.about .d {
  line-height: 2;
}
</style>
