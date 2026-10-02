export type ItemType = 'task' | 'event'
export type Priority = 0 | 1 | 2 | 3 // 0 — нет, 1 — низкий, 2 — средний, 3 — высокий
export type RepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ThemeMode = 'dark' | 'light' | 'system'

export interface Recurrence {
  freq: RepeatFreq
  /** каждые N дней/недель/месяцев/лет */
  interval: number
  /** дни недели для weekly: 0 — вс, 1 — пн … 6 — сб */
  weekdays: number[]
  /** дата окончания (включительно), YYYY-MM-DD */
  until: string | null
}

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Item {
  id: string
  type: ItemType
  title: string
  notes: string
  /** YYYY-MM-DD или null — задача без даты («Входящие») */
  date: string | null
  /** HH:mm или null — на весь день */
  time: string | null
  /** HH:mm — окончание (для событий) */
  endTime: string | null
  priority: Priority
  tags: string[]
  /** за сколько минут напомнить; null — без напоминания */
  reminder: number | null
  recurrence: Recurrence
  /** для неповторяющихся */
  done: boolean
  doneAt: string | null
  /** для повторяющихся: даты выполненных вхождений */
  completedDates: string[]
  /** для повторяющихся: удалённые вхождения */
  excludedDates: string[]
  /** чек-лист шагов */
  subtasks: Subtask[]
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  color: string
}

export interface Settings {
  theme: ThemeMode
  launchAtStartup: boolean
  startMinimized: boolean
  closeToTray: boolean
  notifications: boolean
  notificationSound: boolean
  defaultReminder: number | null
  weekStartsOn: 0 | 1
  showCompleted: boolean
  /** вид календаря, который открывается по умолчанию */
  calMode: 'month' | 'week'
  sidebarCollapsed: boolean
  /** локальный ИИ через Ollama */
  aiEnabled: boolean
  aiUrl: string
  aiModel: string
  aiEmbedModel: string
  /** через сколько минут простоя Ollama выгружает модель из памяти */
  aiKeepAlive: number
  aiSemanticSearch: boolean
  aiVoice: boolean
}

export interface AppData {
  version: number
  items: Item[]
  tags: Tag[]
  settings: Settings
  /** ключи уже показанных уведомлений */
  notified: Record<string, number>
}

/** Конкретное вхождение задачи на дату (для повторяющихся — виртуальное) */
export interface Occurrence {
  item: Item
  date: string | null
  done: boolean
  key: string
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  launchAtStartup: false,
  startMinimized: false,
  closeToTray: true,
  notifications: true,
  notificationSound: true,
  defaultReminder: 0,
  weekStartsOn: 1,
  showCompleted: true,
  calMode: 'week',
  sidebarCollapsed: false,
  aiEnabled: true,
  aiUrl: 'http://127.0.0.1:11434',
  aiModel: 'gemma4:e2b-it-qat',
  aiEmbedModel: 'embeddinggemma',
  aiKeepAlive: 5,
  aiSemanticSearch: true,
  aiVoice: true
}

export const NO_REPEAT: Recurrence = { freq: 'none', interval: 1, weekdays: [], until: null }

export function emptyData(): AppData {
  return { version: 1, items: [], tags: [], settings: { ...DEFAULT_SETTINGS }, notified: {} }
}

export interface ExportResult {
  ok: boolean
  path?: string
  error?: string
}

// ---------- локальный ИИ ----------

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AiModelInfo {
  name: string
  size: number
  modifiedAt: string
}

export interface AiStatus {
  running: boolean
  version: string | null
  models: AiModelInfo[]
  hasModel: boolean
  hasEmbedModel: boolean
  error: string | null
}

/** Черновик задачи, разобранной ИИ (до подтверждения пользователем) */
export interface AiDraft {
  item: Partial<Item>
  /** метки, которых ещё нет, — предлагаются пользователю */
  newTags: string[]
}

export interface AiWeekSuggestion {
  kind: 'move' | 'tip'
  text: string
  itemId?: string
  title?: string
  fromDate?: string
  toDate?: string
}

export interface AiWeekPlan {
  summary: string
  suggestions: AiWeekSuggestion[]
}

export interface AiSearchHit {
  id: string
  score: number
}

export interface AiPullProgress {
  model: string
  status: string
  completed: number
  total: number
  done: boolean
  error?: string
}

export interface ZApi {
  getData(): Promise<AppData>
  upsertItem(item: Item): Promise<void>
  deleteItem(id: string): Promise<void>
  restoreItem(item: Item): Promise<void>
  toggleOccurrence(id: string, date: string | null, done: boolean): Promise<void>
  excludeOccurrence(id: string, date: string): Promise<void>
  /** возвращает сохранённую метку (или уже существующую с таким же названием) */
  upsertTag(tag: Tag): Promise<Tag | null>
  deleteTag(id: string): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  exportData(): Promise<ExportResult>
  importData(): Promise<ExportResult>
  openDataFolder(): Promise<void>
  testNotification(): Promise<void>
  getVersion(): Promise<string>
  onDataChanged(cb: (data: AppData) => void): () => void
  aiStatus(): Promise<AiStatus>
  aiPull(model: string): Promise<AiResult<true>>
  aiDeleteModel(model: string): Promise<AiResult<true>>
  aiCancel(): Promise<void>
  aiParseTask(text: string, contextDate: string | null): Promise<AiResult<AiDraft>>
  aiBreakdown(title: string, notes: string, existing: string[]): Promise<AiResult<string[]>>
  aiPlanWeek(weekStart: string): Promise<AiResult<AiWeekPlan>>
  aiSearch(query: string): Promise<AiResult<AiSearchHit[]>>
  /** расшифровка речи: WAV 16 кГц моно в base64 */
  aiTranscribe(wavBase64: string): Promise<AiResult<string>>
  onAiPullProgress(cb: (p: AiPullProgress) => void): () => void
  onOpenItem(cb: (id: string) => void): () => void
  onNewItem(cb: () => void): () => void
}
