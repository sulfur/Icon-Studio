import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import {
  createWatch,
  deleteIcon,
  deleteWatch,
  exportSettings,
  fetchServiceStatus,
  fetchState,
  pickDirectory,
  rescanWatch,
  restartService,
  startService,
  stopService,
  updateSettings,
  updateWatch,
  uploadIcon,
} from './api'
import type { ServiceStatus } from './api'
import type {
  ActivityEvent,
  AppState,
  AppSettings,
  IconRecord,
  WatchFormRule,
  WatchFormValues,
  WatchRecord,
} from './types'

const POLL_INTERVAL = 3500

type Notice = { kind: 'success' | 'error' | 'info'; message: string }

function emptyForm(): WatchFormValues {
  return {
    name: '',
    directoryPath: '',
    defaultIconId: '',
    recursive: true,
    enabled: true,
    rules: [],
  }
}

function newRule(): WatchFormRule {
  return { id: crypto.randomUUID(), keyword: '', iconId: '' }
}

function watchToForm(watch: WatchRecord): WatchFormValues {
  return {
    name: watch.name,
    directoryPath: watch.directoryPath,
    defaultIconId: watch.defaultIconId || '',
    recursive: watch.recursive,
    enabled: watch.enabled,
    rules: watch.rules.map((rule) => ({
      id: rule.id,
      keyword: rule.keyword,
      iconId: rule.iconId || '',
    })),
  }
}

function eventLabel(level: ActivityEvent['level']) {
  return {
    success: 'Applied',
    warning: 'Skipped',
    error: 'Error',
    info: 'Info',
  }[level]
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(value))
}

function runtimeMessage(state: AppState | null, watchId: string) {
  return state?.runtime.watchers.find((entry) => entry.id === watchId)?.message || 'No runtime data'
}

const Icons = {
  Plus: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>,
  Play: <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>,
  Pause: <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>,
  Refresh: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Edit: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.89 1.14l-2.81.936c-.47.157-.93-.304-.774-.775l.935-2.81a4.5 4.5 0 011.14-1.89L16.862 4.487zm0 0L19.5 7.125" /></svg>,
  Trash: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>,
  Folder: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" /></svg>,
  Grid: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.75 4.75h5.5v5.5h-5.5zm9 0h5.5v5.5h-5.5zm-9 9h5.5v5.5h-5.5zm9 0h5.5v5.5h-5.5z" /></svg>,
  Library: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 5.25A2.25 2.25 0 018.25 3h7.5A2.25 2.25 0 0118 5.25v13.5A2.25 2.25 0 0115.75 21h-7.5A2.25 2.25 0 016 18.75V5.25z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25h6m-6 3.75h6m-6 3.75h3.75" /></svg>,
  ArrowLeft: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>,
  ArrowRight: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>,
  Close: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  Check: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>,
  Upload: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>,
  Gear: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  Document: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>,
  Activity: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
  Power: <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" /></svg>,
  Restart: <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path strokeLinecap="round" strokeLinejoin="round" d="M3 3v5h5" /></svg>,
  Stop: <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  MinimizeWindow: <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 5.5h8" stroke="currentColor" strokeWidth="1" strokeLinecap="square" shapeRendering="crispEdges" /></svg>,
  MaximizeWindow: <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1" shapeRendering="crispEdges" /></svg>,
  RestoreWindow: <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M3 1.5h5.5V7" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" shapeRendering="crispEdges" /><path d="M1.5 3H7v5.5H1.5z" stroke="currentColor" strokeWidth="1" strokeLinejoin="miter" shapeRendering="crispEdges" /></svg>,
  CloseWindow: <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1" strokeLinecap="square" shapeRendering="crispEdges" /></svg>,
}

