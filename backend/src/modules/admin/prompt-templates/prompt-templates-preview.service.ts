/**
 * Фаза A.2 — PromptTemplatesPreviewService.
 *
 * Запуск preview-генерации на синтетической demo-встрече.
 * Источник: ТЗ A §9.
 *
 * Алгоритм:
 *   1. Берём шаблон + конкретную версию (если versionId не задан — активная,
 *      иначе последняя draft).
 *   2. Подгружаем demo-meeting JSON из `backend/test-fixtures/demo-meetings/`.
 *   3. Собираем prompt (system + сводка демо-встречи как user-message).
 *   4. Вызываем LlmRouterService с taskType='summary' и dataClass='internal'.
 *   5. Возвращаем результат + cost + duration.
 *
 * Rate-limit и cost-limit:
 *   - 10 preview/час на user — простая in-memory защёлка (ResetMap).
 *     В production хорошо бы перевести на Redis-bucket, но Docker выключен,
 *     поэтому ограничиваемся in-process.
 *   - $0.20 на preview — если стоимость превысила, пишем warning + метрика.
 *     Само вызов не отменяется (это уже после-фактум), но в response придёт
 *     `costOverBudget: true`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import type { PromptTemplateSection, PromptTemplateVersion } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';

import type { DemoMeetingKey, PreviewPromptDto } from './dto/prompt-templates.dto';
import { AdminPromptTemplatesService } from './prompt-templates.service';

const PREVIEW_RATE_LIMIT_PER_HOUR = 10;
const PREVIEW_COST_LIMIT_USD = 0.2;

interface DemoMeeting {
  key: string;
  type: string;
  durationSec: number;
  participants: Array<{ name: string; role?: string }>;
  /** Уже готовый merged-транскрипт (склейка по таймстампам). */
  transcript: Array<{ speaker: string; text: string; ts?: number }>;
}

export interface PreviewResult {
  source: 'db_draft' | 'db_active';
  templateId: string;
  versionId: string;
  versionNumber: number;
  demoMeetingKey: DemoMeetingKey;
  text: string;
  durationMs: number;
  costUsd: number;
  costOverBudget: boolean;
  modelUsed: string;
  inputTokens: number;
  outputTokens: number;
}

