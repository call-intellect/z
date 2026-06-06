/**
 * MeetingReportsService — Фаза E §7.
 *
 * Источник: plans/tz/2026-05-21-phase-E-multi-report-per-meeting.md.
 *
 * Отвечает за CRUD-операции над `MeetingReport` + enqueue в `ai.custom-report`:
 *   - list       — primary `AiResult` + additional `MeetingReport[]` (primary первым).
 *   - get        — полный отчёт (с output).
 *   - create     — entitlement + rate-limit + partial-unique guard + enqueue.
 *   - regenerate — снова enqueue с rate-limit 3/час per report.
 *   - remove     — soft-delete (status='archived').
 */

import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { type Meeting, type MeetingReport, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { AiQueueService } from '../ai/ai-queue.service';
import { EntitlementService } from '../entitlements/entitlement.service';

import type {
  MeetingReportStatusDto,
  ReportDetailDto,
  ReportListItemDto,
} from './dto/meeting-reports.dto';

/**
 * Максимум одновременно живущих (не archived) отчётов на встречу — общий
 * rate-limit, который применяется поверх tier-лимита. ТЗ §7.1.
 */
const TOTAL_REPORTS_LIMIT_PER_MEETING = 10;

const REGENERATE_LIMIT_PER_HOUR = 3;
const REGENERATE_WINDOW_SECONDS = 3600;

const PREVIEW_MAX_CHARS = 200;

@Injectable()
export class MeetingReportsService {
  private readonly logger = new Logger(MeetingReportsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  // ─────────────────────────── public ──────────────────────────

  /**
   * Список отчётов встречи: primary (синтетически из AiResult) + additional
   * (MeetingReport). Primary всегда первым. ТЗ §6.
   */
  async list(meetingId: string, userId: string): Promise<ReportListItemDto[]> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);

    const [aiResult, reports] = await Promise.all([
      this.prisma.aiResult.findUnique({
        where: { meetingId: meeting.id },
        include: {
          promptTemplateVersion: { include: { template: true } },
        },
      }),
      this.prisma.meetingReport.findMany({
        where: { meetingId: meeting.id, deletedAt: null },
        include: { promptTemplate: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const out: ReportListItemDto[] = [];
    if (aiResult) {
      out.push({
        kind: 'primary',
        id: aiResult.id,
        meetingId: meeting.id,
        templateId:
          aiResult.promptTemplateVersion?.templateId ?? null,
        templateName:
          aiResult.promptTemplateVersion?.template.name ??
          `Системный шаблон ${meeting.type}`,
        status: 'ready',
        outputPreview: makePreview(aiResult.summary),
        createdAt: aiResult.createdAt.toISOString(),
        completedAt: aiResult.updatedAt.toISOString(),
        llmCostUsd: null,
        llmDurationMs: null,
        errorMessage: null,
      });
    }
    for (const r of reports) {
      out.push(this.toListItem(r, r.promptTemplate.name));
    }
    return out;
  }

  /** Полный отчёт. */
  async get(
    meetingId: string,
    reportId: string,
    userId: string,
  ): Promise<ReportDetailDto> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);

    // S6-07 (Р4): primary-отчёт list() синтезирует из AiResult с id=aiResult.id.
    // get() обязан отдавать его по тому же id — иначе «Открыть» основного
    // отчёта даёт 404. Ветка только при reportId === aiResult.id (additional
    // отчёты остаются на пути meetingReport.findFirst ниже).
    const aiResult = await this.prisma.aiResult.findUnique({
      where: { meetingId: meeting.id },
      include: { promptTemplateVersion: { include: { template: true } } },
    });
    if (aiResult && reportId === aiResult.id) {
      const output =
        (aiResult.structuredData as unknown) ??
        (aiResult.summary ? { summary: aiResult.summary } : null);
      return {
        kind: 'primary',
        id: aiResult.id,
        meetingId: meeting.id,
        templateId: aiResult.promptTemplateVersion?.templateId ?? null,
        templateName:
          aiResult.promptTemplateVersion?.template.name ??
          `Системный шаблон ${meeting.type}`,
        status: 'ready',
        outputPreview: makePreview(aiResult.summary),
        createdAt: aiResult.createdAt.toISOString(),
        completedAt: aiResult.updatedAt.toISOString(),
        llmCostUsd: null,
        llmDurationMs: null,
        errorMessage: null,
        output,
        promptTemplateVersionId: null,
      };
    }

    const report = await this.prisma.meetingReport.findFirst({
      where: { id: reportId, meetingId: meeting.id, deletedAt: null },
      include: { promptTemplate: true },
    });
    if (!report) throw new NotFoundException('meeting_report_not_found');

    const item = this.toListItem(report, report.promptTemplate.name);
    return {
      ...item,
      output: report.output as unknown,
      promptTemplateVersionId: report.promptTemplateVersionId,
    };
  }

  /**
   * Создать новый отчёт по выбранному шаблону. Enqueue в `ai.custom-report`.
   * Проверки (в порядке):
   *   1. RBAC: хост или Org-Admin.
   *   2. Entitlement-фича `feature.multi_reports_per_meeting`.
   *   3. Tier-лимит (`multi_reports_limit_per_meeting`).
   *   4. Общий лимит 10 на встречу.
   *   5. Шаблон существует, не archived, доступен Org (system или своя Org).
   *   6. Partial-unique: нет pending/running с тем же templateId.
   */
  async create(
    meetingId: string,
    userId: string,
    body: { templateId: string },
  ): Promise<{ id: string; status: MeetingReportStatusDto }> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);
    if (!meeting.tenantId) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'meeting_without_tenant',
            message:
              'У встречи нет привязки к Org (legacy). Доп. отчёты недоступны.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const tenantId = meeting.tenantId;

    // 1. Entitlement: фича.
    const ent = await this.entitlements.getEntitlement(tenantId);
    if (ent.features['feature.multi_reports_per_meeting'] !== true) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'entitlement_required',
          message:
            'Дополнительные отчёты доступны на тарифах Pro / Business / Enterprise.',
          feature: 'feature.multi_reports_per_meeting',
          currentTier: ent.tier,
          upgradeUrl: '/settings/billing',
        },
      });
    }

    // 2. Tier-лимит.
    const tierLimit = ent.quotas['multi_reports_limit_per_meeting'] ?? 0;
    const liveCount = await this.prisma.meetingReport.count({
      where: { meetingId, deletedAt: null },
    });
    if (tierLimit > 0 && liveCount >= tierLimit) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'multi_reports_limit_exceeded',
          message: `На вашем тарифе доступно ${tierLimit} дополнительных отчётов на встречу.`,
          limit: tierLimit,
          currentTier: ent.tier,
        },
      });
    }

    // 3. Общий жёсткий лимит 10 (защита от спама поверх tier'а).
    if (liveCount >= TOTAL_REPORTS_LIMIT_PER_MEETING) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'meeting_reports_total_limit_exceeded',
            message: `На одну встречу не более ${TOTAL_REPORTS_LIMIT_PER_MEETING} дополнительных отчётов.`,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 4. Шаблон.
    const template = await this.prisma.promptTemplate.findFirst({
      where: {
        id: body.templateId,
        deletedAt: null,
        status: 'active',
        OR: [{ scope: 'system' }, { orgId: tenantId }],
      },
      include: { activeVersion: true },
    });
    if (!template) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'prompt_template_not_available',
          message: 'Шаблон не найден или недоступен для вашей Org.',
        },
      });
    }
    if (!template.activeVersionId || !template.activeVersion) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'prompt_template_no_active_version',
            message: 'У шаблона нет активной версии.',
          },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 5. Создание + защита от дубля (pending/running по тому же шаблону).
    //    Полагаемся на partial unique-индекс meeting_report_pending_unique
    //    (см. apply-postgres-init.sql). Если он не применён в окружении —
    //    дополнительно делаем soft-check ниже.
    const existingActive = await this.prisma.meetingReport.findFirst({
      where: {
        meetingId,
        promptTemplateId: template.id,
        status: { in: ['pending', 'running'] },
        deletedAt: null,
      },
    });
    if (existingActive) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'meeting_report_already_pending',
          message:
            'Для этого шаблона уже идёт генерация отчёта. Дождитесь её завершения.',
          reportId: existingActive.id,
        },
      });
    }

    let created: MeetingReport;
    try {
      created = await this.prisma.meetingReport.create({
        data: {
          meetingId,
          tenantId,
          promptTemplateId: template.id,
          promptTemplateVersionId: template.activeVersionId,
          kind: 'additional',
          title: template.name,
          status: 'pending',
          createdById: userId,
        },
      });
    } catch (err) {
      // Если partial unique сработал (race) — переводим в 409.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'meeting_report_already_pending',
            message:
              'Для этого шаблона уже идёт генерация отчёта. Дождитесь её завершения.',
          },
        });
      }
      throw err;
    }

    // 6. Enqueue.
    await this.queue.enqueueCustomReport(created.id, meetingId);
    this.metrics?.incMeetingReportCreated?.({ kind: 'additional' });
    this.logger.log(
      {
        meetingId,
        reportId: created.id,
        templateId: template.id,
        tenantId,
        userId,
      },
      'meeting-reports: создан и поставлен в очередь',
    );
    return { id: created.id, status: 'pending' };
  }

  /**
   * Регенерация отчёта (rate-limit 3/час). Сбрасывает output, статус → pending,
   * заново ставит в очередь.
   */
  async regenerate(
    meetingId: string,
    reportId: string,
    userId: string,
    body: { useVersionId?: string },
  ): Promise<{ id: string; status: MeetingReportStatusDto }> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);

    const report = await this.prisma.meetingReport.findFirst({
      where: { id: reportId, meetingId, deletedAt: null },
      include: { promptTemplate: { include: { activeVersion: true } } },
    });
    if (!report) throw new NotFoundException('meeting_report_not_found');
    if (report.status === 'pending' || report.status === 'running') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'meeting_report_already_running',
          message: 'Отчёт уже в процессе генерации.',
        },
      });
    }

    // Rate-limit 3/час per report.
    const key = `mr:regen:${reportId}`;
    const client = this.redis.client;
    const current = await client.incr(key);
    if (current === 1) {
      await client.expire(key, REGENERATE_WINDOW_SECONDS);
    }
    if (current > REGENERATE_LIMIT_PER_HOUR) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'rate_limit_exceeded',
            message: 'Превышен лимит регенерации отчёта: 3 раза в час.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Резолв версии: явный useVersionId или текущая active версия шаблона.
    let versionId = report.promptTemplateVersionId;
    if (body.useVersionId) {
      const v = await this.prisma.promptTemplateVersion.findFirst({
        where: { id: body.useVersionId, templateId: report.promptTemplateId },
      });
      if (!v) {
        throw new NotFoundException({
          ok: false,
          error: {
            code: 'prompt_template_version_not_found',
            message: 'Указанная версия шаблона не найдена.',
          },
        });
      }
      versionId = v.id;
    } else if (report.promptTemplate.activeVersionId) {
      versionId = report.promptTemplate.activeVersionId;
    }

    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: {
        status: 'pending',
        output: Prisma.DbNull,
        errorMessage: null,
        llmCostUsd: null,
        llmDurationMs: null,
        completedAt: null,
        promptTemplateVersionId: versionId,
        title: report.promptTemplate.name,
      },
    });

    await this.queue.enqueueCustomReport(report.id, meetingId, 'regenerate');
    this.metrics?.incMeetingReportRegenerated?.();
    this.logger.log(
      { meetingId, reportId: report.id, userId },
      'meeting-reports: regenerate enqueued',
    );
    return { id: report.id, status: 'pending' };
  }

  /** Soft-delete отчёта. ТЗ §7.1. */
  async remove(
    meetingId: string,
    reportId: string,
    userId: string,
  ): Promise<void> {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);

    const report = await this.prisma.meetingReport.findFirst({
      where: { id: reportId, meetingId, deletedAt: null },
    });
    if (!report) throw new NotFoundException('meeting_report_not_found');

    await this.prisma.meetingReport.update({
      where: { id: report.id },
      data: { status: 'archived', deletedAt: new Date() },
    });
    this.metrics?.incMeetingReportDeleted?.();
    this.logger.log(
      { meetingId, reportId: report.id, userId },
      'meeting-reports: archived',
    );
  }

  /**
   * Список доступных Org шаблонов для модалки «Добавить отчёт».
   * Системные + Org-овские, status='active', deletedAt=null.
   */
  async listAvailableTemplates(
    meetingId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      scope: 'system' | 'org';
      name: string;
      description: string | null;
      meetingType: string | null;
      taskType: string;
    }>
  > {
    const meeting = await this.findMeetingOr404(meetingId);
    await this.ensureHostOrOrgAdmin(meeting, userId);
    if (!meeting.tenantId) return [];
    const items = await this.prisma.promptTemplate.findMany({
      where: {
        deletedAt: null,
        status: 'active',
        activeVersionId: { not: null },
        OR: [{ scope: 'system' }, { orgId: meeting.tenantId }],
      },
      select: {
        id: true,
        scope: true,
        name: true,
        description: true,
        meetingType: true,
        taskType: true,
      },
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
    return items.map((t) => ({
      id: t.id,
      scope: t.scope,
      name: t.name,
      description: t.description,
      meetingType: t.meetingType,
      taskType: t.taskType,
    }));
  }

  // ─────────────────────────── private ──────────────────────────

  private toListItem(
    r: MeetingReport,
    templateName: string,
  ): ReportListItemDto {
    return {
      kind: r.kind === 'primary' ? 'primary' : 'additional',
      id: r.id,
      meetingId: r.meetingId,
      templateId: r.promptTemplateId,
      templateName: r.title || templateName,
      status: r.status as MeetingReportStatusDto,
      outputPreview: makePreviewFromOutput(r.output),
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      llmCostUsd: r.llmCostUsd ? Number(r.llmCostUsd) : null,
      llmDurationMs: r.llmDurationMs ?? null,
      errorMessage: r.errorMessage ?? null,
    };
  }

  private async findMeetingOr404(meetingId: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException('meeting_not_found');
    return meeting;
  }

  private async ensureHostOrOrgAdmin(
    meeting: Meeting,
    userId: string,
  ): Promise<void> {
    if (meeting.ownerId === userId) return;
    if (meeting.tenantId && (await this.isOrgAdminOrOwner(meeting.tenantId, userId))) {
      return;
    }
    throw new ForbiddenException('not_authorised_for_meeting_reports');
  }

  private async isOrgAdminOrOwner(
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    const m = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId },
      select: { role: true },
    });
    if (!m) return false;
    return m.role === 'owner' || m.role === 'admin';
  }
}

// ────────────────────────── helpers ──────────────────────────

function makePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.length > PREVIEW_MAX_CHARS
    ? trimmed.slice(0, PREVIEW_MAX_CHARS) + '…'
    : trimmed;
}

/**
 * Сжать первое строковое поле из JSON-output для отображения превью.
 * Берём первое не-пустое строковое значение из верхнего уровня объекта.
 */
function makePreviewFromOutput(output: unknown): string | null {
  if (!output || typeof output !== 'object') return null;
  for (const v of Object.values(output as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length > 0) {
      return makePreview(v);
    }
    if (Array.isArray(v) && v.length > 0) {
      const first = v[0];
      if (typeof first === 'string') return makePreview(first);
      if (typeof first === 'object' && first !== null) {
        for (const inner of Object.values(first as Record<string, unknown>)) {
          if (typeof inner === 'string' && inner.trim().length > 0) {
            return makePreview(inner);
          }
        }
      }
    }
  }
  return null;
}
