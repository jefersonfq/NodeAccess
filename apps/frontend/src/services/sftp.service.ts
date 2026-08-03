import api from './api'
import type { SftpEntry } from '@nodeaccess/shared'

export type ProgressCallback = (percent: number, loaded: number, total?: number) => void

export interface SftpReadFileResponse {
  content: string
  size: number
  truncated: boolean
  modifiedAt: string | null
  hash: string | null
  mode?: number | null
  owner?: number | null
  group?: number | null
  accessedAt?: string | null
  accessedAtEpoch?: number | null
  modifiedAtEpoch?: number | null
}

export interface SftpWriteFileOptions {
  sessionId?: number | null
  expectedHash?: string | null
  expectedModifiedAt?: string | null
  expectedSize?: number | null
}

export interface SftpBackupDiffResponse {
  path: string
  backupPath: string
  beforeSize: number
  afterSize: number
  beforeHash: string
  afterHash: string
  changedLines: number
  addedLines: number
  removedLines: number
  truncated: boolean
  skippedReason: string | null
  diffMasked: string
}

export interface SftpRequestContext {
  sessionId?: number | null
}

function contextParams(context: SftpRequestContext = {}) {
  return context.sessionId ? { sessionId: context.sessionId } : {}
}

export function getSftpErrorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string } } })?.response?.data
  return data?.message ?? fallback
}

export const sftpService = {
  ping(hostId: number) {
    return api.get<{ ok: boolean; home: string }>(`/sftp/${hostId}/ping`)
  },

  list(hostId: number, path: string) {
    return api.get<{ entries: SftpEntry[]; path: string }>(`/sftp/${hostId}/list`, { params: { path } })
  },

  /**
   * Downloads a remote file, streaming with progress.
   * Returns an axios promise whose `.data` is a Blob.
   * The caller is responsible for triggering the browser save dialog.
   */
  download(hostId: number, path: string, onProgress?: ProgressCallback, context: SftpRequestContext = {}) {
    return api.get<Blob>(`/sftp/${hostId}/download`, {
      params: { path, ...contextParams(context) },
      responseType: 'blob',
      onDownloadProgress: onProgress
        ? (e) => onProgress(
            e.total ? Math.round((e.loaded / e.total) * 100) : 0,
            e.loaded,
            e.total,
          )
        : undefined,
    })
  },

  /** Triggers browser save-file dialog from a received Blob. */
  saveBlobAs(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const a   = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  },

  upload(hostId: number, path: string, file: File, onProgress?: ProgressCallback, context: SftpRequestContext = {}) {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/sftp/${hostId}/upload`, form, {
      params: { path, ...contextParams(context) },
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress
        ? (e) => onProgress(
            e.total ? Math.round((e.loaded / e.total) * 100) : 0,
            e.loaded,
            e.total,
          )
        : undefined,
    })
  },

  mkdir(hostId: number, path: string, context: SftpRequestContext = {}) {
    return api.post(`/sftp/${hostId}/mkdir`, {}, { params: { path, ...contextParams(context) } })
  },

  rename(hostId: number, oldPath: string, newPath: string, context: SftpRequestContext = {}) {
    return api.post(`/sftp/${hostId}/rename`, { oldPath, newPath, ...contextParams(context) })
  },

  delete(hostId: number, path: string, context: SftpRequestContext = {}) {
    return api.delete(`/sftp/${hostId}/file`, { params: { path, ...contextParams(context) } })
  },

  createFile(hostId: number, path: string, context: SftpRequestContext = {}) {
    return api.post(`/sftp/${hostId}/touch`, { path, ...contextParams(context) })
  },

  readFile(hostId: number, path: string, context: SftpRequestContext = {}) {
    return api.get<SftpReadFileResponse>(`/sftp/${hostId}/read`, { params: { path, ...contextParams(context) } })
  },

  writeFile(hostId: number, path: string, content: string, options: SftpWriteFileOptions = {}) {
    return api.put(`/sftp/${hostId}/write`, { path, content, ...options })
  },

  restoreBackup(hostId: number, path: string, backupPath: string, context: SftpRequestContext = {}) {
    return api.post(`/sftp/${hostId}/restore-backup`, { path, backupPath, ...contextParams(context) })
  },

  downloadBackup(hostId: number, path: string, backupPath: string, context: SftpRequestContext = {}) {
    return api.get<Blob>(`/sftp/${hostId}/download-backup`, {
      params: { path, backupPath, ...contextParams(context) },
      responseType: 'blob',
    })
  },

  backupDiff(hostId: number, path: string, backupPath: string, context: SftpRequestContext = {}) {
    return api.get<SftpBackupDiffResponse>(`/sftp/${hostId}/backup-diff`, {
      params: { path, backupPath, ...contextParams(context) },
    })
  },
}
