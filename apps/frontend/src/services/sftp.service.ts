import api from './api'
import type { SftpEntry } from '@nodeaccess/shared'

export type ProgressCallback = (percent: number, loaded: number, total?: number) => void

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
  download(hostId: number, path: string, onProgress?: ProgressCallback) {
    return api.get<Blob>(`/sftp/${hostId}/download`, {
      params: { path },
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

  upload(hostId: number, path: string, file: File, onProgress?: ProgressCallback) {
    const form = new FormData()
    form.append('file', file)
    return api.post(`/sftp/${hostId}/upload`, form, {
      params: { path },
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

  mkdir(hostId: number, path: string) {
    return api.post(`/sftp/${hostId}/mkdir`, {}, { params: { path } })
  },

  rename(hostId: number, oldPath: string, newPath: string) {
    return api.post(`/sftp/${hostId}/rename`, { oldPath, newPath })
  },

  delete(hostId: number, path: string) {
    return api.delete(`/sftp/${hostId}/file`, { params: { path } })
  },

  createFile(hostId: number, path: string) {
    return api.post(`/sftp/${hostId}/touch`, {}, { params: { path } })
  },

  readFile(hostId: number, path: string) {
    return api.get<{ content: string; size: number; truncated: boolean }>(`/sftp/${hostId}/read`, { params: { path } })
  },

  writeFile(hostId: number, path: string, content: string) {
    return api.put(`/sftp/${hostId}/write`, { path, content })
  },
}
