import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, session, shell, Tray } from 'electron'
import fs from 'fs'
import path from 'path'
import iconAsset from '../../resources/icon.png?asset&asarUnpack'
import trayAsset from '../../resources/tray.png?asset&asarUnpack'
import type { AppData, Item, Settings, Tag } from '@shared/types'
import { isRecurring } from '@shared/recurrence'
import { backupsDir, dailyBackup, dataFile, dedupeTags, exportable, getData, load, normalizeData, normalizeItem, save, setData } from './store'
import * as ai from './ai'
import type { AiResult } from '@shared/types'
import { markPastAsNotified, show as showNotification, startScheduler, tick } from './scheduler'

const APP_ID = 'com.ztrack.app'
const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
const launchedHidden = process.argv.includes('--hidden')

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// ---------- одна копия приложения ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
}

app.setAppUserModelId(APP_ID)
// русская локаль: формат дат дд.мм.гггг и 24-часовое время в полях ввода
app.commandLine.appendSwitch('lang', 'ru')
app.setName('zTrack')
// в режиме разработки — отдельная папка данных, чтобы эксперименты не трогали рабочие задачи
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'zTrack-dev'))

// ---------- тема ----------
const THEME_BG = { dark: '#0b0c10', light: '#e6e8ee' }
const THEME_FG = { dark: '#e6e8ef', light: '#1b1e27' }

