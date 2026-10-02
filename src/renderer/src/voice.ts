/**
 * Запись голоса с микрофона и подготовка WAV 16 кГц моно (формат, который ждёт Gemma 4).
 * Всё происходит локально: звук не покидает компьютер, кроме передачи в локальную Ollama.
 */

export const MAX_SECONDS = 30

export interface Recording {
  /** остановить и получить WAV в base64 */
  stop(): Promise<string>
  /** прервать без результата */
  cancel(): void
  /** уровень громкости 0..1 для индикатора */
  level(): number
}

export async function startRecording(): Promise<Recording> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
  } catch {
    throw new Error('Нет доступа к микрофону. Проверьте «Параметры Windows → Конфиденциальность → Микрофон».')
  }

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  recorder.start(250)

  // индикатор громкости
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Uint8Array(analyser.fftSize)

  const release = (): void => {
    stream.getTracks().forEach((t) => t.stop())
    ctx.close().catch(() => undefined)
  }

  return {
    level() {
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128)
      return Math.min(1, peak * 1.8)
    },
    cancel() {
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
    stop() {
      return new Promise<string>((resolve, reject) => {
        recorder.onstop = async () => {
          release()
          try {
            const blob = new Blob(chunks, { type: recorder.mimeType })
            resolve(await toWavBase64(blob))
          } catch (e) {
            reject(e)
          }
        }
        if (recorder.state !== 'inactive') recorder.stop()
        else recorder.onstop?.(new Event('stop'))
      })
    }
  }
}

async function toWavBase64(blob: Blob): Promise<string> {
  const data = await blob.arrayBuffer()
  if (!data.byteLength) throw new Error('Запись пустая')
  const decodeCtx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeCtx.decodeAudioData(data)
  } finally {
    decodeCtx.close().catch(() => undefined)
  }
  const seconds = Math.min(decoded.duration, MAX_SECONDS)
  if (seconds < 0.4) throw new Error('Слишком короткая запись')

  // пересэмплирование в 16 кГц моно
  const rate = 16000
  const offline = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  const pcm = rendered.getChannelData(0)

  // нормализация громкости — тихая речь распознаётся хуже
  let peak = 0
  for (const v of pcm) peak = Math.max(peak, Math.abs(v))
  const gain = peak > 0 && peak < 0.5 ? 0.9 / peak : 1

  const wav = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(wav)
  const str = (o: number, s: string): void => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // моно
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  str(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] * gain))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }

  // base64 порциями, чтобы не упереться в лимит аргументов
  const bytes = new Uint8Array(wav)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
