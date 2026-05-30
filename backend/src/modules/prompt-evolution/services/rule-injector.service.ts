import { Inject, Injectable } from '@nestjs/common';
import type { PromptRule } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Agents v2 Фаза B1 (2026-05-30) — RuleInjectorService.
 *
 * В Фазе B (shadow) этот сервис ТОЛЬКО возвращает active правила, НИКТО
 * их в реальные prompts не инъектирует (`status='active'` не выставляется
 * в Фазе B — оно появится в Фазе C после ручной валидации админом).
 *
 * Метод сознательно простой: чтобы Фаза C могла подцепиться к нему без
 * рефакторинга — добавить вызов из специалистов (chat-v2 synthesis, summary,
 * report-by-type, ...) с конкатенацией `rule.rule` в systemPrompt.
 *
 * Per-tenant rules имеют приоритет над global (если совпадает promptKey).
 */
@Injectable()
export class RuleInjectorService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Возвращает активные (status='active') правила для пары (promptKey, tenantId).
   * В Фазе B всегда вернёт пустой массив — `status='active'` ещё нигде не
   * выставляется. Caller'ам безопасно дёргать.
   *
   * @param promptKey - taskType из LlmTaskRoute
   * @param tenantId - текущий tenant (null = только global)
   */
  async getActiveRulesForPrompt(
    promptKey: string,
    tenantId: string | null,
  ): Promise<PromptRule[]> {
    // Берём per-tenant + global; per-tenant имеет приоритет в любом downstream
    // конкатенаторе. В Фазе B результат пустой; в Фазе C будет логика merge.
    const rows = await this.prisma.promptRule.findMany({
      where: {
        promptKey,
        status: 'active',
        OR: [
          { tenantId: null },
          ...(tenantId ? [{ tenantId }] : []),
        ],
      },
      orderBy: [
        // tenant-rules первыми, потом global. Используем createdAt.
        { tenantId: 'desc' },
        { confidence: 'desc' },
      ],
    });
    return rows;
  }
}
