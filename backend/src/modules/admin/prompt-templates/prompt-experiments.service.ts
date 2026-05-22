/**
 * Фаза A.3 — PromptExperimentsService.
 *
 * Источник: ТЗ A §7.2 и §10.
 *
 * Жизненный цикл prompt-эксперимента:
 *   draft (создан) → running (start) → stopped (manual) | completed (cron по endsAt).
 *
 * Бизнес-правила:
 *   - templateAId и templateBId должны принадлежать одному `PromptTemplate`
 *     (это две версии одного шаблона), либо обе быть system-шаблонами с
 *     совпадающим taskType (cross-template A/B — допускается для super_admin).
 *   - splitPercent: 0..100, sticky-allocation `hash(meetingId+experimentId) % 100 < splitPercent` → B.
 *   - endsAt: не раньше «сейчас + 1 час», не позже «сейчас + 30 дней» (§10.3).
 *   - Лимит одновременных running-экспериментов на Org — через
 *     `EntitlementService.getQuota('prompt_experiments_concurrent')`.
 *
 * RBAC:
 *   - super_admin может создавать с `orgId=null` (глобальный) и с любым orgId.
 *   - owner/admin — только для своей Org и с `feature.prompt_experiments`.
 *
 * Метрики:
 *   - `z_prompt_experiment_active_count` (gauge) обновляется при start/stop/expire.
 *   - `z_prompt_experiment_completed_total{reason}` — на каждое завершение.
 */

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { PromptExperiment, PromptTemplateVersion } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EntitlementService } from '../../entitlements/entitlement.service';

import type {
  AnalyticsQueryDto,
  CreatePromptExperimentDto,
  ListPromptExperimentsQueryDto,
  StopPromptExperimentDto,
} from './dto/prompt-experiments.dto';

/** Не раньше «сейчас + 1 час», не позже «сейчас + 30 дней». */
export const EXPERIMENT_MIN_DURATION_MS = 60 * 60 * 1000; // 1 час
export const EXPERIMENT_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

/** Доступ к Org-эксперименту: super_admin или owner/admin данной Org. */
export interface ExperimentRbacContext {
  userId: string;
  isSuperAdmin: boolean;
  /** Список Org, в которых пользователь owner/admin. */
  ownedOrgIds: string[];
}

@Injectable()
export class PromptExperimentsService {
  private readonly logger = new Logger(PromptExperimentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntitlementService)
    private readonly entitlements: EntitlementService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  // ─── list / detail ────────────────────────────────────────────────────

