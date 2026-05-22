import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { MeetingType, PromptTemplate, PromptTemplateSection, PromptTemplateVersion } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PromptExperimentsService } from '../../admin/prompt-templates/prompt-experiments.service';

import { codeFallbackForMeeting } from './code-fallback.adapter';
import type {
  PromptResolverTaskType,
  ResolveForMeetingParams,
  ResolvedPrompt,
  ResolvedPromptSection,
} from './prompt-resolver.types';

/**
 * PromptResolverService — Фаза A.1.
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §5.
 *
 * Резолвит промпт AI-отчёта для analyze.worker'а по приоритету:
 *
 *   1. (TODO Фаза A.3) Активный `PromptExperiment` Org'а → A или B по хэшу meetingId.
 *   2. Org-override: PromptTemplate.scope='org' + status='active' + orgId=tenantId.
 *   3. System: PromptTemplate.scope='system' + status='active'.
 *   4. code-fallback: встроенный `ai/services/prompts/type-*.ts`.
 *
 * Любая ошибка БД → code-fallback + лог warn + метрика
 * `z_prompt_resolver_fallback_total{reason="db_error"}`. Это критично для
 * устойчивости pipeline: AI-отчёт всегда должен сгенериться, даже если
 * БД упала.
 *
 * В A.1 пункт 1 (PromptExperiment) не активен — модель заведена, но
 * резолвер ещё не использует её. Будет включено в A.3.
 */
@Injectable()
export class PromptResolverService {
  private readonly logger = new Logger(PromptResolverService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // Метрики опциональны для unit-тестов (по аналогии с LlmFallbackService).
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    // Фаза A.3 — поиск активного PromptExperiment'а для tenantId.
    // Optional, чтобы unit-тесты резолвера могли работать без AdminModule.
    @Optional()
    @Inject(PromptExperimentsService)
    private readonly experiments?: PromptExperimentsService,
  ) {}

  /**
   * Главная точка входа. Возвращает unified `ResolvedPrompt` независимо от
   * того, откуда он пришёл — БД, code-fallback или experiment.
   *
   * Never throws (фоллбек на code). Все ошибки логируются как `warn`.
   */
  async resolveForMeeting(params: ResolveForMeetingParams): Promise<ResolvedPrompt> {
    const { tenantId, meetingId, meetingType, taskType } = params;

    // 0. Фаза A.3 — проверяем активный PromptExperiment для tenantId+taskType.
    // Если попадаем — возвращаем версию A/B вместо обычного резолва.
    if (this.experiments) {
      try {
        const allocation = await this.experiments.resolveAllocation({
          meetingId,
          orgId: tenantId,
          taskType,
          meetingType,
        });
        if (allocation) {
          const expPrompt = await this.loadExperimentPrompt(allocation.versionId);
          if (expPrompt) {
            const source: 'db_org' | 'db_system' = expPrompt.template.scope === 'org' ? 'db_org' : 'db_system';
            const result = this.toResolvedPrompt(expPrompt.template, expPrompt.version, source);
            result.experimentGroup = allocation.group;
            this.metrics?.incPromptResolver({ source });
            return result;
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'prompt-resolver: experiment resolve failed → обычный путь',
        );
      }
    }

    // 1. Попытка резолва через БД. Любая ошибка — фоллбек на код.
    try {
      const fromDb = await this.tryResolveFromDb(tenantId, meetingType, taskType);
      if (fromDb) {
        this.metrics?.incPromptResolver({ source: fromDb.source });
        return fromDb;
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          taskType,
          meetingType,
          err: err instanceof Error ? err.message : String(err),
        },
        'prompt-resolver: db error → code-fallback',
      );
      this.metrics?.incPromptResolverFallback({ reason: 'db_error' });
      const out = codeFallbackForMeeting(meetingType as MeetingType, taskType);
      this.metrics?.incPromptResolver({ source: 'code_fallback' });
      return out;
    }

    // 2. БД пустая (нет ни org-, ни system-шаблона). Это нормально до seed'а.
    this.metrics?.incPromptResolverFallback({ reason: 'db_empty' });
    const fallback = codeFallbackForMeeting(meetingType as MeetingType, taskType);
    this.metrics?.incPromptResolver({ source: 'code_fallback' });
    return fallback;
  }

