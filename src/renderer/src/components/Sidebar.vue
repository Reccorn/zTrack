<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import Icon from './Icon.vue'
import { counts } from '../queries'
import { api, createTag, openNew, recolorTag, removeTag, renameTag, settings, state, ui, type View } from '../store'
import { TAG_COLORS } from '../fmt'
import type { Tag } from '@shared/types'

const nav: { view: View; label: string; icon: string; count?: () => number; hot?: () => boolean }[] = [
  { view: 'today', label: 'Сегодня', icon: 'sun', count: () => counts.value.today, hot: () => counts.value.overdue > 0 },
  { view: 'calendar', label: 'Календарь', icon: 'calendar' },
  { view: 'upcoming', label: 'Предстоящие', icon: 'upcoming', count: () => counts.value.upcoming },
  { view: 'inbox', label: 'Входящие', icon: 'inbox', count: () => counts.value.inbox },
  { view: 'all', label: 'Все задачи', icon: 'list' },
  { view: 'done', label: 'Выполненные', icon: 'checkCircle' }
]

function go(v: View): void {
  ui.view = v
  ui.tagId = null
}

function goTag(id: string): void {
  ui.view = 'tag'
  ui.tagId = id
}

const collapsed = computed(() => settings.value.sidebarCollapsed)
function toggleCollapsed(): void {
  api.updateSettings({ sidebarCollapsed: !collapsed.value })
}

const adding = ref(false)
const newTag = ref('')
const tagInput = ref<HTMLInputElement | null>(null)

async function startAdd(): Promise<void> {
  if (collapsed.value) await api.updateSettings({ sidebarCollapsed: false })
  adding.value = true
  newTag.value = ''
  await nextTick()
  tagInput.value?.focus()
}

async function commitTag(): Promise<void> {
  // Enter убирает поле → срабатывает blur; второй вызов игнорируем
  if (!adding.value) return
  const name = newTag.value.trim()
  adding.value = false
  newTag.value = ''
  if (name) {
    const t = await createTag(name)
    goTag(t.id)
  }
}

// ---------- меню метки: цвет / переименовать / удалить ----------
const menu = ref<{ tag: Tag; x: number; y: number } | null>(null)
const renaming = ref<string | null>(null)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement[] | null>(null)

function openMenu(e: MouseEvent, t: Tag): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.type === 'contextmenu' ? e.clientX : r.right - 8
  const y = e.type === 'contextmenu' ? e.clientY : r.bottom
  menu.value = { tag: t, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 190) }
}

function closeMenu(): void {
  menu.value = null
}

async function startRename(t: Tag): Promise<void> {
  closeMenu()
  renaming.value = t.id
  renameValue.value = t.name
  await nextTick()
  renameInput.value?.[0]?.focus()
  renameInput.value?.[0]?.select()
}

async function commitRename(t: Tag): Promise<void> {
  if (renaming.value !== t.id) return
  renaming.value = null
  await renameTag(t, renameValue.value)
}

function onGlobalKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeMenu()
}
onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))
</script>

