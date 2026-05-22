/**
 * Фаза A.3 — AiResultFeedbackService.
 *
 * Хранит и считает фидбек пользователей (👍/👎) на AI-отчёт встречи.
 * Источник: ТЗ A §7.3.
 *
 * Связь: `AiResultFeedback (aiResultId, userId)` UNIQUE — один пользователь
 * может оставить только одну реакцию на один отчёт. Повторный POST с
 * другим `reaction` — апдейт.
 *
 * RBAC при создании: пользователь должен иметь доступ к встрече (быть host'ом,
 * либо participant'ом с поданной cookie). Проверка делегируется контроллеру
 * через MeetingsService.assertCanReadMeeting (см. ниже).
 *
 * Метрика: `z_prompt_template_feedback_total{reaction}` инкрементируется
 * на каждый create + update (обновление = новая реакция = новое событие).
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { AiResultFeedback, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import type {
  CreateFeedbackDto,
  ListFeedbackQueryDto,
  Reaction,
} from './dto/ai-result-feedback.dto';

@Injectable()
export class AiResultFeedbackService {
  private readonly logger = new Logger(AiResultFeedbackService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Upsert feedback по (aiResultId, userId). Если реакция меняется — обновляем,
   * метрика инкрементируется по новой реакции.
   */
  async upsert(args: {
    meetingId: string;
    userId: string;
    dto: CreateFeedbackDto;
  }): Promise<AiResultFeedback> {
    // Найдём AiResult по meetingId.
    const aiResult = await this.prisma.aiResult.findUnique({
      where: { meetingId: args.meetingId },
      select: { id: true },
    });
    if (!aiResult) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ai_result_not_found', meetingId: args.meetingId },
      });
    }
    const reaction = args.dto.reaction as Reaction;

    const upserted = await this.prisma.aiResultFeedback.upsert({
      where: {
        aiResultId_userId: { aiResultId: aiResult.id, userId: args.userId },
      },
      create: {
        aiResultId: aiResult.id,
        userId: args.userId,
        reaction,
        comment: args.dto.comment ?? null,
      },
      update: {
        reaction,
        comment: args.dto.comment ?? null,
      },
    });
    this.metrics?.incPromptTemplateFeedback({ reaction });
    this.logger.log(
      {
        meetingId: args.meetingId,
        aiResultId: aiResult.id,
        userId: args.userId,
        reaction,
      },
      'ai-result feedback upserted',
    );
    return upserted;
  }

  /**
   * Get own feedback (для UI — какая реакция уже стоит у текущего пользователя).
   * Возвращает null если пользователь ещё не оставлял реакцию.
   */
  async getOwn(args: {
    meetingId: string;
    userId: string;
  }): Promise<AiResultFeedback | null> {
    const aiResult = await this.prisma.aiResult.findUnique({
      where: { meetingId: args.meetingId },
      select: { id: true },
    });
    if (!aiResult) return null;
    return this.prisma.aiResultFeedback.findUnique({
      where: {
        aiResultId_userId: { aiResultId: aiResult.id, userId: args.userId },
      },
    });
  }

  /**
   * Удалить собственный фидбек (если передумал ставить). Идемпотентно.
   */
  async deleteOwn(args: { meetingId: string; userId: string }): Promise<{ ok: true }> {
    const aiResult = await this.prisma.aiResult.findUnique({
      where: { meetingId: args.meetingId },
      select: { id: true },
    });
    if (!aiResult) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ai_result_not_found', meetingId: args.meetingId },
      });
    }
    await this.prisma.aiResultFeedback.deleteMany({
      where: { aiResultId: aiResult.id, userId: args.userId },
    });
    return { ok: true };
  }

  // ─── admin list ─────────────────────────────────────────────────────

  async adminList(
    filters: ListFeedbackQueryDto,
    rbac: { isSuperAdmin: boolean; ownedOrgIds: string[] },
  ): Promise<{ items: AiResultFeedbackItem[]; total: number }> {
    if (!rbac.isSuperAdmin && rbac.ownedOrgIds.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'not_org_admin' },
      });
    }

    // 1) Найдём подходящие aiResult'ы.
    const aiResultWhere: Record<string, unknown> = {};
    if (filters.versionId) aiResultWhere['promptTemplateVersionId'] = filters.versionId;
    if (filters.templateId) {
      // Найдём id всех версий этого шаблона.
      const versions = await this.prisma.promptTemplateVersion.findMany({
        where: { templateId: filters.templateId },
        select: { id: true },
      });
      aiResultWhere['promptTemplateVersionId'] = { in: versions.map((v) => v.id) };
    }

    // RBAC фильтр на уровне Org (через Meeting.tenantId; для не-super_admin).
    if (!rbac.isSuperAdmin) {
      aiResultWhere['meeting'] = { tenantId: { in: rbac.ownedOrgIds } };
    }

    // 2) AiResultFeedback фильтр.
    const where: Prisma.AiResultFeedbackWhereInput = {
      ...(filters.reaction ? { reaction: filters.reaction } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
      aiResult: aiResultWhere as never,
    };

    const [items, total] = await Promise.all([
      this.prisma.aiResultFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.offset,
        take: filters.limit,
        include: {
          user: { select: { id: true, email: true, name: true } },
          aiResult: {
            select: {
              meetingId: true,
              meetingType: true,
              promptTemplateVersionId: true,
              promptTemplateVersion: {
                select: {
                  id: true,
                  versionNumber: true,
                  templateId: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.aiResultFeedback.count({ where }),
    ]);

    return { items: items as AiResultFeedbackItem[], total };
  }
}

export interface AiResultFeedbackItem {
  id: string;
  aiResultId: string;
  userId: string;
  reaction: string;
  comment: string | null;
  createdAt: Date;
  user: { id: string; email: string | null; name: string | null };
  aiResult: {
    meetingId: string;
    meetingType: string;
    promptTemplateVersionId: string | null;
    promptTemplateVersion: {
      id: string;
      versionNumber: number;
      templateId: string;
    } | null;
  };
}