  /**
   * Resolve-only-from-DB. Возвращает null если активного шаблона нет;
   * throws — только при реальной ошибке БД (callee делает фоллбек).
   *
   * Маркер активного шаблона: status='active' + activeVersionId != null +
   * deletedAt = null.
   */
  private async tryResolveFromDb(
    tenantId: string,
    meetingType: string,
    taskType: PromptResolverTaskType,
  ): Promise<ResolvedPrompt | null> {
    // Шаг 1: попытка найти Org-override.
    const orgTemplate = await this.findActiveTemplate({
      orgId: tenantId,
      meetingType,
      taskType,
    });
    if (orgTemplate?.activeVersion) {
      return this.toResolvedPrompt(orgTemplate, orgTemplate.activeVersion, 'db_org');
    }

    // Шаг 2: фоллбек на системный шаблон (orgId=null).
    const systemTemplate = await this.findActiveTemplate({
      orgId: null,
      meetingType,
      taskType,
    });
    if (systemTemplate?.activeVersion) {
      return this.toResolvedPrompt(systemTemplate, systemTemplate.activeVersion, 'db_system');
    }

    return null;
  }

  /**
   * Поиск активного шаблона по (orgId, meetingType, taskType).
   *
   * Сначала смотрим точное совпадение по meetingType. Если такого нет, ищем
   * шаблон с meetingType=null (универсальный). Это позволяет tasks/chapters/
   * follow-up/card-rollup-default работать одним шаблоном для всех типов.
   */
  private async findActiveTemplate(args: {
    orgId: string | null;
    meetingType: string;
    taskType: PromptResolverTaskType;
  }): Promise<(PromptTemplate & { activeVersion: VersionWithSections | null }) | null> {
    const baseWhere = {
      orgId: args.orgId,
      taskType: args.taskType,
      status: 'active' as const,
      deletedAt: null,
    };

    // 1. С точным meetingType.
    const exact = await this.prisma.promptTemplate.findFirst({
      where: { ...baseWhere, meetingType: args.meetingType as MeetingType },
      include: { activeVersion: { include: { sections: { orderBy: { order: 'asc' } } } } },
    });
    if (exact) return exact;

    // 2. Универсальный (meetingType=null).
    return this.prisma.promptTemplate.findFirst({
      where: { ...baseWhere, meetingType: null },
      include: { activeVersion: { include: { sections: { orderBy: { order: 'asc' } } } } },
    });
  }

  /**
   * Фаза A.3 — загрузить версию + шаблон по versionId (для эксперимента).
   * Возвращает null если версия удалена или шаблон в deletedAt.
   */
  private async loadExperimentPrompt(
    versionId: string,
  ): Promise<{
    template: PromptTemplate;
    version: VersionWithSections;
  } | null> {
    const version = await this.prisma.promptTemplateVersion.findUnique({
      where: { id: versionId },
      include: {
        sections: { orderBy: { order: 'asc' } },
        template: true,
      },
    });
    if (!version || version.template.deletedAt) return null;
    return {
      template: version.template,
      version: { ...version, sections: version.sections },
    };
  }

  /**
   * Маппер PromptTemplate + Version → ResolvedPrompt. JSON outputSchema
   * хранится в БД как Prisma.Json, поэтому здесь делаем безопасное приведение.
   */
  private toResolvedPrompt(
    _template: PromptTemplate,
    version: VersionWithSections,
    source: 'db_org' | 'db_system',
  ): ResolvedPrompt {
    const schema = version.outputSchema as ResolvedPrompt['outputSchema'];
    return {
      source,
      versionId: version.id,
      systemPrompt: version.systemPrompt,
      toolName: version.toolName ?? null,
      sections: version.sections.map(sectionFromDb),
      outputSchema: {
        type: 'object',
        properties: schema?.properties ?? {},
        required: schema?.required,
        additionalProperties: schema?.additionalProperties,
      },
    };
  }
}

type VersionWithSections = PromptTemplateVersion & { sections: PromptTemplateSection[] };

function sectionFromDb(s: PromptTemplateSection): ResolvedPromptSection {
  return {
    key: s.key,
    title: s.title,
    instruction: s.instruction,
    outputType: s.outputType,
    required: s.required,
    maxTokens: s.maxTokens ?? null,
  };
}
