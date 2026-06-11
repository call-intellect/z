import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AiQueueService } from '../ai-queue.service';

import { LlmRouterService } from './llm-router.service';
import { applyInputGuards } from './prompts/common';
import {
  REGENERATE_SECTION_JSON_SCHEMA,
  REGENERATE_SECTION_TASK_TYPE,
  buildRegenerateSectionPrompt,
} from './prompts/regenerate-section';

export class RegenerateConflictError extends Error {
  constructor(readonly meetingId: string, readonly currentVersion: number) {
    super(`recap_version_mismatch: meeting=${meetingId} current=${currentVersion}`);
    this.name = 'RegenerateConflictError';
  }
}

export class RegenerateForbiddenError extends Error {
  constructor() {
    super('forbidden');
    this.name = 'RegenerateForbiddenError';
  }
}

export class QuotaExceededError extends Error {
  constructor(readonly limit: number, readonly windowHours: number) {
    super(`quota_exceeded: limit=${limit} window=${windowHours}h`);
    this.name = 'QuotaExceededError';
  }
}

export interface RegenerateMeetingInput {
  meetingId: string;
  userId: string;
  expectedRecapVersion: number;
  /** UserTemplate.id (опц.) — analyze.worker возьмёт его prompt вместо стандартного. */
  templateId?: string;
}

export interface RegenerateSectionInput {
  meetingId: string;
  userId: string;
  expectedRecapVersion: number;
  sectionKey: string;
  /** Опц. инструкция от пользователя. */
  userInstruction?: string;
}

/**
 * Сервис регенерации AI-отчёта.
 *
 *   - `regenerateMeeting` — полная регенерация: bumps recapVersion, сбрасывает
 *     analyze/chapters/tasks статусы, ставит analyze (с опц. templateId).
 *     Embeddings НЕ перезапускаем — текст транскрипта не менялся.
 *   - `regenerateSection` — частичная: одна секция через `LlmRouter`
 *     с `taskType='regenerate-section'`. recapVersion инкрементируется.
 *     Не трогает chapters/tasks/embeddings.
 *
 * Optimistic lock — `expectedRecapVersion` сравнивается атомарно через
 * `prisma.meeting.update` с `where: { id, recapVersion }`.
 *
 * Квота — `MAX_REGENERATE_PER_MEETING_PER_DAY` через прямой counter на
 * `AuditLog.action='meeting.regenerate'` за последние 24 часа.
 */
