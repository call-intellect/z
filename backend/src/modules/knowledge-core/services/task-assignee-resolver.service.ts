import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';

export interface RawTaskAssignee {
  assigneeRaw: string | null;
  assigneeUserId: string | null;
}

export interface ResolvedTaskAssignee {
  assigneeRaw: string | null;
  assigneeUserId: string | null;
  ambiguous: boolean;
}

@Injectable()
export class TaskAssigneeResolverService {
  private readonly logger = new Logger(TaskAssigneeResolverService.name);

  constructor(
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  resolve(
    rawTasks: readonly RawTaskAssignee[],
    participants: readonly AiParticipantContext[],
    tenantId: string | null,
  ): ResolvedTaskAssignee[] {
    const registered = participants.filter(
      (p): p is AiParticipantContext & { userId: string } =>
        typeof p.userId === 'string' && p.userId.length > 0,
    );
    const validUserIds = new Set(registered.map((p) => p.userId));

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

    return rawTasks.map((task) => this.resolveOne(task, validUserIds, byName, tenantId));
  }

  private resolveOne(
    task: RawTaskAssignee,
    validUserIds: ReadonlySet<string>,
    byName: ReadonlyMap<string, readonly string[]>,
    tenantId: string | null,
  ): ResolvedTaskAssignee {
    const assigneeRaw = task.assigneeRaw ?? null;

    if (task.assigneeUserId) {
      if (validUserIds.has(task.assigneeUserId)) {
        return {
          assigneeRaw,
          assigneeUserId: task.assigneeUserId,
          ambiguous: false,
        };
      }
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
    }

    if (!assigneeRaw || assigneeRaw.trim().length === 0) {
      return { assigneeRaw, assigneeUserId: null, ambiguous: false };
    }
    const key = assigneeRaw.trim().toLowerCase();
    const matches = byName.get(key);
    if (!matches || matches.length === 0) {
      return { assigneeRaw, assigneeUserId: null, ambiguous: false };
    }
    if (matches.length === 1) {
      const matched = matches[0];
      if (typeof matched !== 'string') {
        return { assigneeRaw, assigneeUserId: null, ambiguous: false };
      }
      return {
        assigneeRaw,
        assigneeUserId: matched,
        ambiguous: false,
      };
    }
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
