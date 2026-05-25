import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { RedisService } from '../../../common/redis/redis.service';
import { QUEUE_NAMES } from '../../ai/queues';
import { CORE_QUEUE_NAMES } from '../../core-queue/queues';
import { TRACKER_QUEUE_NAMES } from '../../tracker/queues';

/**
 * Admin-redesign Фаза 1 — `AdminIncidentsService`.
 *
 * Источник «что прямо сейчас сломано»:
 *   - failed BullMQ-jobs из всех очередей (`ai.*`, `core.*`, `tracker.*`).
 *
 * Очереди создаются на каждый Service-instance, кэшируются по имени.
 * Список имён — фиксированный (через статические `QUEUE_NAMES` и т.п.).
 * Динамическое сканирование через DiscoveryService не делаем — в проекте
 * очереди не регистрируются через NestJS-декораторы (только `new Queue(...)`
 * внутри сервисов), а значит метаданных для discovery нет.
 *
 * Alert-rules — in-memory MVP-stub без cron-проверки и без БД (см. ТЗ).
 */

export interface QueueIncidentSummary {
  queueName: string;
  counts: Record<string, number>;
  /** Последние failed-jobs (до 3 штук). */
  recentFailed: Array<{
    id: string;
    name: string;
    failedReason: string | null;
    timestamp: number | null;
    attemptsMade: number;
    stacktraceExcerpt: string | null;
  }>;
}

export interface IncidentRule {
  id: string;
  name: string;
  trigger: 'queue_failed' | 'cron_failed' | 'manual';
  condition: string;
  channel: 'log' | 'web_push' | 'email';
  enabled: boolean;
  createdAt: Date;
  /**
   * Признак того, что правило в MVP не активируется (нет cron-чекера).
   * Сохраняется как маркер, чтобы UI мог показать предупреждение.
   */
  mvpInactive: true;
}

@Injectable()
export class AdminIncidentsService implements OnModuleDestroy {
  private readonly logger = new Logger(AdminIncidentsService.name);
  private readonly queueCache = new Map<string, Queue>();
  private readonly rules = new Map<string, IncidentRule>();

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queueCache.values()) {
      try {
        await q.close();
      } catch (err) {
        this.logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            queue: q.name,
          },
          'AdminIncidentsService: ошибка close queue',
        );
      }
    }
    this.queueCache.clear();
  }

  // ─────────────────────────── public api ──────────────────────────────

  /**
   * Перечислить все имена очередей, которые мы знаем (static-список).
   * Используется и getQueues(), и getIncidents() для итерации.
   */
  getKnownQueueNames(): string[] {
    return [
      ...Object.values(QUEUE_NAMES),
      ...Object.values(CORE_QUEUE_NAMES),
      ...Object.values(TRACKER_QUEUE_NAMES),
    ];
  }

  /**
   * Текущие инциденты: для каждой очереди — счётчики и последние failed-jobs.
   * UI рендерит карточки «N failed jobs in {queue}» с раскрытием.
   */
  async listIncidents(): Promise<QueueIncidentSummary[]> {
    const names = this.getKnownQueueNames();
    const results = await Promise.all(
      names.map((name) => this.getQueueSummary(name, { withRecent: true })),
    );
    // Сортировка: сначала очереди с failed-job'ами, потом остальные.
    return results.sort((a, b) => {
      const af = a.counts.failed ?? 0;
      const bf = b.counts.failed ?? 0;
      return bf - af;
    });
  }

  /**
   * Список очередей с counts (без выборки последних failed — read-only
   * кратко). Используется в Health-Queues.
   */
  async getQueues(): Promise<QueueIncidentSummary[]> {
    const names = this.getKnownQueueNames();
    const results = await Promise.all(
      names.map((name) => this.getQueueSummary(name, { withRecent: false })),
    );
    return results.sort((a, b) => a.queueName.localeCompare(b.queueName));
  }

  /**
   * Сводка по одной очереди: counts + (опц.) последние 3 failed.
   */
  async getQueueSummary(
    name: string,
    opts: { withRecent: boolean } = { withRecent: true },
  ): Promise<QueueIncidentSummary> {
    const q = this.getOrCreateQueue(name);
    let counts: Record<string, number> = {};
    try {
      counts = (await q.getJobCounts(
        'waiting',
        'active',
        'completed',
        'failed',
        'delayed',
        'paused',
      )) as Record<string, number>;
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          queue: name,
        },
        'AdminIncidentsService: getJobCounts failed',
      );
    }

    let recentFailed: QueueIncidentSummary['recentFailed'] = [];
    if (opts.withRecent) {
      try {
        const failed = await q.getFailed(0, 2);
        recentFailed = failed.map((j) => ({
          id: String(j.id ?? ''),
          name: j.name,
          failedReason: j.failedReason ?? null,
          timestamp: j.timestamp ?? null,
          attemptsMade: j.attemptsMade,
          stacktraceExcerpt: this.excerptStack(j.stacktrace),
        }));
      } catch (err) {
        this.logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            queue: name,
          },
          'AdminIncidentsService: getFailed failed',
        );
      }
    }

    return { queueName: name, counts, recentFailed };
  }

  // ─────────────────────────── alert rules (MVP stub) ──────────────────

  listRules(): IncidentRule[] {
    return Array.from(this.rules.values()).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /**
   * Создать MVP-правило. Bin: правило сохраняется только в памяти процесса,
   * без cron-проверки. UI должен показать предупреждение «MVP — правила
   * не активируются».
   */
  createRule(input: {
    name: string;
    trigger: 'queue_failed' | 'cron_failed' | 'manual';
    condition: string;
    channel: 'log' | 'web_push' | 'email';
    enabled: boolean;
  }): IncidentRule {
    const id = this.generateId();
    const rule: IncidentRule = {
      id,
      name: input.name,
      trigger: input.trigger,
      condition: input.condition,
      channel: input.channel,
      enabled: input.enabled,
      createdAt: new Date(),
      mvpInactive: true,
    };
    this.rules.set(id, rule);
    return rule;
  }

  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  // ─────────────────────────── private ─────────────────────────────────

  private getOrCreateQueue(name: string): Queue {
    const cached = this.queueCache.get(name);
    if (cached) return cached;
    const q = new Queue(name, {
      connection: this.redis.client as never,
    });
    this.queueCache.set(name, q);
    return q;
  }

  private excerptStack(stack: string[] | null | undefined): string | null {
    if (!stack || stack.length === 0) return null;
    const joined = stack.join('\n');
    if (joined.length <= 800) return joined;
    return `${joined.slice(0, 800)}…`;
  }

  private generateId(): string {
    // crypto.randomUUID есть в Node 19+ и в Bun.
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return `rule_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  }
}