@Injectable()
export class RegenerateService {
  private readonly logger = new Logger(RegenerateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiQueueService) private readonly queue: AiQueueService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async regenerateMeeting(
    input: RegenerateMeetingInput,
  ): Promise<{ recapVersion: number }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        ownerId: true,
        recapVersion: true,
        type: true,
        cardId: true,
      },
    });
    if (!meeting) {
      throw new Error(`regenerateMeeting: meeting ${input.meetingId} не найден`);
    }
    if (meeting.ownerId !== input.userId) {
      // Admin-ветку оставляем caller'у (контроллер проверит роль).
      throw new RegenerateForbiddenError();
    }
    if (meeting.recapVersion !== input.expectedRecapVersion) {
      throw new RegenerateConflictError(meeting.id, meeting.recapVersion);
    }
    await this.checkRegenerateQuota(input.meetingId);

    // Optimistic lock через where.
    let updated;
    try {
      updated = await this.prisma.meeting.update({
        where: {
          id: input.meetingId,
          recapVersion: input.expectedRecapVersion,
        },
        data: {
          recapVersion: { increment: 1 },
          chaptersStatus: 'queued',
          tasksStatus: 'queued',
          status: 'ai_processing',
        },
        select: { recapVersion: true },
      });
    } catch (err) {
      // P2025 — record not found → версия успела измениться.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new RegenerateConflictError(meeting.id, meeting.recapVersion);
      }
      throw err;
    }

    // Audit-лог. Не падаем, если запись не удастся.
    await this.prisma.auditLog
      .create({
        data: {
          userId: input.userId,
          action: 'meeting.regenerate',
          resourceId: input.meetingId,
          metadata: {
            templateId: input.templateId ?? null,
            from: input.expectedRecapVersion,
            to: updated.recapVersion,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `regenerateMeeting audit: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

    // Перезапускаем analyze + chapters + tasks. Embeddings НЕ трогаем.
    await Promise.all([
      this.queue.enqueueAnalyzeWithTemplate(
        input.meetingId,
        updated.recapVersion,
        input.templateId,
      ),
      this.queue.enqueueChapters(input.meetingId, updated.recapVersion),
      this.queue.enqueueTasksExtract(input.meetingId, updated.recapVersion),
    ]);

    this.logger.log(
      {
        meetingId: input.meetingId,
        userId: input.userId,
        recapVersion: updated.recapVersion,
        templateId: input.templateId,
      },
      'regenerateMeeting: запущено',
    );
    return { recapVersion: updated.recapVersion };
  }

  /**
   * Регенерирует одну секцию `AiResult.structuredData[sectionKey]`.
   * recapVersion инкрементируется (для UI-инвалидации). Other sections — не меняются.
   */
  async regenerateSection(
    input: RegenerateSectionInput,
  ): Promise<{ recapVersion: number; newSectionValue: unknown }> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: input.meetingId },
      select: {
        id: true,
        ownerId: true,
        tenantId: true,
        recapVersion: true,
        type: true,
        title: true,
        cardId: true,
        transcript: { select: { turns: true } },
        aiResult: { select: { structuredData: true } },
      },
    });
    if (!meeting) {
      throw new Error(`regenerateSection: meeting ${input.meetingId} не найден`);
    }
    if (meeting.ownerId !== input.userId) {
      throw new RegenerateForbiddenError();
    }
    if (meeting.recapVersion !== input.expectedRecapVersion) {
      throw new RegenerateConflictError(meeting.id, meeting.recapVersion);
    }
    await this.checkRegenerateQuota(input.meetingId);

    const structured =
      (meeting.aiResult?.structuredData as Record<string, unknown> | null | undefined) ??
      {};
    const currentValue = structured[input.sectionKey] ?? null;
    const otherSections: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(structured)) {
      if (k !== input.sectionKey) otherSections[k] = v;
    }

    const turns = (meeting.transcript?.turns as Array<{ speaker: string; text: string }> | null) ?? [];
    const mergedTranscriptText = turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');

    const prompt = buildRegenerateSectionPrompt({
      meeting: {
        id: meeting.id,
        type: meeting.type,
        title: meeting.title,
      },
      sectionKey: input.sectionKey,
      currentValue,
      otherSections,
      mergedTranscriptText,
      ...(input.userInstruction !== undefined
        ? { userInstruction: input.userInstruction }
        : {}),
    });

    // A2-AI: вход — сырой транскрипт встречи + пользовательская инструкция к
    // секции. Оборачиваем user в маркеры данных + ASR-нота. Глобальный
    // kill-switch читаем из TypedConfigService (дефолт ON).
    const guardOn =
      this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(prompt.system, prompt.user, {
      enabled: guardOn,
      injection: true,
      asr: true,
    });

    const result = await this.router.call({
      taskType: REGENERATE_SECTION_TASK_TYPE,
      systemPrompt: guarded.system,
      userMessage: guarded.user,
      tenantId: meeting.tenantId,
      meetingId: input.meetingId,
      userId: input.userId,
      // T7-F6: strict JSON Schema через wrapper { value: <any> }. Для
      // провайдеров без strict (Ollama / KIE / GRSAI) LlmRouter перейдёт на
      // следующего — DeepSeek/OpenAI/Anthropic справятся.
      responseFormat: {
        type: 'json_schema',
        name: 'regenerate_section_response',
        strict: true,
        schema: REGENERATE_SECTION_JSON_SCHEMA,
      },
      sourceRef: { type: 'meeting', id: input.meetingId },
    });

    const stripped = stripCodeFence(result.text);
    let newSectionValue: unknown;
    try {
      const parsed = JSON.parse(stripped) as unknown;
      // T7-F6: гибко принимаем и { value: ... } (новый wrapper), и голый
      // payload (legacy провайдер). Если структура { value } — извлекаем,
      // иначе берём как есть.
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        'value' in (parsed as Record<string, unknown>)
      ) {
        newSectionValue = (parsed as { value: unknown }).value;
      } else {
        newSectionValue = parsed;
      }
    } catch {
      // Если LLM вернул не-JSON (например, простую строку без кавычек) —
      // сохраняем сырой текст. Это допустимо, т.к. секция может быть просто строкой.
      this.metrics?.incPromptInvalidResponse({
        taskType: REGENERATE_SECTION_TASK_TYPE,
        model: result.modelUsed,
        reason: 'json_parse',
      });
      newSectionValue = stripped;
    }

    // Атомарный апдейт с проверкой версии.
    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const m = await tx.meeting.update({
          where: {
            id: input.meetingId,
            recapVersion: input.expectedRecapVersion,
          },
          data: { recapVersion: { increment: 1 } },
          select: { recapVersion: true },
        });
        const newStructured = { ...structured, [input.sectionKey]: newSectionValue };
        await tx.aiResult.update({
          where: { meetingId: input.meetingId },
          data: { structuredData: newStructured as Prisma.InputJsonValue },
        });
        return m;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new RegenerateConflictError(meeting.id, meeting.recapVersion);
      }
      throw err;
    }

    await this.prisma.auditLog
      .create({
        data: {
          userId: input.userId,
          action: 'meeting.regenerate_section',
          resourceId: input.meetingId,
          metadata: {
            sectionKey: input.sectionKey,
            from: input.expectedRecapVersion,
            to: updated.recapVersion,
          } as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);

    // Если встреча в карточке — пересобираем rollup. Особенно важно при
    // регенерации секции `summary` (rollup строится поверх summary встреч).
    if (meeting.cardId) {
      await this.queue
        .enqueueCardRollup(meeting.cardId, 'regenerate')
        .catch((err) =>
          this.logger.warn(
            `regenerateSection: enqueueCardRollup упал: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    return { recapVersion: updated.recapVersion, newSectionValue };
  }

  // ─────────────────────────── private ─────────────────────────────────────

  private async checkRegenerateQuota(meetingId: string): Promise<void> {
    const limit = this.cfg.workspace.maxRegeneratePerMeetingPerDay;
    const windowMs = 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - windowMs);
    const count = await this.prisma.auditLog.count({
      where: {
        resourceId: meetingId,
        action: { in: ['meeting.regenerate', 'meeting.regenerate_section'] },
        createdAt: { gte: since },
      },
    });
    if (count >= limit) {
      throw new QuotaExceededError(limit, 24);
    }
  }
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  if (fence && typeof fence[1] === 'string') return fence[1];
  return trimmed;
}
