<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import TitleBar from './components/TitleBar.vue'
import Sidebar from './components/Sidebar.vue'
import EditorModal from './components/EditorModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import Toasts from './components/Toasts.vue'
import ListView from './views/ListView.vue'
import CalendarView from './views/CalendarView.vue'
import SettingsView from './views/SettingsView.vue'
import { api, confirmState, editor, init, openById, openNew, state, ui } from './store'

const titleBar = ref<InstanceType<typeof TitleBar> | null>(null)
const offs: (() => void)[] = []

function onKey(e: KeyboardEvent): void {
  const ctrl = e.ctrlKey || e.metaKey
  if (ctrl && (e.key === 'n' || e.key === 'т' || e.code === 'KeyN')) {
    e.preventDefault()
    if (!editor.open) openNew()
  } else if (ctrl && e.code === 'KeyB') {
    e.preventDefault()
    api.updateSettings({ sidebarCollapsed: !state.data.settings.sidebarCollapsed })
  } else if (ctrl && (e.code === 'KeyF')) {
    e.preventDefault()
    titleBar.value?.focusSearch()
  } else if (!editor.open && !confirmState.open && e.altKey && /^Digit[1-6]$/.test(e.code)) {
    const views = ['today', 'calendar', 'upcoming', 'inbox', 'all', 'done'] as const
    ui.view = views[Number(e.code.slice(5)) - 1]
    e.preventDefault()
  }
}

onMounted(async () => {
  await init()
  offs.push(api.onOpenItem((id) => openById(id)))
  offs.push(api.onNewItem(() => openNew()))
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  offs.forEach((f) => f())
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="app" v-if="state.loaded">
    <TitleBar ref="titleBar" />
    <div class="body">
      <Sidebar />
      <main class="main" :class="ui.view === 'calendar' ? 'bare' : 'island'">
        <CalendarView v-if="ui.view === 'calendar'" />
        <SettingsView v-else-if="ui.view === 'settings'" />
        <ListView v-else />
      </main>
    </div>
    <EditorModal />
    <ConfirmDialog />
    <Toasts />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  display: flex;
  gap: 8px;
  padding: 0 8px 8px;
  min-height: 0;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.main.bare {
  background: transparent;
}
</style>
