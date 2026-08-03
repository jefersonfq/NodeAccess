import api from './api'

export type ObservabilityStatus = 'ok' | 'degraded' | 'unavailable'

export interface HostDiskMetric {
  mount: string
  path: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export interface DockerContainerMetric {
  id?: string
  name: string
  cpuPercent: number | null
  memoryUsageBytes: number | null
  memoryLimitBytes: number | null
  memoryPercent: number | null
  networkInputBytes: number | null
  networkOutputBytes: number | null
  blockInputBytes: number | null
  blockOutputBytes: number | null
}

export interface ComponentHealthMetric {
  name: 'api' | 'gateway' | 'mysql' | 'redis' | 'guacd'
  status: ObservabilityStatus
  latencyMs: number
  message?: string
}

export interface BackupMetric {
  type: 'mysql' | 'session_audit'
  status: ObservabilityStatus
  directory: string
  latestFile: string | null
  latestModifiedAt: string | null
  ageHours: number | null
  message?: string
}

export interface ObservabilityHistoryPoint {
  timestamp: string
  status: ObservabilityStatus
  cpuPercent: number | null
  memoryPercent: number | null
  diskPercent: number | null
  unavailableComponents: number
  unavailableBackups: number
  dockerStatus: ObservabilityStatus
}

export interface ObservabilityThresholds {
  cpuWarningPercent: number
  memoryWarningPercent: number
  diskWarningPercent: number
  backupMaxAgeHours: number
}

export interface ObservabilitySnapshot {
  status: ObservabilityStatus
  timestamp: string
  version: string
  cacheTtlMs: number
  host: {
    hostname: string
    platform: string
    arch: string
    uptimeSeconds: number
    cpu: {
      cores: number
      model: string | null
      loadAverage: {
        oneMinute: number
        fiveMinutes: number
        fifteenMinutes: number
      }
      loadPercentOfCores: number | null
    }
    memory: {
      totalBytes: number
      freeBytes: number
      usedBytes: number
      usedPercent: number
      processRssBytes: number
      processHeapUsedBytes: number
      processHeapTotalBytes: number
    }
    disks: HostDiskMetric[]
  }
  docker: {
    status: ObservabilityStatus
    containers: DockerContainerMetric[]
    message?: string
  }
  components: ComponentHealthMetric[]
  backups: BackupMetric[]
  scope: {
    kind: 'node'
    nodeId: string
    aggregation: 'local-only'
    note: string
  }
  thresholds: ObservabilityThresholds
  history: ObservabilityHistoryPoint[]
  warnings: string[]
}

export const observabilityService = {
  getSummary: () => api.get<ObservabilitySnapshot>('/admin/observability/summary'),
}