function effectiveTheme(): 'dark' | 'light' {
  const t = getData().settings.theme
  if (t === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return t
}

function applyTheme(): void {
  const s = getData().settings.theme
  nativeTheme.themeSource = s
  const t = effectiveTheme()
  if (win && !win.isDestroyed()) {
    win.setBackgroundColor(THEME_BG[t])
    try {
      win.setTitleBarOverlay({ color: THEME_BG[t], symbolColor: THEME_FG[t], height: 40 })
    } catch {
      /* не поддерживается на этой платформе */
    }
  }
}

// ---------- окно ----------
function createWindow(showOnReady: boolean): void {
  const t = effectiveTheme()
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 920,
    minHeight: 600,
    show: false,
    title: 'zTrack',
    icon: iconAsset,
    backgroundColor: THEME_BG[t],
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: THEME_BG[t], symbolColor: THEME_FG[t], height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => {
    if (showOnReady) win?.show()
  })

  win.on('close', (e) => {
    if (!quitting && getData().settings.closeToTray) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })

  // внешние ссылки — в браузере
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(isDev && url.startsWith(process.env['ELECTRON_RENDERER_URL']!))) {
      e.preventDefault()
    }
  })
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win?.webContents.toggleDevTools()
  })

  if (isDev) win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow(true)
  else {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

// ---------- трей ----------
function buildTrayMenu(): void {
  if (!tray) return
  const s = getData().settings
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Открыть zTrack', click: showWindow },
      {
        label: 'Новая задача',
        click: () => {
          showWindow()
          win?.webContents.send('new-item')
        }
      },
      { type: 'separator' },
      {
        label: 'Уведомления',
        type: 'checkbox',
        checked: s.notifications,
        click: (mi) => updateSettings({ notifications: mi.checked })
      },
      {
        label: 'Запускать вместе с Windows',
        type: 'checkbox',
        checked: s.launchAtStartup,
        enabled: app.isPackaged,
        click: (mi) => updateSettings({ launchAtStartup: mi.checked })
      },
      { type: 'separator' },
      {
        label: 'Выход',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  const img = nativeImage.createFromPath(trayAsset)
  tray = new Tray(img.isEmpty() ? nativeImage.createFromPath(iconAsset) : img)
  tray.setToolTip('zTrack')
  tray.on('click', () => {
    if (win && win.isVisible() && win.isFocused()) win.hide()
    else showWindow()
  })
  buildTrayMenu()
}

// ---------- автозапуск ----------
function applyLoginItem(): void {
  if (!app.isPackaged) return // в режиме разработки не регистрируем electron.exe
  const s = getData().settings
  // для portable-версии нужен путь к исходному .exe, а не к распакованной копии
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
  app.setLoginItemSettings({
    openAtLogin: s.launchAtStartup,
    path: exe,
    args: ['--hidden']
  })
}

// ---------- синхронизация с интерфейсом ----------
function broadcast(): void {
  if (win && !win.isDestroyed()) win.webContents.send('data-changed', getData())
}

function commit(): void {
  save()
  broadcast()
}

function updateSettings(patch: Partial<Settings>): void {
  const data = getData()
  const prev = data.settings
  data.settings = { ...prev, ...patch }
  commit()
  if (patch.theme !== undefined) applyTheme()
  if (patch.launchAtStartup !== undefined) applyLoginItem()
  buildTrayMenu()
}

function findItem(id: string): Item | undefined {
  return getData().items.find((i) => i.id === id)
}

function registerIpc(): void {
  ipcMain.handle('data:get', () => getData())

  ipcMain.handle('item:upsert', (_e, raw: Item) => {
    const item = normalizeItem(raw)
    if (!item) return
    item.updatedAt = new Date().toISOString()
    const data = getData()
    const idx = data.items.findIndex((i) => i.id === item.id)
    if (idx >= 0) data.items[idx] = item
    else data.items.push(item)
    markPastAsNotified(item)
    commit()
    setTimeout(tick, 500)
  })

  ipcMain.handle('item:restore', (_e, raw: Item) => {
    const item = normalizeItem(raw)
    if (!item) return
    const data = getData()
    if (!data.items.some((i) => i.id === item.id)) data.items.push(item)
    commit()
  })

  ipcMain.handle('item:delete', (_e, id: string) => {
    const data = getData()
    data.items = data.items.filter((i) => i.id !== id)
    commit()
  })

  ipcMain.handle('item:toggle', (_e, id: string, date: string | null, done: boolean) => {
    const item = findItem(id)
    if (!item) return
    if (isRecurring(item) && date) {
      const set = new Set(item.completedDates)
      if (done) set.add(date)
      else set.delete(date)
      item.completedDates = [...set].sort()
    } else {
      item.done = done
      item.doneAt = done ? new Date().toISOString() : null
    }
    item.updatedAt = new Date().toISOString()
    commit()
  })

  ipcMain.handle('item:exclude', (_e, id: string, date: string) => {
    const item = findItem(id)
    if (!item) return
    if (!item.excludedDates.includes(date)) item.excludedDates.push(date)
    item.updatedAt = new Date().toISOString()
    commit()
  })

  ipcMain.handle('tag:upsert', (_e, tag: Tag): Tag | null => {
    const data = getData()
    const clean = { id: String(tag.id), name: String(tag.name).trim().slice(0, 40), color: String(tag.color) }
    if (!clean.name) return null
    // метка с таким названием уже есть — не создаём дубликат
    const same = data.tags.find((t) => t.name.toLowerCase() === clean.name.toLowerCase() && t.id !== clean.id)
    const idx = data.tags.findIndex((t) => t.id === clean.id)
    if (same) return idx >= 0 ? data.tags[idx] : same
    if (idx >= 0) data.tags[idx] = clean
    else data.tags.push(clean)
    commit()
    return clean
  })

  ipcMain.handle('tag:delete', (_e, id: string) => {
    const data = getData()
    data.tags = data.tags.filter((t) => t.id !== id)
    for (const i of data.items) i.tags = i.tags.filter((t) => t !== id)
    commit()
  })

  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => updateSettings(patch))

  ipcMain.handle('data:export', async () => {
    const d = new Date()
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const res = await dialog.showSaveDialog(win!, {
      title: 'Экспорт данных zTrack',
      defaultPath: path.join(app.getPath('documents'), `ztrack-backup-${stamp}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false }
    try {
      fs.writeFileSync(res.filePath, JSON.stringify(exportable(), null, 2), 'utf-8')
      return { ok: true, path: res.filePath }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
  })

  ipcMain.handle('data:import', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Импорт данных zTrack',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    let incoming: AppData
    try {
      const raw = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf-8'))
      if (!raw || !Array.isArray(raw.items)) throw new Error('Файл не похож на резервную копию zTrack')
      incoming = normalizeData(raw)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const choice = await dialog.showMessageBox(win!, {
      type: 'question',
      title: 'Импорт',
      message: `В файле: ${incoming.items.length} задач/событий, ${incoming.tags.length} меток.`,
      detail: 'Объединить с текущими данными или полностью заменить их? Перед импортом будет сделана резервная копия.',
      buttons: ['Объединить', 'Заменить', 'Отмена'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice.response === 2) return { ok: false }

    // страховочная копия перед импортом
    fs.mkdirSync(backupsDir(), { recursive: true })
    fs.writeFileSync(path.join(backupsDir(), `before-import-${Date.now()}.json`), JSON.stringify(exportable(), null, 2))

    const cur = getData()
    if (choice.response === 1) {
      setData({ ...incoming, settings: { ...incoming.settings }, notified: cur.notified })
    } else {
      const items = new Map(cur.items.map((i) => [i.id, i]))
      for (const i of incoming.items) {
        const ex = items.get(i.id)
        if (!ex || ex.updatedAt < i.updatedAt) items.set(i.id, i)
      }
      const tags = new Map(cur.tags.map((t) => [t.id, t]))
      for (const t of incoming.tags) if (!tags.has(t.id)) tags.set(t.id, t)
      setData({ ...cur, items: [...items.values()], tags: [...tags.values()] })
    }
    dedupeTags(getData())
    for (const i of getData().items) markPastAsNotified(i)
    save()
    applyTheme()
    applyLoginItem()
    buildTrayMenu()
    broadcast()
    return { ok: true, path: res.filePaths[0] }
  })

  // ---------- локальный ИИ ----------
  const wrap = <T>(fn: () => Promise<T>): Promise<AiResult<T>> =>
    fn().then(
      (data) => ({ ok: true as const, data }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) })
    )
  const guarded = <T>(fn: () => Promise<T>): Promise<AiResult<T>> =>
    getData().settings.aiEnabled ? wrap(fn) : Promise.resolve({ ok: false, error: 'Локальный ИИ выключен в настройках' })

  ipcMain.handle('ai:status', () => ai.status())
  ipcMain.handle('ai:pull', (_e, model: string) =>
    wrap(async () => {
      try {
        await ai.pull(String(model), (p) => win?.webContents.send('ai-pull-progress', p))
      } catch (e) {
        win?.webContents.send('ai-pull-progress', {
          model,
          status: 'error',
          completed: 0,
          total: 0,
          done: true,
          error: e instanceof Error ? e.message : String(e)
        })
        throw e
      }
      return true as const
    })
  )
  ipcMain.handle('ai:delete', (_e, model: string) =>
    wrap(async () => {
      await ai.deleteModel(String(model))
      return true as const
    })
  )
  ipcMain.handle('ai:cancel', () => ai.cancelAll())
  ipcMain.handle('ai:parse', (_e, text: string, ctx: string | null) => guarded(() => ai.parseTask(String(text), ctx ?? null)))
  ipcMain.handle('ai:breakdown', (_e, title: string, notes: string, existing: string[]) =>
    guarded(() => ai.breakdown(String(title), String(notes ?? ''), Array.isArray(existing) ? existing.map(String) : []))
  )
  ipcMain.handle('ai:plan-week', (_e, weekStart: string) => guarded(() => ai.planWeek(String(weekStart))))
  ipcMain.handle('ai:transcribe', (_e, wav: string) =>
    getData().settings.aiVoice ? guarded(() => ai.transcribe(String(wav))) : Promise.resolve({ ok: false, error: 'Голосовой ввод выключен в настройках' })
  )
  ipcMain.handle('ai:search', (_e, q: string) =>
    getData().settings.aiSemanticSearch ? guarded(() => ai.search(String(q))) : Promise.resolve({ ok: true, data: [] })
  )

  ipcMain.handle('data:open-folder', () => shell.showItemInFolder(dataFile()))
  ipcMain.handle('notify:test', () =>
    showNotification('zTrack', 'Уведомления работают. Так будут выглядеть напоминания о задачах и событиях.')
  )
  ipcMain.handle('app:version', () => app.getVersion())
}

// ---------- запуск ----------
app.whenReady().then(() => {
  load()
  dailyBackup()
  Menu.setApplicationMenu(null)
  registerIpc()

  // разрешения страницы: только микрофон (для голосового ввода) и запись в буфер обмена
  const allowed = (permission: string, mediaTypes?: string[]): boolean =>
    (permission === 'media' && (mediaTypes ?? ['audio']).every((t) => t === 'audio')) ||
    permission === 'clipboard-sanitized-write'
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb, details) =>
    cb(allowed(permission, (details as { mediaTypes?: string[] }).mediaTypes))
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write')

  const s = getData().settings
  const startHidden = launchedHidden && s.startMinimized
  createWindow(!startHidden)
  createTray()
  applyTheme()
  applyLoginItem()

  nativeTheme.on('updated', () => {
    if (getData().settings.theme === 'system') applyTheme()
  })

  startScheduler(iconAsset, (id) => {
    showWindow()
    win?.webContents.send('open-item', id)
  })
})

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // приложение продолжает жить в трее; выход — через меню трея
  if (!getData().settings.closeToTray) app.quit()
})
