<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { closeConfirm, confirmState } from '../store'

const box = ref<HTMLDivElement | null>(null)
watch(
  () => confirmState.open,
  async (o) => {
    if (!o) return
    await nextTick()
    const btns = box.value?.querySelectorAll<HTMLButtonElement>('.actions button')
    btns?.[btns.length - 1]?.focus()
  }
)
</script>

<template>
  <Transition name="fade">
    <div v-if="confirmState.open" class="overlay" @mousedown.self="closeConfirm(null)" @keydown.esc.stop="closeConfirm(null)">
      <div ref="box" class="box" role="alertdialog">
        <h3>{{ confirmState.title }}</h3>
        <p>{{ confirmState.message }}</p>
        <div class="actions">
          <button
            v-for="b in confirmState.buttons"
            :key="b.value"
            class="btn"
            :class="{ primary: b.kind === 'primary', 'danger solid': b.kind === 'danger', ghost: b.kind === 'ghost' }"
            @click="closeConfirm(b.value)"
          >
            {{ b.label }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 80;
  background: rgba(5, 7, 12, 0.5);
  display: grid;
  place-items: center;
}
.box {
  width: min(420px, 90vw);
  background: var(--surface);
  border-radius: 14px;
  padding: 20px;
  box-shadow: var(--shadow);
}
h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
p {
  margin: 0 0 18px;
  color: var(--text-2);
  line-height: 1.5;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
