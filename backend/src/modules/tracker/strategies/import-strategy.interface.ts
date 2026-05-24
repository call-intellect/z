import type { ImportLog } from '@prisma/client';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { S3Service } from '../../recordings/s3.service';
import type { ImportErrorEntry } from '../dto/imports/import-log-response.dto';
import type { TrackerEventsService } from '../services/tracker-events.service';

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — общий контракт стратегии
 * импорта (по одной на источник: Trello / Bitrix24 / Я.Трекер).
 *
 * Стратегия НЕ хранит состояние между вызовами — единственный stateful
 * source = `ImportLog` в БД, который воркер обновляет после каждого батча.
 *
 * Имя `import` зарезервировано в JS — метод называется `run`.
 */
export interface ImportStrategy {
  run(args: ImportStrategyArgs): Promise<ImportResult>;
}

export interface ImportStrategyArgs {
  importLog: ImportLog;
  /** Параметры из ImportLog.paramsJson (специфичны для источника). */
  params: Record<string, unknown>;
  /** Inject prisma + s3 + metrics + events извне (через worker). */
  services: ImportStrategyServices;
  /**
   * Hook для эмиссии WS-progress'а из стратегии. Воркер сам решает,
   * как часто фактически шлёт (throttle ~5 сек).
   */
  onProgress(args: {
    processed: number;
    total: number;
    phase: string;
  }): Promise<void>;
}

export interface ImportStrategyServices {
  prisma: PrismaService;
  s3: S3Service;
  metrics?: BusinessMetricsService;
  events: TrackerEventsService;
}

/**
 * Итог импорта. Воркер сам обновит ImportLog финальными счётчиками после
 * завершения; стратегия лишь возвращает агрегаты.
 */
export interface ImportResult {
  totalProjects: number;
  totalIssues: number;
  totalComments: number;
  totalAttachments: number;
  /** Email'ы, которые не нашли в userMappings (для UI повторного маппинга). */
  unmatchedEmails: string[];
  /** Накопленные ошибки (best-effort, не фатальные). */
  errors: ImportErrorEntry[];
}
