import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import {
  INTAKE_AUTO_TRIAGE_JOB_OPTIONS,
  type IntakeAutoTriageJobData,
  TRACKER_QUEUE_NAMES,
} from '../queues';

/**
 * Wave 3 / Tracker Phase 3 part B (2026-05-24) — продьюсер очереди
 * `core.intake-auto-triage`. Lightweight wrapper над BullMQ Queue с
 * фиксированным jobId по `intakeIssueId` — повторный enqueue для того же
 * IntakeIssue в окне жизни первого job'а игнорируется.
 *
 * Используется:
 *   - `IntakeService.create` — best-effort enqueue после создания
 *     IntakeIssue (через @Optional() в самом сервисе, чтобы тесты не
 *     требовали Redis).
 *   - `MeetingExtractActionsService.extract` — после создания IntakeIssue
 *     из встречи (best-effort).
 *
 * Consumer — `IntakeAutoTriageWorker` (см. workers/).
 */
@Injectable()
export class IntakeAutoTriageQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IntakeAutoTriageQueueService.name);
  private queue: Queue<IntakeAutoTriageJobData> | null = null;

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  onModuleInit(): void {
    this.queue = new Queue<IntakeAutoTriageJobData>(
      TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE,
      {
        connection: this.redis.client,
        defaultJobOptions: INTAKE_AUTO_TRIAGE_JOB_OPTIONS,
      },
    );
    this.logger.log(
      `IntakeAutoTriageQueueService инициализирован (${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close();
      } catch (err) {
        this.logger.warn(
          `Ошибка при закрытии очереди ${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.queue = null;
    }
  }

  /**
   * Постановка job'а auto-triage. Идемпотентно: jobId фиксирован по
   * `intakeIssueId`, повторный вызов в окне жизни job'а возвращает быстро
   * без duplicate'а. Worker сам проверит `triagedAt IS NOT NULL` и
   * пропустит, если IntakeIssue уже триажен.
   */
  async enqueue(args: {
    tenantId: string;
    intakeIssueId: string;
  }): Promise<void> {
    if (!this.queue) {
      throw new Error(
        'IntakeAutoTriageQueueService: попытка enqueue до onModuleInit',
      );
    }
    const jobId = `intake-auto-triage:${args.intakeIssueId}`;
    await this.queue.add(
      'intake-auto-triage',
      { tenantId: args.tenantId, intakeIssueId: args.intakeIssueId },
      { jobId },
    );
    this.logger.debug(
      `enqueue ${TRACKER_QUEUE_NAMES.INTAKE_AUTO_TRIAGE} intake=${args.intakeIssueId}`,
    );
  }
}
