<script setup lang="ts">
import Icon from './Icon.vue'
import { dismissToast, toasts } from '../store'
</script>

<template>
  <div class="toasts">
    <TransitionGroup name="pop">
      <div v-for="t in toasts" :key="t.id" class="toast">
        <span class="text">{{ t.text }}</span>
        <button
          v-if="t.action"
          class="action"
          @click="
            t.action.run();
            dismissToast(t.id)
          "
        >
          {{ t.action.label }}
        </button>
        <button class="close" @click="dismissToast(t.id)"><Icon name="x" :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  z-index: 100;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 42px;
  padding: 8px 8px 8px 16px;
  border-radius: 11px;
  background: var(--surface-3);
  border: 1px solid var(--border-strong);
  box-shadow: var(--shadow);
  max-width: 520px;
}
.text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.action {
  color: var(--accent-text);
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}
.action:hover {
  background: var(--accent-soft);
}
.close {
  color: var(--muted);
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
}
.close:hover {
  background: var(--hover);
  color: var(--text);
}
</style>
