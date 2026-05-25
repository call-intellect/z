import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';

/**
 * Сырая задача от LLM до резолва.
 */
export interface RawTaskAssignee {
  /** Имя/роль исполнителя как прозвучало в речи. */
  assigneeRaw: string | null;
  /** userId, который LLM попыталась поставить (может быть галлюцинация). */
  assigneeUserId: string | null;
}

/**
 * Результат резолва одной задачи.
 */
export interface ResolvedTaskAssignee {
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  /** True, если матчинг сорвался (≥2 кандидатов или галлюцинация LLM). */
  ambiguous: boolean;
}

/**
 * TaskAssigneeResolverService (ТЗ 2026-05-25 hard-participant-identification).
 *
 * Жёстко проверяет связь Task → User для каждой задачи, извлечённой AI.
 * Эталон — `behavior-metrics-calculator.ts:253-268` (byIdentity + byName).
 *
 * Алгоритм (см. ТЗ §3, 4 ветки):
 *   1. LLM вернул `assigneeUserId` И этот userId есть в списке participants
 *      встречи → принимаем (host был на встрече).
 *   2. LLM вернул `assigneeUserId`, которого НЕТ в participants (галлюцинация
 *      LLM) → сбрасываем в null + ambiguous=true + warning + метрика
 *      'llm_hallucination'.
 *   3. LLM вернул только `assigneeRaw` → ищем точное совпадение имени в
 *      participants (case-insensitive, по displayName И fullName).
 *      Один матч с непустым userId → ставим userId; иначе null.
 *   4. Если матчей >1 → ambiguous=true + метрика 'duplicate_name'.
 *
 * Не пишет в БД — caller (worker) сохраняет результат в `Task`.
 */
@Injectable()
export class TaskAssigneeResolverService {
  private readonly logger = new Logger(TaskAssigneeResolverService.name);

  constructor(
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Резолвит массив задач за один проход.
   *
   * `tenantId` — нужен для метрики (label tenant). null — если резолвер
   * вызван в legacy-сценарии без tenant (можно пропустить инкремент).
   */
  resolve(
    rawTasks: readonly RawTaskAssignee[],
    participants: readonly AiParticipantContext[],
    tenantId: string | null,
  ): ResolvedTaskAssignee[] {
    // Готовим индексы на участников. Берём только тех, у кого userId !== null —
    // только зарегистрированных host'ов резолвер вообще может матчить.
    const registered = participants.filter(
      (p): p is AiParticipantContext & { userId: string } =>
        typeof p.userId === 'string' && p.userId.length > 0,
    );
    const validUserIds = new Set(registered.map((p) => p.userId));

    // Индекс по lowercased именам: display name + full name (если есть).
    // Один name может указывать на ≥1 участников (два Сергея) — value =
    // массив userId.
    const byName = new Map<string, string[]>();
    for (const p of registered) {
      const keys = new Set<string>();
      keys.add(p.displayName.trim().toLowerCase());
      if (p.fullName) keys.add(p.fullName.trim().toLowerCase());
      for (const key of keys) {
        const arr = byName.get(key) ?? [];
        arr.push(p.userId);
        byName.set(key, arr);
      }
    }

    return rawTasks.map((task) =>
      this.resolveOne(task, validUserIds, byName, tenantId),
    );
  }

  private resolveOne(
    task: RawTaskAssignee,
    validUserIds: ReadonlySet<string>,
    byName: ReadonlyMap<string, readonly string[]>,
    tenantId: string | null,
  ): ResolvedTaskAssignee {
    const assigneeRaw = task.assigneeRaw ?? null;

    // Ветка 1+2: LLM вернул userId.
    if (task.assigneeUserId) {
      if (validUserIds.has(task.assigneeUserId)) {
        // Ветка 1: валидный userId, есть в participants.
        return {
          assigneeRaw,
          assigneeUserId: task.assigneeUserId,
          ambiguous: false,
        };
      }
      // Ветка 2: галлюцинация LLM — userId не в participants.
      this.logger.warn(
        {
          assigneeUserId: task.assigneeUserId,
          assigneeRaw,
          tenantId,
        },
        'task-assignee-resolver: LLM hallucinated assigneeUserId (not in meeting participants)',
      );
      if (tenantId) {
        this.metrics?.incTaskAssigneeAmbiguous({
          tenant: tenantId,
          reason: 'llm_hallucination',
        });
      }
      // Идём ниже в fallback по имени — может, по строке всё-таки матчится.
    }

    // Ветка 3+4: только assigneeRaw (или после сброса галлюцинации).
    if (!assigneeRaw || assigneeRaw.trim().length === 0) {
      return { assigneeRaw, assigneeUserId: null, ambiguous: false };
    }
    const key = assigneeRaw.trim().toLowerCase();
    const matches = byName.get(key);
    if (!matches || matches.length === 0) {
      // Имя не найдено в participants — гость, упомянут в речи, или роль
      // («маркетинг»). Это НЕ ambiguous, это «нет матча» — нормальный кейс.
      return { assigneeRaw, assigneeUserId: null, ambiguous: false };
    }
    if (matches.length === 1) {
      // Ветка 3: ровно один матч → ставим userId.
      const matched = matches[0];
      // matches[0] всегда строка (length === 1), но TS не выводит это.
      if (typeof matched !== 'string') {
        return { assigneeRaw, assigneeUserId: null, ambiguous: false };
      }
      return {
        assigneeRaw,
        assigneeUserId: matched,
        ambiguous: false,
      };
    }
    // Ветка 4: ≥2 матча → ambiguous, оставляем raw.
    this.logger.warn(
      {
        assigneeRaw,
        matchedUserIds: matches,
        tenantId,
      },
      'task-assignee-resolver: ambiguous match (≥2 participants with same name)',
    );
    if (tenantId) {
      this.metrics?.incTaskAssigneeAmbiguous({
        tenant: tenantId,
        reason: 'duplicate_name',
      });
    }
    return { assigneeRaw, assigneeUserId: null, ambiguous: true };
  }
}
