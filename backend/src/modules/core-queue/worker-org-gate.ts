import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * WorkerOrgGate (Z-Admin / Org-Admin Фаза 7).
 *
 * Проверяет тумблер `Org.workersEnabled[workerName]`. Если выключено —
 * бросает `WorkerDisabledForOrgError`, что приводит к failed-job в BullMQ.
 * Owner Org может включить тумблер обратно через `/org-admin/knowledge/workers`,
 * после чего failed-jobs можно вручную отретраить (BullMQ admin UI / scripts).
 *
 * Семантика поля:
 *   - `org.workersEnabled[workerName] === false` → выключено.
 *   - `undefined` (нет ключа) или любое другое значение → включено (default).
 *
 * Воркеры вызывают это в начале processor'а:
 *   await this.gate.checkOrThrow(tenantId, 'block-ingest');
 *
 * Кэш отсутствует — workersEnabled читается на каждый job. Это OK, потому
 * что запросов <1/sec на воркер. Если будет жарко — добавить кэш TTL=10s.
 */
export class WorkerDisabledForOrgError extends Error {
  readonly code = 'worker_disabled_for_org';
  constructor(workerName: string, tenantId: string) {
    super(`worker_disabled_for_org: ${workerName} for tenant=${tenantId}`);
    this.name = 'WorkerDisabledForOrgError';
  }
}

@Injectable()
export class WorkerOrgGate {
  private readonly logger = new Logger(WorkerOrgGate.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Проверяет, включён ли воркер для данной Org. На false — throw'ит
   * WorkerDisabledForOrgError. На true — возвращает void (продолжаем job).
   *
   * tenantId=null допустим (system-jobs без Org) — в таком случае всегда true.
   */
  async checkOrThrow(
    tenantId: string | null,
    workerName: string,
  ): Promise<void> {
    if (!tenantId) return;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { workersEnabled: true, deletedAt: true },
    });
    if (!org) {
      // Org удалена — пропускаем (не throw'им). BullMQ retry на удалённую Org
      // бесполезен, но это не gate-ответственность.
      return;
    }
    if (org.deletedAt) {
      // Org soft-deleted — все воркеры выключены.
      throw new WorkerDisabledForOrgError(workerName, tenantId);
    }
    const map = (org.workersEnabled ?? {}) as Record<string, unknown>;
    if (map[workerName] === false) {
      this.logger.debug(
        `gate: ${workerName} disabled for tenant=${tenantId} → fail-job`,
      );
      throw new WorkerDisabledForOrgError(workerName, tenantId);
    }
  }

  /** Чистая функция для тестов — без БД, проверяет только map. */
  static isEnabled(
    workersEnabled: Record<string, unknown> | null | undefined,
    workerName: string,
  ): boolean {
    if (!workersEnabled) return true;
    return workersEnabled[workerName] !== false;
  }
}