@Injectable()
export class PromptTemplatesPreviewService {
  private readonly logger = new Logger(PromptTemplatesPreviewService.name);
  /** Map<userId, Array<timestamps_in_last_hour>>. */
  private readonly recentByUser = new Map<string, number[]>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminPromptTemplatesService)
    private readonly templates: AdminPromptTemplatesService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async runPreview(
    templateId: string,
    dto: PreviewPromptDto,
    userId: string,
  ): Promise<PreviewResult> {
    this.assertRateLimit(userId);

    // Выбор версии: явная → активная → последняя.
    const tpl = await this.templates.detail(templateId);
    const resolved = await this.resolveVersion(tpl, dto.versionId);
    const { version, source } = resolved;

    const demo = this.loadDemoMeeting(dto.demoMeetingKey);

    const systemPrompt = this.buildSystemPrompt(version);
    const userMessage = this.buildUserMessage(demo);

    // A2: оборачиваем сырой транскрипт demo-встречи в анти-инъекционные маркеры.
    // asr:true — это транскрипт (демо). У сервиса нет TypedConfigService —
    // глобальный kill-switch здесь не гейтит (enabled по умолчанию true);
    // конструктор ради флага не расширяем.
    const guarded = applyInputGuards(systemPrompt, userMessage, {
      injection: true,
      asr: true,
    });

    const startedAt = Date.now();
    try {
      const res = await this.router.call({
        taskType: 'summary',
        systemPrompt: guarded.system,
        userMessage: guarded.user,
        // Tenant неизвестен на preview-уровне (super_admin запускает за себя).
        // null допустимо по контракту LlmRouterService.
        tenantId: null,
        userId,
        dataClass: 'internal',
        sourceRef: { type: 'prompt_template_preview', id: tpl.id },
      });
      const durationMs = Date.now() - startedAt;
      // costUsd напрямую из LlmCallResult не приходит. Метрика и логи
      // фиксируют его в AiUsageLog, здесь оцениваем приближённо через
      // input/output tokens × средний прайс (для UI достаточно). Точное
      // значение остаётся в AiUsageLog.
      const approxCost = this.approximateCost(
        res.inputTokens,
        res.outputTokens,
      );
      const costOverBudget = approxCost > PREVIEW_COST_LIMIT_USD;
      if (costOverBudget) {
        this.logger.warn(
          {
            templateId: tpl.id,
            versionId: version.id,
            userId,
            approxCost,
            limit: PREVIEW_COST_LIMIT_USD,
          },
          'preview: approxCost exceeds limit',
        );
        this.metrics?.incPromptTemplatePreview({ result: 'cost_limit' });
      } else {
        this.metrics?.incPromptTemplatePreview({ result: 'success' });
      }
      this.recordHit(userId);

      return {
        source,
        templateId: tpl.id,
        versionId: version.id,
        versionNumber: version.versionNumber,
        demoMeetingKey: dto.demoMeetingKey,
        text: res.text,
        durationMs,
        costUsd: approxCost,
        costOverBudget,
        modelUsed: res.modelUsed,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      };
    } catch (err) {
      this.metrics?.incPromptTemplatePreview({ result: 'error' });
      this.logger.error(
        {
          templateId: tpl.id,
          versionId: version?.id,
          userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'preview: LLM call failed',
      );
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'preview_llm_failed',
          message: err instanceof Error ? err.message : 'unknown LLM error',
        },
      });
    }
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private async resolveVersion(
    tpl: { id: string; activeVersionId: string | null },
    explicitVersionId: string | undefined,
  ): Promise<{
    version: PromptTemplateVersion & { sections: PromptTemplateSection[] };
    source: 'db_active' | 'db_draft';
  }> {
    if (explicitVersionId) {
      const v = await this.templates.getVersion(tpl.id, explicitVersionId);
      return {
        version: v,
        source: tpl.activeVersionId === v.id ? 'db_active' : 'db_draft',
      };
    }
    if (tpl.activeVersionId) {
      const v = await this.templates.getVersion(tpl.id, tpl.activeVersionId);
      return { version: v, source: 'db_active' };
    }
    const last = await this.prisma.promptTemplateVersion.findFirst({
      where: { templateId: tpl.id },
      orderBy: { versionNumber: 'desc' },
      include: { sections: { orderBy: { order: 'asc' } } },
    });
    if (!last) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'no_version_to_preview', templateId: tpl.id },
      });
    }
    return { version: last, source: 'db_draft' };
  }

  private assertRateLimit(userId: string): void {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const hits = (this.recentByUser.get(userId) ?? []).filter(
      (t) => t > windowStart,
    );
    if (hits.length >= PREVIEW_RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'preview_rate_limited',
          limit: PREVIEW_RATE_LIMIT_PER_HOUR,
          windowSeconds: 3600,
        },
      });
    }
  }

  private recordHit(userId: string): void {
    const now = Date.now();
    const windowStart = now - 60 * 60 * 1000;
    const arr = (this.recentByUser.get(userId) ?? []).filter(
      (t) => t > windowStart,
    );
    arr.push(now);
    this.recentByUser.set(userId, arr);
  }

  /**
   * Чтение demo-meeting JSON из `backend/test-fixtures/demo-meetings/`.
   * Файлы лежат рядом с backend root (НЕ src/), путь от dist/...
   *
   * Используем `process.cwd()` + относительный путь — при dev и build
   * `cwd = backend/`. В тестах путь резолвится из текущей рабочей директории
   * tests-runner'а.
   */
  private loadDemoMeeting(key: DemoMeetingKey): DemoMeeting {
    const path = join(process.cwd(), 'test-fixtures', 'demo-meetings', `${key}.json`);
    try {
      const raw = readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as DemoMeeting;
      return parsed;
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'demo_meeting_not_found',
          key,
          path,
          message: err instanceof Error ? err.message : 'failed to read fixture',
        },
      });
    }
  }

  /**
   * Сборка system-промпта: используем `version.systemPrompt` как базу,
   * добавляем перечень секций с инструкциями. Это эмулирует
   * `prompt-renderer` из A.1, упрощённо для preview.
   */
  private buildSystemPrompt(
    version: PromptTemplateVersion & { sections: PromptTemplateSection[] },
  ): string {
    const lines: string[] = [version.systemPrompt];
    if (version.sections.length > 0) {
      lines.push('', 'Структура ответа:');
      for (const s of version.sections) {
        lines.push(`- "${s.key}" (${s.title}, тип: ${s.outputType}): ${s.instruction}`);
      }
    }
    return lines.join('\n');
  }

  private buildUserMessage(demo: DemoMeeting): string {
    const head = `Транскрипт демо-встречи (тип: ${demo.type}, длительность ${Math.round(
      demo.durationSec / 60,
    )} мин, участников: ${demo.participants.length}).`;
    const body = demo.transcript
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');
    return `${head}\n\n${body}`;
  }

  private approximateCost(inputTokens: number, outputTokens: number): number {
    // Грубая оценка: $0.5 / 1M входных + $1.5 / 1M выходных (deepseek-flash-like).
    // Точная цена пишется в AiUsageLog через LlmRouter; здесь — только для UI.
    return (inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000;
  }
}
