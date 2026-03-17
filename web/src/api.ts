import type { AppState, WatchFormValues } from './types'

export type ServiceStatus = {
  running: boolean
  pid?: number
  uptime?: number // seconds
  version?: string
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || 'Errore inatteso.')
  }

  return (await response.json()) as T
}

export async function fetchState() {
  return parseResponse<AppState>(await fetch('/api/state'))
}

export async function uploadIcon(payload: { name: string; file: File }) {
  const formData = new FormData()
  formData.append('name', payload.name)
  formData.append('icon', payload.file)

  return parseResponse<AppState>(
    await fetch('/api/icons', {
      method: 'POST',
      body: formData,
    }),
  )
}

export async function deleteIcon(iconId: string) {
  return parseResponse<AppState>(
    await fetch(`/api/icons/${iconId}`, {
      method: 'DELETE',
    }),
  )
}

function mapWatchPayload(values: WatchFormValues) {
  return {
    name: values.name,
    directoryPath: values.directoryPath,
    defaultIconId: values.defaultIconId || null,
    recursive: values.recursive,
    enabled: values.enabled,
    rules: values.rules.map((rule) => ({
      id: rule.id,
      keyword: rule.keyword,
      iconId: rule.iconId || null,
    })),
  }
}

export async function createWatch(values: WatchFormValues) {
  return parseResponse<AppState>(
    await fetch('/api/watches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapWatchPayload(values)),
    }),
  )
}

export async function updateWatch(watchId: string, values: WatchFormValues) {
  return parseResponse<AppState>(
    await fetch(`/api/watches/${watchId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mapWatchPayload(values)),
    }),
  )
}

export async function deleteWatch(watchId: string) {
  return parseResponse<AppState>(
    await fetch(`/api/watches/${watchId}`, {
      method: 'DELETE',
    }),
  )
}

export async function rescanWatch(watchId: string) {
  return parseResponse<AppState & { summary: Record<string, number> }>(
    await fetch(`/api/watches/${watchId}/rescan`, {
      method: 'POST',
    }),
  )
}

export async function pickDirectory() {
  const response = await parseResponse<{ path: string | null }>(
    await fetch('/api/system/pick-directory', {
      method: 'POST',
    }),
  )

  return response.path
}

export async function fetchSettings() {
  return parseResponse<import('./types').AppSettings>(await fetch('/api/settings'))
}

export async function updateSettings(settings: import('./types').AppSettings) {
  return parseResponse<import('./types').AppSettings>(
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),
  )
}

export async function exportSettings() {
  const response = await fetch('/api/settings/export')
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || 'Export failed.')
  }

  const disposition = response.headers.get('Content-Disposition')
  let filename = 'icon-studio-backup.json'
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i)
    if (match?.[1]) filename = decodeURIComponent(match[1])
  }

  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function fetchServiceStatus() {
  return parseResponse<ServiceStatus>(await fetch('/api/service/status'))
}

export async function startService() {
  return parseResponse<ServiceStatus>(
    await fetch('/api/service/start', { method: 'POST' }),
  )
}

export async function restartService() {
  return parseResponse<ServiceStatus>(
    await fetch('/api/service/restart', { method: 'POST' }),
  )
}

export async function stopService() {
  return parseResponse<ServiceStatus>(
    await fetch('/api/service/stop', { method: 'POST' }),
  )
}
