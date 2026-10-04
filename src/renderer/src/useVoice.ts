import { onUnmounted, ref } from 'vue'
import { api, toast } from './store'
import { MAX_SECONDS, startRecording, type Recording } from './voice'

/**
 * Голосовой ввод для полей: запись с индикатором громкости → расшифровка локальной моделью → onText(текст).
 * Таймер работает только во время записи. cancel() прерывает запись и отбрасывает ещё не готовую расшифровку.
 */
export function useVoice(onText: (text: string) => void | Promise<void>) {
  const recording = ref(false)
  const seconds = ref(0)
  const level = ref(0)
  const transcribing = ref(false)
  let rec: Recording | null = null
  let timer: number | undefined
  let started = 0
  /** номер попытки: результат отменённой записи/расшифровки игнорируется */
  let gen = 0

  async function start(): Promise<void> {
    if (rec || recording.value || transcribing.value) return
    const my = ++gen
    let r: Recording
    try {
      r = await startRecording()
    } catch (e) {
      if (my === gen) toast(e instanceof Error ? e.message : String(e), undefined, 7000)
      return
    }
    if (my !== gen) {
      r.cancel()
      return
    }
    rec = r
    recording.value = true
    started = Date.now()
    seconds.value = 0
    timer = window.setInterval(() => {
      seconds.value = Math.floor((Date.now() - started) / 1000)
      level.value = rec?.level() ?? 0
      if (seconds.value >= MAX_SECONDS) void finish()
    }, 100)
  }

  function stopTimer(): void {
    clearInterval(timer)
    timer = undefined
    level.value = 0
  }

  function cancel(): void {
    gen++
    stopTimer()
    rec?.cancel()
    rec = null
    recording.value = false
    transcribing.value = false
  }

  async function finish(): Promise<void> {
    const r = rec
    if (!r) return
    stopTimer()
    rec = null
    recording.value = false
    transcribing.value = true
    const my = gen
    let text = ''
    try {
      const wav = await r.stop()
      const res = await api.aiTranscribe(wav)
      if (my !== gen) return
      if (!res.ok) {
        toast(res.error, undefined, 7000)
        return
      }
      text = res.data
    } catch (e) {
      if (my === gen) toast(e instanceof Error ? e.message : String(e), undefined, 6000)
      return
    } finally {
      if (my === gen) transcribing.value = false
    }
    if (text) await onText(text)
  }

  function toggle(): Promise<void> {
    return recording.value ? finish() : start()
  }

  // запись при уходе со страницы прерываем, а уже начатую расшифровку доводим до конца (как раньше в строке добавления)
  onUnmounted(() => {
    if (!transcribing.value) cancel()
  })

  return { recording, seconds, level, transcribing, toggle, finish, cancel }
}