  async list(
    filters: ListPromptExperimentsQueryDto,
    rbac: ExperimentRbacContext,
  ): Promise<{ items: PromptExperiment[] }> {
    const where: Record<string, unknown> = {};
    if (filters.status) where['status'] = filters.status;
    if (!rbac.isSuperAdmin) {
      // Org-Admin видит только эксперименты своих Org.
      where['orgId'] = { in: rbac.ownedOrgIds };
    } else if (filters.orgId !== undefined) {
      where['orgId'] = filters.orgId;
    }
    const items = await this.prisma.promptExperiment.findMany({
      where: where as never,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    return { items };
  }

  async detail(id: string, rbac: ExperimentRbacContext): Promise<PromptExperiment> {
    const exp = await this.prisma.promptExperiment.findUnique({ where: { id } });
    if (!exp) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'prompt_experiment_not_found', id },
      });
    }
    this.assertCanAccess(exp, rbac);
    return exp;
  }

  // ─── create ──────────────────────────────────────────────────────────

  async create(
    dto: CreatePromptExperimentDto,
    rbac: ExperimentRbacContext,
  ): Promise<PromptExperiment> {
    // Доступ: super_admin может null orgId или любую; org-admin — только свои.
    const orgId = dto.orgId ?? null;
    if (orgId !== null) {
      if (!rbac.isSuperAdmin && !rbac.ownedOrgIds.includes(orgId)) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'no_access_to_org', orgId },
        });
      }
      // Entitlement-гейт для Org-уровня (super_admin тоже проверяет, чтобы не
      // плодить эксперименты на тарифе без фичи; super_admin может временно
      // переопределить через `OrgEntitlement.featureOverrides`).
      const hasFeature = await this.entitlements.hasFeature(
        orgId,
        'feature.prompt_experiments',
      );
      if (!hasFeature) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'feature_not_available',
            feature: 'feature.prompt_experiments',
            message: 'Доступно на тарифе Pro/Business',
          },
        });
      }
    } else if (!rbac.isSuperAdmin) {
      // Глобальный эксперимент (orgId=null) — только super_admin.
      throw new ForbiddenException({
        ok: false,
        error: { code: 'global_experiment_super_admin_only' },
      });
    }

    if (dto.templateAId === dto.templateBId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'experiment_a_b_must_differ' },
      });
    }

    // Валидация версий: должны существовать и быть связаны с шаблоном того же
    // taskType. orgId шаблона должен соответствовать experimentу: либо null
    // (system), либо равно experiment.orgId.
    const [verA, verB] = await Promise.all([
      this.prisma.promptTemplateVersion.findUnique({
        where: { id: dto.templateAId },
        include: { template: true },
      }),
      this.prisma.promptTemplateVersion.findUnique({
        where: { id: dto.templateBId },
        include: { template: true },
      }),
    ]);
    if (!verA || !verB) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'template_version_not_found' },
      });
    }
    if (verA.template.taskType !== verB.template.taskType) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'experiment_a_b_task_type_mismatch' },
      });
    }
    // meetingType должен совпадать (или оба null = универсальные).
    if (verA.template.meetingType !== verB.template.meetingType) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'experiment_a_b_meeting_type_mismatch' },
      });
    }
    // Каждый шаблон должен быть доступен в данном scope:
    //   - orgId эксперимента null: оба шаблона должны быть scope=system.
    //   - orgId эксперимента не null: каждый шаблон scope=org с тем же orgId,
    //     либо scope=system (можно сравнивать system vs org).
    this.assertTemplateBelongsToExperiment(verA.template, orgId, 'A');
    this.assertTemplateBelongsToExperiment(verB.template, orgId, 'B');

    // endsAt валидация (если задан).
    const endsAt = this.parseEndsAt(dto.endsAt ?? null);

    // Лимит на одновременные running-эксперименты считаем при `start`,
    // не при `create` (создание draft'ов разрешено без лимита).

    const created = await this.prisma.promptExperiment.create({
      data: {
        orgId,
        templateAId: dto.templateAId,
        templateBId: dto.templateBId,
        splitPercent: dto.splitPercent,
        status: 'draft',
        endsAt,
        notes: dto.notes ?? null,
        createdById: rbac.userId,
      },
    });

    this.logger.log(
      {
        id: created.id,
        orgId,
        templateAId: dto.templateAId,
        templateBId: dto.templateBId,
        splitPercent: dto.splitPercent,
        userId: rbac.userId,
      },
      'prompt-experiment created',
    );
    return created;
  }

  // ─── start / stop ────────────────────────────────────────────────────

  async start(id: string, rbac: ExperimentRbacContext): Promise<PromptExperiment> {
    const exp = await this.detail(id, rbac);
    if (exp.status === 'running') {
      return exp; // идемпотентность
    }
    if (exp.status === 'completed' || exp.status === 'stopped') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'experiment_already_finished', status: exp.status },
      });
    }

    // Лимит одновременных running-экспериментов на Org (либо глобально для null).
    const limit = exp.orgId
      ? await this.entitlements.getQuota(exp.orgId, 'prompt_experiments_concurrent')
      : 3; // глобальный — фикс 3 (см. ТЗ §10.3)
    if (limit > 0) {
      const activeCount = await this.prisma.promptExperiment.count({
        where: { orgId: exp.orgId, status: 'running' },
      });
      if (activeCount >= limit) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'too_many_running_experiments',
            limit,
            current: activeCount,
          },
        });
      }
    } else {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'experiments_not_allowed_on_tier' },
      });
    }

    const updated = await this.prisma.promptExperiment.update({
      where: { id: exp.id },
      data: { status: 'running', startedAt: new Date() },
    });
    await this.refreshActiveCount();
    this.logger.log({ id: exp.id, userId: rbac.userId }, 'prompt-experiment started');
    return updated;
  }

  async stop(
    id: string,
    dto: StopPromptExperimentDto,
    rbac: ExperimentRbacContext,
  ): Promise<PromptExperiment> {
    const exp = await this.detail(id, rbac);
    if (exp.status === 'stopped' || exp.status === 'completed') {
      return exp;
    }
    const updated = await this.prisma.promptExperiment.update({
      where: { id: exp.id },
      data: {
        status: 'stopped',
        endsAt: exp.endsAt ?? new Date(),
        notes: dto.reason ? appendNote(exp.notes, `stop: ${dto.reason}`) : exp.notes,
      },
    });
    await this.refreshActiveCount();
    this.metrics?.incPromptExperimentCompleted({ reason: 'stopped' });
    this.logger.log(
      { id: exp.id, userId: rbac.userId, reason: dto.reason },
      'prompt-experiment stopped',
    );
    return updated;
  }

  // ─── analytics ──────────────────────────────────────────────────────

  async analytics(
    id: string,
    rbac: ExperimentRbacContext,
    q: AnalyticsQueryDto,
  ): Promise<{
    experiment: PromptExperiment;
    groups: {
      group: 'A' | 'B';
      versionId: string;
      meetingsCount: number;
      positiveFeedback: number;
      negativeFeedback: number;
    }[];
  }> {
    const exp = await this.detail(id, rbac);

    // Подсчёт по AiResult, попавшим в эксперимент. Идентификация: связь
    // PromptTemplateVersion + experimentGroup. Один meeting может быть только
    // в одном из них (sticky-allocation).
    const where: Record<string, unknown> = {
      promptTemplateVersionId: { in: [exp.templateAId, exp.templateBId] },
    };
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range['gte'] = new Date(q.from);
      if (q.to) range['lte'] = new Date(q.to);
      where['createdAt'] = range;
    }

    const aiResults = await this.prisma.aiResult.findMany({
      where: where as never,
      select: {
        id: true,
        experimentGroup: true,
        promptTemplateVersionId: true,
      },
    });

    // Группируем по experimentGroup и считаем feedback по этим aiResult.id.
    const groupAIds = aiResults
      .filter((r) => r.experimentGroup === 'A' && r.promptTemplateVersionId === exp.templateAId)
      .map((r) => r.id);
    const groupBIds = aiResults
      .filter((r) => r.experimentGroup === 'B' && r.promptTemplateVersionId === exp.templateBId)
      .map((r) => r.id);

    const [feedbackA, feedbackB] = await Promise.all([
      this.prisma.aiResultFeedback.groupBy({
        by: ['reaction'],
        where: { aiResultId: { in: groupAIds } },
        _count: { _all: true },
      }),
      this.prisma.aiResultFeedback.groupBy({
        by: ['reaction'],
        where: { aiResultId: { in: groupBIds } },
        _count: { _all: true },
      }),
    ]);

    const reduceFeedback = (
      list: { reaction: string; _count: { _all: number } }[],
    ): { positive: number; negative: number } => {
      let positive = 0;
      let negative = 0;
      for (const row of list) {
        if (row.reaction === 'positive') positive = row._count._all;
        else if (row.reaction === 'negative') negative = row._count._all;
      }
      return { positive, negative };
    };
    const fA = reduceFeedback(feedbackA);
    const fB = reduceFeedback(feedbackB);

    return {
      experiment: exp,
      groups: [
        {
          group: 'A',
          versionId: exp.templateAId,
          meetingsCount: groupAIds.length,
          positiveFeedback: fA.positive,
          negativeFeedback: fA.negative,
        },
        {
          group: 'B',
          versionId: exp.templateBId,
          meetingsCount: groupBIds.length,
          positiveFeedback: fB.positive,
          negativeFeedback: fB.negative,
        },
      ],
    };
  }

  // ─── allocation (для PromptResolver) ──────────────────────────────────

  /**
   * Sticky-allocation: ` hash(meetingId + experimentId) % 100 < splitPercent`
   * → группа B, иначе A. На retry/regenerate одного meeting'а попадает в ту же группу.
   *
   * Реализация хэша — FNV-1a 32-bit. Не криптостойкий, но детерминированный и
   * быстрый. Достаточно для распределения трафика.
   *
   * Возвращает null если эксперимента нет или он не в статусе 'running' —
   * вызывающий должен использовать обычный резолв.
   */
  async resolveAllocation(args: {
    meetingId: string;
    orgId: string;
    taskType: string;
    meetingType: string | null;
  }): Promise<{
    experimentId: string;
    group: 'A' | 'B';
    versionId: string;
  } | null> {
    try {
      const experiments = await this.findActiveForOrg(args);
      for (const exp of experiments) {
        const group = stickyAllocate(args.meetingId, exp.id, exp.splitPercent);
        const versionId = group === 'A' ? exp.templateAId : exp.templateBId;
        // Также удостоверимся, что верcия и шаблон ещё актуальны.
        return { experimentId: exp.id, group, versionId };
      }
      return null;
    } catch (err) {
      this.logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          meetingId: args.meetingId,
        },
        'prompt-experiment allocation failed → null',
      );
      return null;
    }
  }

  /**
   * Cron-helper — переводит эксперименты с `endsAt < now` в `completed`.
   * Должен вызываться workers/scheduler'ом (отдельный @Cron не входит в A.3:
   * orchestrator может запускать вручную в смок-тестах).
   */
  async expireDue(): Promise<{ expired: number }> {
    const now = new Date();
    const due = await this.prisma.promptExperiment.findMany({
      where: { status: 'running', endsAt: { lte: now, not: null } },
      select: { id: true, orgId: true },
    });
    if (due.length === 0) return { expired: 0 };
    await this.prisma.promptExperiment.updateMany({
      where: { id: { in: due.map((x) => x.id) } },
      data: { status: 'completed' },
    });
    for (const _e of due) {
      this.metrics?.incPromptExperimentCompleted({ reason: 'expired' });
    }
    await this.refreshActiveCount();
    this.logger.log({ count: due.length }, 'prompt-experiments auto-completed by endsAt');
    return { expired: due.length };
  }

  // ─── internals ────────────────────────────────────────────────────────

  private async findActiveForOrg(args: {
    orgId: string;
    taskType: string;
    meetingType: string | null;
  }): Promise<
    Array<
      PromptExperiment & {
        templateA: PromptTemplateVersion & { template: { taskType: string; meetingType: string | null } };
        templateB: PromptTemplateVersion & { template: { taskType: string; meetingType: string | null } };
      }
    >
  > {
    // 1) Org-эксперименты этой Org'и; 2) глобальные (orgId=null) — fallback.
    const candidates = await this.prisma.promptExperiment.findMany({
      where: {
        status: 'running',
        OR: [{ orgId: args.orgId }, { orgId: null }],
      },
      include: {
        templateA: { include: { template: true } },
        templateB: { include: { template: true } },
      },
      orderBy: [{ orgId: 'asc' }, { createdAt: 'desc' }],
    });
    return candidates.filter((e) => {
      const taskOk = e.templateA.template.taskType === args.taskType;
      const meetingOk =
        e.templateA.template.meetingType === args.meetingType ||
        e.templateA.template.meetingType === null;
      return taskOk && meetingOk;
    }) as never;
  }

  private parseEndsAt(input: string | null): Date | null {
    if (!input) return null;
    const t = new Date(input);
    if (Number.isNaN(t.getTime())) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_ends_at' },
      });
    }
    const diff = t.getTime() - Date.now();
    if (diff < EXPERIMENT_MIN_DURATION_MS) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'ends_at_too_close', minHours: 1 },
      });
    }
    if (diff > EXPERIMENT_MAX_DURATION_MS) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'ends_at_too_far', maxDays: 30 },
      });
    }
    return t;
  }

  private assertTemplateBelongsToExperiment(
    template: { scope: string; orgId: string | null },
    expOrgId: string | null,
    label: 'A' | 'B',
  ): void {
    if (expOrgId === null) {
      // Глобальный — только system-шаблоны.
      if (template.scope !== 'system') {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'global_experiment_requires_system_templates',
            side: label,
          },
        });
      }
      return;
    }
    // Org-эксперимент: каждый шаблон должен быть либо system, либо org с тем же orgId.
    if (template.scope === 'system') return;
    if (template.scope === 'org' && template.orgId === expOrgId) return;
    throw new BadRequestException({
      ok: false,
      error: {
        code: 'template_org_mismatch',
        side: label,
      },
    });
  }

  private assertCanAccess(exp: PromptExperiment, rbac: ExperimentRbacContext): void {
    if (rbac.isSuperAdmin) return;
    if (exp.orgId !== null && rbac.ownedOrgIds.includes(exp.orgId)) return;
    throw new ForbiddenException({
      ok: false,
      error: { code: 'no_access_to_experiment', id: exp.id },
    });
  }

  private async refreshActiveCount(): Promise<void> {
    try {
      const count = await this.prisma.promptExperiment.count({
        where: { status: 'running' },
      });
      this.metrics?.setPromptExperimentActiveCount({ count });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'refreshActiveCount fail',
      );
    }
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

/** FNV-1a 32-bit детерминированный хэш. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Sticky-allocation. ВНИМАНИЕ: экспортируется ради юнит-тестов.
 *
 *   group = hash(meetingId + experimentId) % 100 < splitPercent ? 'B' : 'A'.
 *
 * splitPercent=0  → всегда 'A'.
 * splitPercent=100 → всегда 'B'.
 */
export function stickyAllocate(
  meetingId: string,
  experimentId: string,
  splitPercent: number,
): 'A' | 'B' {
  if (splitPercent <= 0) return 'A';
  if (splitPercent >= 100) return 'B';
  const h = fnv1a(`${meetingId}:${experimentId}`);
  return h % 100 < splitPercent ? 'B' : 'A';
}

function appendNote(prev: string | null, addition: string): string {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${addition}`;
  return prev ? `${prev}\n${line}` : line;
}