<template>
  <aside class="sidebar island" :class="{ collapsed }">
    <button class="new btn primary" title="Новая задача (Ctrl+N)" @click="openNew()">
      <Icon name="plus" :size="16" :stroke="2.5" />
      <span class="new-label">Новая задача</span>
      <span class="kbd">Ctrl N</span>
    </button>

    <nav class="nav">
      <button
        v-for="(n, i) in nav"
        :key="n.view"
        class="nav-item"
        :class="{ active: ui.view === n.view }"
        :title="`${n.label} (Alt+${i + 1})`"
        @click="go(n.view)"
      >
        <Icon :name="n.icon" :size="17" />
        <span class="label">{{ n.label }}</span>
        <span v-if="n.count && n.count()" class="count" :class="{ hot: n.hot?.() }">{{ n.count() }}</span>
      </button>
    </nav>

    <div class="section">
      <span>Метки</span>
      <button class="icon-btn small" title="Новая метка" @click="startAdd"><Icon name="plus" :size="14" /></button>
    </div>
    <div class="tags">
      <template v-for="t in state.data.tags" :key="t.id">
        <div v-if="renaming === t.id" class="tag-add">
          <input
            ref="renameInput"
            v-model="renameValue"
            class="input"
            maxlength="40"
            @keydown.enter="commitRename(t)"
            @keydown.esc.stop="renaming = null"
            @blur="commitRename(t)"
          />
        </div>
        <div
          v-else
          class="nav-item tag"
          role="button"
          tabindex="0"
          :class="{ active: ui.view === 'tag' && ui.tagId === t.id, menu: menu?.tag.id === t.id }"
          :title="t.name"
          @click="goTag(t.id)"
          @keydown.enter="goTag(t.id)"
          @contextmenu.prevent="openMenu($event, t)"
          @dblclick="startRename(t)"
        >
          <span class="dot" :style="{ background: t.color }" />
          <span class="label">{{ t.name }}</span>
          <span v-if="counts.tags[t.id]" class="count">{{ counts.tags[t.id] }}</span>
          <button class="more" title="Действия с меткой" @click.stop="openMenu($event, t)">
            <Icon name="more" :size="15" />
          </button>
        </div>
      </template>
      <div v-if="adding" class="tag-add">
        <input
          ref="tagInput"
          v-model="newTag"
          class="input"
          placeholder="Название метки"
          maxlength="40"
          @keydown.enter="commitTag"
          @keydown.esc="adding = false"
          @blur="commitTag"
        />
      </div>
      <p v-if="!state.data.tags.length && !adding" class="empty">
        Метки помогают группировать задачи: #работа, #дом…
      </p>
    </div>

    <Teleport to="body">
      <div v-if="menu" class="menu-backdrop" @mousedown="closeMenu" @contextmenu.prevent="closeMenu" />
      <Transition name="pop">
        <div v-if="menu" class="tag-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
          <div class="colors">
            <button
              v-for="c in TAG_COLORS"
              :key="c"
              class="swatch"
              :class="{ on: c === menu.tag.color }"
              :style="{ background: c }"
              @click="recolorTag(menu.tag, c); closeMenu()"
            />
          </div>
          <button class="mi" @click="startRename(menu.tag)"><Icon name="edit" :size="15" />Переименовать</button>
          <button class="mi danger" @click="removeTag(menu.tag); closeMenu()"><Icon name="trash" :size="15" />Удалить</button>
        </div>
      </Transition>
    </Teleport>

    <div class="bottom">
      <button class="nav-item" :class="{ active: ui.view === 'settings' }" title="Настройки" @click="go('settings')">
        <Icon name="settings" :size="17" />
        <span class="label">Настройки</span>
      </button>
      <button
        class="icon-btn collapse"
        :title="collapsed ? 'Развернуть панель (Ctrl+B)' : 'Свернуть панель (Ctrl+B)'"
        @click="toggleCollapsed"
      >
        <Icon :name="collapsed ? 'chevronsRight' : 'chevronsLeft'" :size="16" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 240px;
  flex: none;
  transition: width 0.18s ease;
  display: flex;
  flex-direction: column;
  padding: 14px 10px 10px;
  min-height: 0;
}
.new {
  width: 100%;
  justify-content: flex-start;
  height: 38px;
  margin-bottom: 14px;
}
.new .kbd {
  margin-left: auto;
  border-color: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.75);
}
.nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 11px;
  height: 34px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--text-2);
  text-align: left;
  width: 100%;
  transition: background 0.1s, color 0.1s;
}
.nav-item:hover {
  background: var(--hover);
  color: var(--text);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--text);
}
.nav-item.active :deep(.icon) {
  color: var(--accent-text);
}
.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.count.hot {
  color: var(--danger);
  font-weight: 600;
}
.section {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 20px 4px 4px 10px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  color: var(--muted);
  font-weight: 600;
}
.icon-btn.small {
  width: 24px;
  height: 24px;
}
.tags {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tag {
  cursor: pointer;
}
.tag .dot {
  margin: 0 4px;
}
.more {
  display: none;
  width: 22px;
  height: 22px;
  margin-right: -4px;
  border-radius: 6px;
  color: var(--muted);
  place-items: center;
}
.more:hover {
  background: var(--hover);
  color: var(--text);
}
.tag:hover .more,
.tag.menu .more {
  display: grid;
}
.tag:hover .count,
.tag.menu .count {
  display: none;
}
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
}
.tag-menu {
  position: fixed;
  z-index: 61;
  width: 210px;
  padding: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow);
}
.colors {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 8px 8px 10px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.swatch {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  justify-self: center;
}
.swatch.on {
  box-shadow: 0 0 0 2px var(--surface-2), 0 0 0 4px var(--text);
}
.mi {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 7px;
  color: var(--text-2);
  text-align: left;
}
.mi:hover {
  background: var(--hover);
  color: var(--text);
}
.mi.danger:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.tag-add {
  padding: 4px 2px;
}
.tag-add .input {
  height: 30px;
}
.empty {
  font-size: 12px;
  color: var(--muted);
  margin: 4px 10px;
  line-height: 1.5;
}
.bottom {
  border-top: 1px solid var(--border);
  padding-top: 8px;
  margin-top: 8px;
}

/* ---------- кнопка сворачивания ---------- */
.bottom {
  display: flex;
  align-items: center;
  gap: 4px;
}
.bottom .nav-item {
  flex: 1;
  min-width: 0;
}
.collapse {
  flex: none;
}

/* ---------- свёрнутая панель: только иконки ---------- */
.sidebar.collapsed {
  width: 60px;
  padding: 14px 8px 10px;
}
.collapsed .new {
  padding: 0;
  justify-content: center;
}
.collapsed .new-label,
.collapsed .new .kbd,
.collapsed .label,
.collapsed .section span,
.collapsed .empty,
.collapsed .more {
  display: none;
}
.collapsed .nav-item {
  justify-content: center;
  padding: 0;
  position: relative;
}
.collapsed .count {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  background: var(--surface-3);
  color: var(--text-2);
}
.collapsed .count.hot {
  background: var(--danger);
  color: #fff;
}
.collapsed .tag .count {
  display: none;
}
.collapsed .section {
  justify-content: center;
  margin: 16px 0 4px;
}
.collapsed .tag .dot {
  width: 10px;
  height: 10px;
  margin: 0;
}
.collapsed .bottom {
  flex-direction: column;
}
.collapsed .bottom .nav-item {
  width: 100%;
  flex: none;
}
</style>
