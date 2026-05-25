/**
 * Доменная модель `/admin/platform/maintenance` — бэкапы, реиндексация,
 * окна обслуживания. Фаза 8 редизайна Z-Admin.
 *
 * Контракт backend (`AdminMaintenanceController`, префикс
 * `/api/v1/admin/platform/maintenance`):
 *   GET   /              → MaintenanceStatusApiDto
 *   POST  /backup-now    → { ok: true, jobId: string } | 501
 *   POST  /reindex-now   → { ok: true, jobId: string } | 501
 *
 * Активные maintenance-окна берутся из `SystemMessage` с type='maintenance'
 * (отдельный эндпоинт `/api/v1/admin/content/system-messages`).
 */

// ────────────────────────── ApiDto ──────────────────────────

export type MaintenanceStatusApiDto = {
  backups: {
    lastBackupAt: string | null;
    lastBackupSizeBytes: number | null;
    /** Если null — бэкапы не настроены или не поддерживаются на этом инстансе. */
    enabled: boolean;
    /** Следующий запланированный бэкап. */
    nextScheduledAt: string | null;
  };
  reindex: {
    lastRunAt: string | null;
    inProgress: boolean;
  };
};

// ────────────────────────── DomainModel ──────────────────────────

export type MaintenanceStatusDomain = {
  backups: {
    lastBackupAt: Date | null;
    lastBackupSizeBytes: number | null;
    enabled: boolean;
    nextScheduledAt: Date | null;
  };
  reindex: {
    lastRunAt: Date | null;
    inProgress: boolean;
  };
};

// ────────────────────────── Mappers ──────────────────────────

export function maintenanceStatusFromApi(
  api: MaintenanceStatusApiDto,
): MaintenanceStatusDomain {
  return {
    backups: {
      lastBackupAt: api.backups.lastBackupAt
        ? new Date(api.backups.lastBackupAt)
        : null,
      lastBackupSizeBytes: api.backups.lastBackupSizeBytes,
      enabled: api.backups.enabled,
      nextScheduledAt: api.backups.nextScheduledAt
        ? new Date(api.backups.nextScheduledAt)
        : null,
    },
    reindex: {
      lastRunAt: api.reindex.lastRunAt
        ? new Date(api.reindex.lastRunAt)
        : null,
      inProgress: api.reindex.inProgress,
    },
  };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