export default function App() {
  const isDesktopShell = Boolean(window.iconStudioDesktop?.isDesktop)
  type NumericSettingKey = 'pollingIntervalSeconds' | 'logRetentionDays'
  const [windowMaximized, setWindowMaximized] = useState(false)
  const [state, setState] = useState<AppState | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [currentView, setCurrentView] = useState<'dashboard' | 'monitors' | 'library' | 'activity' | 'settings'>('dashboard')
  const [settingsTab, setSettingsTab] = useState<'system' | 'monitoring' | 'maintenance' | 'service'>('system')
  const [settingsDraft, setSettingsDraft] = useState<AppSettings | null>(null)
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null)
  const [serviceStatusLoading, setServiceStatusLoading] = useState(false)

  // True when the draft differs from what is saved in state
  const dirtySettings = useMemo(() => {
    if (!settingsDraft || !state?.settings) return false
    return JSON.stringify(settingsDraft) !== JSON.stringify(state.settings)
  }, [settingsDraft, state?.settings])

  const [editingId, setEditingId] = useState<string | null>(null)
  const [isWizardOpen, setIsWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1) // 1: Directory, 2: Rules, 3: Review

  const [watchForm, setWatchForm] = useState<WatchFormValues>(emptyForm)
  const [iconName, setIconName] = useState('')
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [editingNumericSetting, setEditingNumericSetting] = useState<NumericSettingKey | null>(null)
  const [editingNumericValue, setEditingNumericValue] = useState('')

  // Update a single key in the local draft only (does NOT touch AppState)
  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettingsDraft(d => ({
      ...(d ?? state!.settings),
      [key]: value,
    }))
  }

  const startNumericEdit = (key: NumericSettingKey, fallback: number) => {
    setEditingNumericSetting(key)
    setEditingNumericValue(String(settingsDraft?.[key] ?? fallback))
  }

  const cancelNumericEdit = () => {
    setEditingNumericSetting(null)
    setEditingNumericValue('')
  }

  const commitNumericEdit = (key: NumericSettingKey, min: number, max: number, fallback: number) => {
    const parsed = Number.parseInt(editingNumericValue, 10)
    const nextValue = Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : (settingsDraft?.[key] ?? fallback)

    updateSetting(key, nextValue)
    cancelNumericEdit()
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) setIconFile(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }

  useEffect(() => {
    let alive = true

    const load = async (silent = false) => {
      try {
        if (!silent) {
          setLoading(true)
        }

        const next = await fetchState()
        if (alive) {
          setState(next)
          // Only sync the draft from server when there are no pending changes
          setSettingsDraft(d => {
            if (!d) return next.settings
            const currentDraft = d
            // If draft matches current saved settings, update from server; otherwise keep draft
            return JSON.stringify(currentDraft) === JSON.stringify(next.settings)
              ? next.settings
              : currentDraft
          })
        }
      } catch (error) {
        if (alive) {
          setNotice({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Failed to read state.',
          })
        }
      } finally {
        if (alive && !silent) {
          setLoading(false)
        }
      }
    }

    void load()
    const timer = window.setInterval(() => void load(true), POLL_INTERVAL)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!notice) {
      return undefined
    }

    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!window.iconStudioDesktop?.onNavigate) {
      return undefined
    }

    return window.iconStudioDesktop.onNavigate((payload) => {
      if (payload.view) {
        setCurrentView(payload.view)
      }

      if (payload.settingsTab) {
        setSettingsTab(payload.settingsTab)
      }
    })
  }, [])

  useEffect(() => {
    if (!window.iconStudioDesktop) {
      return undefined
    }

    void window.iconStudioDesktop.getWindowState().then((payload) => {
      setWindowMaximized(Boolean(payload?.maximized))
    })

    return window.iconStudioDesktop.onWindowState((payload) => {
      setWindowMaximized(Boolean(payload.maximized))
    })
  }, [])

  useEffect(() => {
    if (!isDesktopShell) {
      return
    }

    void loadServiceStatus()
  }, [isDesktopShell])

  const applyState = (next: AppState, message: string) => {
    setState(next)
    setNotice({ kind: 'success', message })
  }

  const saveSettings = async () => {
    if (!settingsDraft) return
    // Validate minimum values
    const payload: AppSettings = {
      ...settingsDraft,
      pollingIntervalSeconds: Math.max(1, settingsDraft.pollingIntervalSeconds),
      logRetentionDays: Math.max(1, settingsDraft.logRetentionDays),
    }
    setBusy('settings:save')
    try {
      const saved = await updateSettings(payload)
      // Sync AppState and reset the draft to match the saved version
      setState(s => s ? { ...s, settings: saved } : s)
      setSettingsDraft(saved)
      setNotice({ kind: 'success', message: 'Settings saved.' })
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to save settings.',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleExportSettings = async () => {
    setBusy('settings:export')
    try {
      await exportSettings()
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Export failed.',
      })
    } finally {
      setBusy(null)
    }
  }

  const loadServiceStatus = async () => {
    setServiceStatusLoading(true)
    try {
      const status = await fetchServiceStatus()
      setServiceStatus(status)
    } catch {
      setServiceStatus({ running: false })
    } finally {
      setServiceStatusLoading(false)
    }
  }

  const handleStartService = async () => {
    setBusy('service:start')
    try {
      const status = await startService()
      setServiceStatus(status)
      setNotice({ kind: 'success', message: 'Service started.' })
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to start service.' })
    } finally {
      setBusy(null)
    }
  }

  const handleRestartService = async () => {
    setBusy('service:restart')
    try {
      const status = await restartService()
      setServiceStatus(status)
      setNotice({ kind: 'success', message: 'Service restarted.' })
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to restart service.' })
    } finally {
      setBusy(null)
    }
  }

  const handleStopService = async () => {
    setBusy('service:stop')
    try {
      const status = await stopService()
      setServiceStatus(status)
      setNotice({ kind: 'success', message: 'Service stopped.' })
    } catch (error) {
      setNotice({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to stop service.' })
    } finally {
      setBusy(null)
    }
  }
  const availableIcons = state?.icons || []

  const openLibraryForIconSelection = () => {
    setCurrentView('library')
  }

  const renderIconPicker = ({
    label,
    value,
    onChange,
    allowEmpty = false,
    emptyLabel = 'No icon',
  }: {
    label: string
    value: string
    onChange: (next: string) => void
    allowEmpty?: boolean
    emptyLabel?: string
  }) => (
    <div className="field icon-picker-field">
      <div className="icon-picker-header">
        <label>{label}</label>
        <button
          type="button"
          className="ghost-button small icon-only"
          title="Add icon"
          onClick={openLibraryForIconSelection}
        >
          {Icons.Plus}
        </button>
      </div>
      <div className="icon-selector-grid">
        {allowEmpty && (
          <button
            type="button"
            className={`icon-selector-card icon-selector-card--empty ${!value ? 'active' : ''}`}
            onClick={() => onChange('')}
          >
            <span className="icon-selector-preview icon-selector-preview--placeholder">{Icons.Folder}</span>
            <span className="icon-selector-label">{emptyLabel}</span>
          </button>
        )}

        {availableIcons.map((icon) => (
          <button
            type="button"
            key={icon.id}
            className={`icon-selector-card ${value === icon.id ? 'active' : ''}`}
            onClick={() => onChange(icon.id)}
            title={icon.name}
          >
            <span className="icon-selector-preview">
              <img src={icon.previewUrl} alt={icon.name} />
            </span>
            <span className="icon-selector-label">{icon.name}</span>
          </button>
        ))}

        <button
          type="button"
          className="icon-selector-card icon-selector-card--add"
          onClick={openLibraryForIconSelection}
          title="Add new icon"
        >
          <span className="icon-selector-preview icon-selector-preview--placeholder">{Icons.Plus}</span>
          <span className="icon-selector-label">Add new icon</span>
        </button>
      </div>
    </div>
  )

  const renderEditableSliderValue = ({
    settingKey,
    value,
    min,
    max,
    suffix,
  }: {
    settingKey: NumericSettingKey
    value: number
    min: number
    max: number
    suffix: string
  }) => {
    if (editingNumericSetting === settingKey) {
      return (
        <input
          type="number"
          className="slider-value-input"
          min={min}
          max={max}
          value={editingNumericValue}
          autoFocus
          onChange={(e) => setEditingNumericValue(e.target.value)}
          onBlur={() => commitNumericEdit(settingKey, min, max, value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitNumericEdit(settingKey, min, max, value)
            } else if (e.key === 'Escape') {
              cancelNumericEdit()
            }
          }}
        />
      )
    }

    return (
      <button
        type="button"
        className="slider-value slider-value-button"
        onClick={() => startNumericEdit(settingKey, value)}
        title="Click to edit"
      >
        {value} {suffix}
      </button>
    )
  }

  const setRuleValue = (ruleId: string, key: keyof WatchFormRule, value: string) => {
    setWatchForm((current) => ({
      ...current,
      rules: current.rules.map((rule) => (rule.id === ruleId ? { ...rule, [key]: value } : rule)),
    }))
  }

  const startCreate = () => {
    setEditingId(null)
    setWatchForm(emptyForm())
    setWizardStep(1)
    setIsWizardOpen(true)
  }

  const startEdit = (watch: WatchRecord) => {
    setEditingId(watch.id)
    setWatchForm(watchToForm(watch))
    setWizardStep(1)
    setIsWizardOpen(true)
  }

  const closeWizard = () => {
    setIsWizardOpen(false)
    setEditingId(null)
    setWatchForm(emptyForm())
    setWizardStep(1)
  }

  const goToNextWizardStep = () => {
    if (wizardStep === 1) {
      if (!watchForm.directoryPath) {
        setNotice({ kind: 'error', message: 'Select a folder to monitor before proceeding.' })
        return
      }
      setWizardStep(2)
    } else if (wizardStep === 2) {
      if (!watchForm.name) {
        const suggestedName = watchForm.directoryPath.split(/[\\/]/).filter(Boolean).pop() || 'New Folder'
        setWatchForm(c => ({ ...c, name: suggestedName }))
      }
      setWizardStep(3)
    }
  }

  const submitWatch = async () => {
    setBusy('watch')

    try {
      const next = editingId ? await updateWatch(editingId, watchForm) : await createWatch(watchForm)
      applyState(next, editingId ? 'Folder updated.' : 'Folder created.')
      closeWizard()
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to save folder.',
      })
    } finally {
      setBusy(null)
    }
  }

  const browseDirectory = async () => {
    setBusy('browse')

    try {
      const selectedPath = await pickDirectory()
      if (selectedPath) {
        setWatchForm((current) => ({
          ...current,
          directoryPath: selectedPath,
          name: current.name || selectedPath.split(/[\\/]/).filter(Boolean).pop() || current.name,
        }))
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Folder picker unavailable.',
      })
    } finally {
      setBusy(null)
    }
  }

  const submitIcon = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!iconFile) {
      setNotice({ kind: 'error', message: "Select an image or .ico file." })
      return
    }

    setBusy('icon')

    try {
      const next = await uploadIcon({ name: iconName, file: iconFile })
      applyState(next, 'Icon uploaded.')
      setIconName('')
      setIconFile(null)
      const input = document.querySelector<HTMLInputElement>('#icon-file')
      if (input) {
        input.value = ''
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to upload icon.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeIcon = async (icon: IconRecord) => {
    setBusy(`icon:${icon.id}`)

    try {
      applyState(await deleteIcon(icon.id), `Icon "${icon.name}" removed.`)
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : "Failed to remove icon.",
      })
    } finally {
      setBusy(null)
    }
  }

  const toggleWatch = async (watch: WatchRecord) => {
    setBusy(`toggle:${watch.id}`)

    try {
      applyState(
        await updateWatch(watch.id, { ...watchToForm(watch), enabled: !watch.enabled }),
        watch.enabled ? 'Folder disabled.' : 'Folder enabled.',
      )
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update folder.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeWatch = async (watch: WatchRecord) => {
    setBusy(`watch:${watch.id}`)

    try {
      applyState(await deleteWatch(watch.id), `Folder "${watch.name}" deleted.`)
      if (editingId === watch.id) {
        closeWizard()
      }
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to delete folder.',
      })
    } finally {
      setBusy(null)
    }
  }

  const scanWatch = async (watch: WatchRecord) => {
    setBusy(`scan:${watch.id}`)

    try {
      const next = await rescanWatch(watch.id)
      applyState(
        next,
        `Scan complete: ${next.summary.applied} applied, ${next.summary.skipped} skipped.`,
      )
    } catch (error) {
      setNotice({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Scan failed.',
      })
    } finally {
      setBusy(null)
    }
  }

  const handleMinimizeWindow = async () => {
    await window.iconStudioDesktop?.minimize?.()
  }

  const handleToggleWindowMaximize = async () => {
    const nextState = await window.iconStudioDesktop?.toggleMaximize?.()
    if (nextState) {
      setWindowMaximized(Boolean(nextState.maximized))
    }
  }

  const handleCloseWindow = async () => {
    await window.iconStudioDesktop?.closeWindow?.()
  }

  if (loading && !state) {
    return (
      <div className="shell-loading">
        <div className="shell-loading__spinner" aria-hidden="true" />
      </div>
    )
  }

  const activeCount = state?.runtime.activeCount || 0
  const iconCount = state?.icons.length || 0
  const keywordCount = state?.watches.reduce((sum, watch) => sum + watch.rules.length, 0) || 0

  return (
    <div className={`app-layout ${isDesktopShell ? 'desktop-mode' : ''}`}>
      {isDesktopShell && (
        <header className="desktop-titlebar">
          <div className="desktop-titlebar__left" aria-hidden="true">
            <div className="desktop-titlebar__brand">
              <img src="/favicon.png" alt="" className="desktop-titlebar__brand-icon" />
            </div>
          </div>

          <div className="desktop-titlebar__controls">
            <button type="button" className="desktop-window-control" aria-label="Minimize" onClick={handleMinimizeWindow}>
              {Icons.MinimizeWindow}
            </button>
            <button type="button" className="desktop-window-control" aria-label={windowMaximized ? 'Restore' : 'Maximize'} onClick={handleToggleWindowMaximize}>
              {windowMaximized ? Icons.RestoreWindow : Icons.MaximizeWindow}
            </button>
            <button type="button" className="desktop-window-control desktop-window-control--close" aria-label="Close" onClick={handleCloseWindow}>
              {Icons.CloseWindow}
            </button>
          </div>
        </header>
      )}
      {/* SIDEBAR */}
      <aside className="sidebar glass">
        <div className="sidebar-brand">
          <div className="brand-logo" style={{ background: 'transparent', boxShadow: 'none' }}>
            <img
              src="/favicon.png"
              alt="Icon Studio"
              style={{
                width: '114%',
                height: '114%',
                objectFit: 'contain',
                filter:
                  'contrast(1.06) brightness(1.03) drop-shadow(0 0 0.75px rgba(255, 255, 255, 0.82)) drop-shadow(0 2px 4px rgba(255, 255, 255, 0.1))',
              }}
            />
          </div>
          <div className="brand-text">Icon Studio</div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => setCurrentView('dashboard')}
          >
            <span className="icon">{Icons.Grid}</span>
            Dashboard
          </button>
          <button
            className={`nav-item ${currentView === 'monitors' ? 'active' : ''}`}
            onClick={() => setCurrentView('monitors')}
          >
            <span className="icon">{Icons.Folder}</span>
            Folders
            <span className="nav-badge">{state?.watches.length || 0}</span>
          </button>
          <button
            className={`nav-item ${currentView === 'library' ? 'active' : ''}`}
            onClick={() => setCurrentView('library')}
          >
            <span className="icon">{Icons.Library}</span>
            Icon Library
            <span className="nav-badge">{iconCount}</span>
          </button>
          <button
            className={`nav-item ${currentView === 'activity' ? 'active' : ''}`}
            onClick={() => setCurrentView('activity')}
          >
            <span className="icon">{Icons.Activity}</span>
            Activity
          </button>
        </nav>
        <div className="sidebar-footer">
          <button
            className={`nav-item ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => setCurrentView('settings')}
          >
            <span className="icon">{Icons.Gear}</span>
            Settings
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">
        <header className="main-header">
          {currentView !== 'settings' && (
            <div className="header-title">
              <h2>
                {currentView === 'dashboard' && 'Overview'}
                {currentView === 'monitors' && 'Folder Management'}
                {currentView === 'library' && 'Resource Library'}
                {currentView === 'activity' && 'Event Logs'}
              </h2>
            </div>
          )}
        </header>

        {notice && (
          <div className={`floating-toast ${notice.kind}`}>
            <span style={{ flex: 1 }}>{notice.message}</span>
            <button type="button" className="ghost-button icon-only small" title="Close" onClick={() => setNotice(null)} style={{ flexShrink: 0 }}>{Icons.Close}</button>
          </div>
        )}

        <div className="view-container">
          {/* DASHBOARD VIEW */}
          {currentView === 'dashboard' && (
            <div className="fade-in dashboard-layout">
              <section className="hero" style={{ position: 'relative' }}>
                <button className="button icon-only" title="New Folder" style={{ position: 'absolute', top: '40px', right: '48px', height: '56px', width: '56px', borderRadius: '50%', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 10 }} onClick={() => { setCurrentView('monitors'); startCreate(); }}>{Icons.Plus}</button>
                <div className="hero-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <span className="kicker" style={{ marginBottom: '16px' }}>Welcome</span>
                    <h1>Dynamic icons.</h1>
                    <p style={{ marginBottom: '24px' }}>Monitor multiple folders and apply multi-size .ico icons.</p>
                    <div className="hero-meta">
                      <div className="metric"><strong>{activeCount}</strong><span>active</span></div>
                      <div className="metric"><strong>{iconCount}</strong><span>icons</span></div>
                      <div className="metric"><strong>{keywordCount}</strong><span>rules</span></div>
                    </div>
                  </div>
                </div>
              </section>

              <div className="dashboard-bottom-panels">
                <section className="panel summary-panel">
                  <div className="panel-header">
                    <h3 className="panel-title" style={{ margin: 0 }}>Recent Folders</h3>
                    <button className="ghost-button small icon-only" title="Manage" onClick={() => setCurrentView('monitors')}>{Icons.Gear}</button>
                  </div>
                  {state?.watches.length ? (
                    <div className="scrollable-list">
                      {state.watches.slice(0, 5).map(watch => {
                        const defaultIcon = state.icons.find(i => i.id === watch.defaultIconId)

                        return (
                          <div className="watch-card" key={watch.id} style={{ padding: '16px 20px', gap: '8px', flexDirection: 'row', alignItems: 'center' }}>
                            {defaultIcon ? (
                              <img src={defaultIcon.previewUrl} alt="icon" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, background: 'rgba(255,255,255,0.05)', padding: 4 }} />
                            ) : (
                              <div style={{ width: 36, height: 36, borderRadius: 6, background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                                <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                              </div>
                            )}
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                                <strong style={{ fontSize: '1.05rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{watch.name}</strong>
                                <span className={`pill ${watch.enabled ? 'success' : 'warning'}`}>{watch.enabled ? 'active' : 'paused'}</span>
                              </div>
                              <code style={{ fontSize: '0.8rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{watch.directoryPath}</code>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="empty" style={{ padding: '32px 0' }}>No folders configured.</div>
                  )}
                </section>

                <section className="panel summary-panel">
                  <div className="panel-header">
                    <h3 className="panel-title" style={{ margin: 0 }}>Recent Activity</h3>
                    <button className="ghost-button small icon-only" title="View Logs" onClick={() => setCurrentView('activity')}>{Icons.Document}</button>
                  </div>
                  {state?.events.length ? (
                    <div className="scrollable-list">
                      {state.events.slice(0, 10).map(entry => (
                        <div className="event-card" key={entry.id} style={{ padding: '16px', gap: '8px', boxShadow: 'none' }}>
                          <div className="event-meta" style={{ gap: '8px' }}>
                            <span className={`level ${entry.level}`}>{eventLabel(entry.level)}</span>
                            <span style={{ fontSize: '0.8rem' }}>{formatDate(entry.timestamp)}</span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: '1.5' }}>{entry.message}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty" style={{ padding: '32px 0' }}>No recent events in log.</div>
                  )}
                </section>
              </div>
            </div>
          )}

          {/* MONITORS VIEW */}
          {currentView === 'monitors' && (
            <div className="fade-in stack">
              {!isWizardOpen ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <p className="panel-subtitle">Manage observed folders and assignment rules.</p>
                    <button className="button icon-only" title="New Folder" onClick={startCreate}>{Icons.Plus}</button>
                  </div>

                  {state?.watches.length ? (
                    <div className="watch-list">
                      {state.watches.map((watch) => {
                        const status = runtimeMessage(state, watch.id)
                        const defaultIcon = state.icons.find((icon) => icon.id === watch.defaultIconId)
                        return (
                          <article className="watch-card" key={watch.id}>
                            <div className="watch-head">
                              <div className="watch-head-main">
                                <div className={`watch-icon ${defaultIcon ? '' : 'watch-icon--empty'}`}>
                                  {defaultIcon ? (
                                    <img src={defaultIcon.previewUrl} alt={defaultIcon.name} />
                                  ) : (
                                    Icons.Folder
                                  )}
                                </div>
                                <div>
                                  <h3>{watch.name}</h3>
                                  <code>{watch.directoryPath}</code>
                                </div>
                              </div>
                              <div className="watch-tags">
                                <span className={`pill ${watch.enabled ? 'success' : 'warning'}`}>{watch.enabled ? 'active' : 'paused'}</span>
                                <span className={`pill ${status.includes('Error') ? 'danger' : ''}`}>{status}</span>
                              </div>
                            </div>
                            <div className="rule-tags">
                              <span className="tag"><strong>Rules:</strong> {watch.rules.length}</span>
                              <span className="tag"><strong>Recursion:</strong> {watch.recursive ? 'Yes' : 'No'}</span>
                            </div>
                            <div className="button-row">
                              <button className="ghost-button icon-only" title="Edit" onClick={() => startEdit(watch)}>{Icons.Edit}</button>
                              <button className="ghost-button icon-only" title={watch.enabled ? 'Disable' : 'Enable'} onClick={() => toggleWatch(watch)} disabled={busy === `toggle:${watch.id}`}>
                                {watch.enabled ? Icons.Pause : Icons.Play}
                              </button>
                              <button className="ghost-button icon-only" title="Scan" onClick={() => scanWatch(watch)} disabled={busy === `scan:${watch.id}`}>{Icons.Refresh}</button>
                              <button className="danger-button icon-only" title="Delete" onClick={() => removeWatch(watch)} disabled={busy === `watch:${watch.id}`}>{Icons.Trash}</button>
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="empty">No folders configured.</div>
                  )}
                </>
              ) : (
                /* WIZARD */
                <div className="panel wizard-container" style={{ padding: '48px', maxWidth: '640px' }}>
                  <div className="wizard-header" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px', alignItems: 'center', textAlign: 'center' }}>
                    <h2 className="panel-title" style={{ fontSize: '2rem' }}>{editingId ? 'Edit Folder' : 'New Folder'}</h2>
                    <p className="panel-subtitle">Follow three steps to configure folder monitoring.</p>
                  </div>

                  <div className="wizard-progress" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '40px' }}>
                    <span className={`pill ${wizardStep >= 1 ? 'success' : ''}`} style={{ justifyContent: 'center' }}>1. Directory</span>
                    <span className={`pill ${wizardStep >= 2 ? 'success' : ''}`} style={{ justifyContent: 'center' }}>2. Rules</span>
                    <span className={`pill ${wizardStep >= 3 ? 'success' : ''}`} style={{ justifyContent: 'center' }}>3. Activation</span>
                  </div>

                  <div className="wizard-content">
                    {wizardStep === 1 && (
                      <div className="stack">
                        <div className="field">
                          <label>Folder to monitor</label>
                          <div className="path-row">
                            <input value={watchForm.directoryPath} onChange={(e) => setWatchForm({ ...watchForm, directoryPath: e.target.value })} />
                            <button className="ghost-button icon-only" title="Browse" type="button" onClick={browseDirectory} disabled={busy === 'browse'}>{Icons.Folder}</button>
                          </div>
                        </div>
                        <label className="toggle">
                          <input type="checkbox" checked={watchForm.recursive} onChange={(e) => setWatchForm({ ...watchForm, recursive: e.target.checked })} />
                          Include subfolders
                        </label>
                      </div>
                    )}

                    {wizardStep === 2 && (
                      <div className="stack">
                        {renderIconPicker({
                          label: 'Default Icon (Optional)',
                          value: watchForm.defaultIconId,
                          onChange: (value) => setWatchForm({ ...watchForm, defaultIconId: value }),
                          allowEmpty: true,
                          emptyLabel: 'No default icon',
                        })}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '24px', marginBottom: '12px' }}>
                          <div className="section-caption">Keyword Rules</div>
                          <button className="ghost-button small icon-only" title="Add Rule" onClick={() => setWatchForm({ ...watchForm, rules: [...watchForm.rules, newRule()] })}>{Icons.Plus}</button>
                        </div>
                        {watchForm.rules.length === 0 ? (
                          <div className="empty">No rules defined.</div>
                        ) : (
                          <div className="rule-list">
                            {watchForm.rules.map((rule) => (
                              <div className="rule-card" key={rule.id}>
                              <div className="field">
                                  <label>Keyword</label>
                                  <input value={rule.keyword} onChange={(e) => setRuleValue(rule.id, 'keyword', e.target.value)} />
                                </div>
                                {renderIconPicker({
                                  label: 'Icon',
                                  value: rule.iconId,
                                  onChange: (value) => setRuleValue(rule.id, 'iconId', value),
                                  allowEmpty: true,
                                  emptyLabel: 'No icon selected',
                                })}
                                <button className="danger-button icon-only" title="Remove" onClick={() => setWatchForm({ ...watchForm, rules: watchForm.rules.filter(r => r.id !== rule.id) })}>{Icons.Trash}</button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {wizardStep === 3 && (
                      <div className="stack">
                        <div className="field">
                          <label>Internal identifier</label>
                          <input value={watchForm.name} onChange={(e) => setWatchForm({ ...watchForm, name: e.target.value })} placeholder="E.g. Clients Archive" />
                        </div>
                        <label className="toggle field-toggle">
                          <input type="checkbox" checked={watchForm.enabled} onChange={(e) => setWatchForm({ ...watchForm, enabled: e.target.checked })} />
                          Activate folder immediately
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="button-row" style={{ marginTop: '48px', display: 'flex', gap: '16px' }}>
                    <button className="ghost-button" style={{ flex: 1 }} title="Cancel" onClick={closeWizard}>{Icons.Close}</button>
                    {wizardStep > 1 && <button className="ghost-button" style={{ flex: 1 }} title="Back" onClick={() => setWizardStep(wizardStep - 1)}>{Icons.ArrowLeft}</button>}
                    {wizardStep < 3 ? (
                      <button className="button" style={{ flex: 1 }} title="Next" onClick={goToNextWizardStep}>{Icons.ArrowRight}</button>
                    ) : (
                      <button className="button" style={{ flex: 1 }} title="Save Folder" onClick={submitWatch} disabled={busy === 'watch'}>{Icons.Check}</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* LIBRARY VIEW */}
          {currentView === 'library' && (
            <div className="fade-in dashboard-layout">
              <div style={{ display: 'flex', gap: '24px', flex: 1, minHeight: 0 }}>
                {/* UPLOAD PANEL (LEFT) */}
                <section className="panel" style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', padding: '32px' }}>
                  <div className="panel-header" style={{ marginBottom: '24px' }}>
                    <h2 className="panel-title">New Icon</h2>
                    <p className="panel-subtitle">Upload a .ico file or supported image.</p>
                  </div>
                  <form className="watch-form" onSubmit={submitIcon} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '24px' }}>
                    <div className="field" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <div
                        className="upload-dropzone"
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <input id="icon-file" type="file" accept=".ico,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setIconFile(e.target.files?.[0] || null)} style={{ display: 'none' }} />
                        <label htmlFor="icon-file" className="dropzone-label" style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                          </svg>
                          <div style={{ marginTop: '16px' }}>
                            <strong>{iconFile ? iconFile.name : 'Drag or click'}</strong>
                          </div>
                        </label>
                      </div>
                    </div>
                    <div className="field" style={{ flexShrink: 0 }}>
                      <label>Custom name (Optional)</label>
                      <input value={iconName} onChange={(e) => setIconName(e.target.value)} placeholder="Auto" />
                    </div>
                    <div className="button-row" style={{ flexShrink: 0 }}>
                      <button className="button icon-only" title="Save to library" type="submit" disabled={busy === 'icon'} style={{ width: '100%' }}>{Icons.Upload}</button>
                    </div>
                  </form>
                </section>

                {/* GRID PANEL (RIGHT) */}
                <section className="panel summary-panel" style={{ flex: 1 }}>
                  <div className="panel-header">
                    <h2 className="panel-title">Your icons</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {isWizardOpen && (
                        <button className="ghost-button small" type="button" onClick={() => setCurrentView('monitors')}>
                          {Icons.ArrowLeft}
                          Back to folder setup
                        </button>
                      )}
                      <span className="pill">{state?.icons.length || 0} items</span>
                    </div>
                  </div>
                  <div className="scrollable-list">
                    {state?.icons.length ? (
                      <div className="icon-grid" style={{ paddingBottom: '16px' }}>
                        {state.icons.map((icon) => (
                          <article className="icon-card" key={icon.id}>
                            <div className="icon-preview"><img src={icon.previewUrl} alt={icon.name} /></div>
                            <div>
                              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{icon.name}</strong>
                              <div className="meta">Uses: {icon.usageCount}</div>
                            </div>
                            <button className="danger-button icon-only" title="Remove" onClick={() => removeIcon(icon)} disabled={icon.usageCount > 0 || busy === `icon:${icon.id}`}>{Icons.Trash}</button>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="empty" style={{ margin: 'auto' }}>No icons.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ACTIVITY VIEW */}
          {currentView === 'activity' && (
            <div className="fade-in stack">
              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Event Logs</h2>
                  <span className="pill">{state?.events.length || 0} events</span>
                </div>
                {state?.events.length ? (
                  <div className="event-list">
                    {state.events.map((entry) => (
                      <article className="event-card" key={entry.id}>
                        <div className="event-meta">
                          <span className={`level ${entry.level}`}>{eventLabel(entry.level)}</span>
                          <span>{formatDate(entry.timestamp)}</span>
                          {entry.watchName && <span>{entry.watchName}</span>}
                        </div>
                        <p>{entry.message}</p>
                        {entry.folderPath && <code>{entry.folderPath}</code>}
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty">No events recorded.</div>
                )}
              </section>
            </div>
          )}
          {/* SETTINGS VIEW */}
          {currentView === 'settings' && (
            <div className="fade-in stack" style={{ maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
              <section className="panel">
                <div className="panel-header">
                  <h2 className="panel-title">Application Settings</h2>
                  <p className="panel-subtitle">Configure system behavior and application defaults.</p>
                </div>

                <div style={{ display: 'flex', gap: '32px', marginTop: '24px', alignItems: 'flex-start' }}>
                  
                  {/* Settings Sidebar */}
                  <aside style={{ width: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button className={`nav-item ${settingsTab === 'system' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('system')}>
                      <span className="icon">{Icons.Gear}</span>
                      System
                    </button>
                    <button className={`nav-item ${settingsTab === 'monitoring' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('monitoring')}>
                      <span className="icon">{Icons.Activity}</span>
                      Monitoring Behavior
                    </button>
                    <button className={`nav-item ${settingsTab === 'maintenance' ? 'active' : ''}`} type="button" onClick={() => setSettingsTab('maintenance')}>
                      <span className="icon">{Icons.Document}</span>
                      Maintenance & Data
                    </button>
                    <button className={`nav-item ${settingsTab === 'service' ? 'active' : ''}`} type="button" onClick={() => { setSettingsTab('service'); void loadServiceStatus() }}>
                      <span className="icon">{Icons.Power}</span>
                      Service
                    </button>
                  </aside>

                  {/* Settings Content Area */}
                  <div className="stack" style={{ flex: 1 }}>
                    {settingsTab === 'system' && (
                      <div className="fade-in stack" style={{ gap: '32px' }}>
                        <div>
                          <div className="section-caption" style={{ marginBottom: '16px' }}>System</div>
                          <div className="rule-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button
                              className={`setting-row ${settingsDraft?.runAtStartup ? 'active' : ''}`}
                              type="button"
                              onClick={() => updateSetting('runAtStartup', !settingsDraft?.runAtStartup)}
                            >
                              <div className="setting-icon">{Icons.Check}</div>
                              <div className="setting-content">
                                <strong>Run at startup</strong>
                                <small>Automatically launch Icon Studio when Windows starts.</small>
                              </div>
                            </button>

                            <button
                              className={`setting-row ${settingsDraft?.startMinimized ? 'active' : ''}`}
                              type="button"
                              onClick={() => updateSetting('startMinimized', !settingsDraft?.startMinimized)}
                            >
                              <div className="setting-icon">{Icons.Check}</div>
                              <div className="setting-content">
                                <strong>Start minimized in tray</strong>
                                <small>
                                  Hide the window at startup and keep it in the system tray.
                                  {state?.runtime && !(state.runtime as unknown as { desktopIntegration?: { startMinimizedSupported?: boolean } }).desktopIntegration?.startMinimizedSupported && (
                                    <> <span style={{ color: 'var(--accent)', opacity: 0.7 }}>(Tray integration not available in this build — setting is saved but has no effect.)</span></>
                                  )}
                                </small>
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'monitoring' && (
                      <div className="fade-in stack" style={{ gap: '32px' }}>
                        <div>
                          <div className="section-caption" style={{ marginBottom: '16px' }}>Monitoring Behavior</div>
                          <div className="rule-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button
                              className={`setting-row ${settingsDraft?.ignoreHiddenItems ? 'active' : ''}`}
                              type="button"
                              onClick={() => updateSetting('ignoreHiddenItems', !settingsDraft?.ignoreHiddenItems)}
                            >
                              <div className="setting-icon">{Icons.Check}</div>
                              <div className="setting-content">
                                <strong>Ignore hidden items</strong>
                                <small>Do not apply icons or rules to hidden folders or system files.</small>
                              </div>
                            </button>

                            <button
                              className={`setting-row ${settingsDraft?.reapplyOnStartup ? 'active' : ''}`}
                              type="button"
                              onClick={() => updateSetting('reapplyOnStartup', !settingsDraft?.reapplyOnStartup)}
                            >
                              <div className="setting-icon">{Icons.Check}</div>
                              <div className="setting-content">
                                <strong>Re-apply icons on startup</strong>
                                <small>Run a full background scan on all active monitors every time the app launches.</small>
                              </div>
                            </button>

                            <div className="setting-row" style={{ display: 'flex', flexDirection: 'column', width: '100%', cursor: 'default' }}>
                              <label style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <span>Polling Interval</span>
                                {renderEditableSliderValue({
                                  settingKey: 'pollingIntervalSeconds',
                                  value: settingsDraft?.pollingIntervalSeconds ?? 5,
                                  min: 1,
                                  max: 60,
                                  suffix: 'seconds',
                                })}
                              </label>
                              <input
                                type="range"
                                className="custom-range"
                                min="1"
                                max="60"
                                value={settingsDraft?.pollingIntervalSeconds ?? 5}
                                onChange={(e) => updateSetting('pollingIntervalSeconds', parseInt(e.target.value))}
                                style={{ width: '100%' }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'maintenance' && (
                      <div className="fade-in stack" style={{ gap: '32px' }}>
                        <div>
                          <div className="section-caption" style={{ marginBottom: '16px' }}>Maintenance & Data</div>
                          <div className="rule-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                            <div className="setting-row" style={{ display: 'flex', flexDirection: 'column', width: '100%', cursor: 'default' }}>
                              <label style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                <span>Log Retention</span>
                                {renderEditableSliderValue({
                                  settingKey: 'logRetentionDays',
                                  value: settingsDraft?.logRetentionDays ?? 30,
                                  min: 1,
                                  max: 365,
                                  suffix: 'days',
                                })}
                              </label>
                              <input
                                type="range"
                                className="custom-range"
                                min="1"
                                max="365"
                                value={settingsDraft?.logRetentionDays ?? 30}
                                onChange={(e) => updateSetting('logRetentionDays', parseInt(e.target.value))}
                                style={{ width: '100%' }}
                              />
                            </div>
                            <div className="button-row" style={{ marginTop: '8px', gap: '12px' }}>
                              <button
                                className="ghost-button"
                                type="button"
                                disabled={busy === 'settings:export'}
                                onClick={handleExportSettings}
                              >
                                {busy === 'settings:export' ? 'Exporting…' : 'Export Configuration Backup'}
                              </button>
                              <button className="button" type="button" disabled title="Not available yet — no backend endpoint for import.">
                                Restore from Backup…
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {settingsTab === 'service' && (
                      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div className="section-caption">Backend Service</div>

                        <div className="rule-card" style={{ display: 'block' }}>

                          {/* Row 1: status left | buttons right */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>

                            {/* Left: dot + text */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              {/* Status dot */}
                              <div style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                flexShrink: 0,
                                background:
                                  serviceStatusLoading || !!busy
                                    ? 'rgba(255,255,255,0.2)'
                                    : serviceStatus?.running
                                      ? '#34c759'
                                      : serviceStatus
                                        ? '#ff3b30'
                                        : 'rgba(255,255,255,0.15)',
                                boxShadow:
                                  !serviceStatusLoading && serviceStatus?.running && !busy
                                    ? '0 0 7px #34c759'
                                    : 'none',
                                transition: 'background 0.3s, box-shadow 0.3s',
                              }} />

                              {/* Label + meta */}
                              <div>
                                <div style={{ fontSize: '14px', fontWeight: 600 }}>
                                  {busy === 'service:restart' ? 'Restarting…'
                                    : busy === 'service:start' ? 'Starting…'
                                    : busy === 'service:stop' ? 'Stopping…'
                                    : serviceStatusLoading ? 'Checking…'
                                    : serviceStatus?.running ? 'Running'
                                    : serviceStatus ? 'Stopped'
                                    : '—'}
                                </div>
                                {serviceStatus && !busy && !serviceStatusLoading && (
                                  <div style={{ fontSize: '12px', opacity: 0.45, marginTop: 2, display: 'flex', gap: '8px' }}>
                                    {serviceStatus.pid && <span>PID {serviceStatus.pid}</span>}
                                    {serviceStatus.version && <span>v{serviceStatus.version}</span>}
                                    {serviceStatus.uptime !== undefined && (
                                      <span>Up {Math.floor(serviceStatus.uptime / 3600)}h {Math.floor((serviceStatus.uptime % 3600) / 60)}m {serviceStatus.uptime % 60}s</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right: actions */}
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                              {/* OFF → Start */}
                              {serviceStatus && !serviceStatus.running && (
                                <button
                                  className="ghost-button icon-only"
                                  type="button"
                                  title="Start service"
                                  disabled={!!busy}
                                  onClick={handleStartService}
                                  style={{ color: '#34c759' }}
                                >
                                  {Icons.Power}
                                </button>
                              )}

                              {/* ON → Restart + Stop */}
                              {serviceStatus?.running && (
                                <>
                                  <button
                                    className="ghost-button icon-only"
                                    type="button"
                                    title="Restart service"
                                    disabled={!!busy}
                                    onClick={handleRestartService}
                                  >
                                    {Icons.Restart}
                                  </button>
                                  <button
                                    className="ghost-button icon-only"
                                    type="button"
                                    title="Stop service"
                                    disabled={!!busy}
                                    onClick={handleStopService}
                                    style={{ color: '#ff3b30' }}
                                  >
                                    {Icons.Stop}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.06)', margin: '16px 0' }} />

                          <p style={{ margin: 0, opacity: 0.4, fontSize: '13px', lineHeight: 1.6 }}>
                            The backend service manages folder monitoring and applies custom icons in real-time.
                            Restarting briefly suspends all active monitors.
                          </p>

                        </div>
                      </div>
                    )}


                    <div className="button-row" style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <button
                        className="button"
                        type="button"
                        disabled={!dirtySettings || busy === 'settings:save'}
                        onClick={saveSettings}
                      >
                        {busy === 'settings:save' ? 'Saving…' : 'Save Settings'}
                      </button>
                      {dirtySettings && (
                        <small style={{ marginLeft: '16px', color: 'var(--accent)', opacity: 0.8 }}>Unsaved changes</small>
                      )}
                    </div>
                  </div>

                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
