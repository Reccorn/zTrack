<script setup lang="ts">
import { ref } from 'vue'
import Icon from './Icon.vue'
import { settings, ui } from '../store'

const input = ref<HTMLInputElement | null>(null)
let prevView = ui.view

function focusSearch(): void {
  input.value?.focus()
  input.value?.select()
}

function onInput(): void {
  // при поиске из календаря/настроек переключаемся на список «Все»
  if (ui.search && (ui.view === 'calendar' || ui.view === 'settings')) {
    prevView = ui.view
    ui.view = 'all'
  }
}

function clear(): void {
  ui.search = ''
  if (prevView === 'calendar' || prevView === 'settings') {
    ui.view = prevView
    prevView = 'today'
  }
  input.value?.blur()
}

defineExpose({ focusSearch })
</script>

<template>
  <header class="titlebar" :class="{ collapsed: settings.sidebarCollapsed }">
    <div class="brand">
      <span class="logo">z</span>
      <span class="name">zTrack</span>
    </div>
    <div class="search" :class="{ filled: ui.search }">
      <Icon name="search" :size="15" />
      <input
        ref="input"
        v-model="ui.search"
        placeholder="Поиск задач и событий"
        spellcheck="false"
        @input="onInput"
        @keydown.esc="clear"
      />
      <button v-if="ui.search" class="clear" @click="clear" title="Очистить">
        <Icon name="x" :size="14" />
      </button>
      <span v-else class="kbd">Ctrl F</span>
    </div>
    <div class="spacer" />
  </header>
</template>

<style scoped>
.titlebar {
  height: 40px;
  flex: none;
  display: grid;
  grid-template-columns: 248px 1fr 150px;
  align-items: center;
  -webkit-app-region: drag;
  background: var(--frame);
}
.titlebar.collapsed {
  grid-template-columns: 68px 1fr 150px;
}
.collapsed .name {
  display: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  padding-left: 16px;
}
.logo {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: linear-gradient(135deg, #7c5cff, #38bdf8);
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  display: grid;
  place-items: center;
  line-height: 1;
  padding-bottom: 2px;
}
.name {
  font-weight: 650;
  letter-spacing: 0.2px;
}
.search {
  -webkit-app-region: no-drag;
  justify-self: center;
  width: min(460px, 100%);
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 10px;
  border-radius: 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--muted);
  transition: border-color 0.12s;
}
.search:focus-within,
.search.filled {
  border-color: var(--accent);
}
.search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  min-width: 0;
}
.search input::placeholder {
  color: var(--muted);
}
.clear {
  color: var(--muted);
  display: grid;
  place-items: center;
}
.clear:hover {
  color: var(--text);
}
</style>
