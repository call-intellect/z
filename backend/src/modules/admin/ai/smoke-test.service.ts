import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProviderSmokeTestCron } from '../economics/provider-smoke-test.cron';

/**
 * Admin-redesign Фаза 3 — AdminSmokeTestService.
 *
 * Обёртка над `ProviderSmokeTestCron.testProvider()`. Что добавляет:
 *   1) manual-trigger через REST (а не только по расписанию);
 *   2) batch-режим: параллельный smoke по всем активным провайдерам;
 *   3) ring-buffer истории прогонов на 200 записей (in-memory, на процесс).
 *      Постоянная история по-провайдеру хранится в `LlmProvider.lastSmoke*` —
 *      туда уже пишет cron-сервис, поэтому отдельную таблицу не заводим.
 *
 * ВАЖНО: дублировать HTTP-вызовы к LLM-провайдерам в этом сервисе мы НЕ
 * хотим. Вся реальная логика smoke-теста живёт в `ProviderSmokeTestCron`
 * (через `LlmProtocolAdapterRegistry`). Здесь только координация.
 */

export interface SmokeTestResult {
  provider: string;
  status: 'ok' | 'fail';
  latencyMs: number;
  error?: string;
  startedAt: string;
}

interface HistoryRecord extends SmokeTestResult {
  trigger: 'manual_single' | 'manual_all';
  triggeredByUserId: string | null;
}

const HISTORY_MAX = 200;

@Injectable()
export class AdminSmokeTestService {
  private readonly logger = new Logger(AdminSmokeTestService.name);

  /** Ring-buffer истории прогонов (in-memory, на процесс). */
  private readonly history: HistoryRecord[] = [];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderSmokeTestCron)
    private readonly cron: ProviderSmokeTestCron,
  ) {}

  /**
   * Smoke-test одного провайдера по имени (slug: 'deepseek', 'openai-proxy',
   * 'anthropic', 'ollama', 'minimax', 'vox', 'grsai', 'kie').
   */
  async runForProvider(
    providerName: string,
    triggeredByUserId: string | null,
  ): Promise<SmokeTestResult> {
    // Проверяем, что провайдер вообще есть — отдаём 404 с понятным телом
    // (cron.testProvider обработал бы это как обычную ошибку adapter'а).
    const provider = await this.prisma.llmProvider.findUnique({
      where: { name: providerName },
      select: { id: true, name: true, isActive: true, deletedAt: true },
    });
    if (!provider || provider.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'provider_not_found',
          message: `LLM-провайдер ${providerName} не найден`,
        },
      });
    }

    const startedAt = new Date();
    const cronResult = await this.cron.testProvider(providerName);
    const result: SmokeTestResult = {
      provider: providerName,
      status: cronResult.success ? 'ok' : 'fail',
      latencyMs: Math.round(cronResult.durationSeconds * 1000),
      startedAt: startedAt.toISOString(),
      ...(cronResult.error ? { error: cronResult.error } : {}),
    };

    this.pushHistory({ ...result, trigger: 'manual_single', triggeredByUserId });
    return result;
  }

  /**
   * Параллельный smoke-test по всем активным провайдерам.
   * Возвращает массив результатов в том же порядке, в котором провайдеры
   * лежат в БД (по name).
   */
  async runForAllActive(
    triggeredByUserId: string | null,
  ): Promise<SmokeTestResult[]> {
    const providers = await this.prisma.llmProvider.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { name: true },
    });

    if (providers.length === 0) {
      return [];
    }

    const startedAt = new Date();
    const settled = await Promise.allSettled(
      providers.map((p) => this.cron.testProvider(p.name)),
    );

    const out: SmokeTestResult[] = settled.map((s, i) => {
      const providerName = providers[i]!.name;
      if (s.status === 'fulfilled') {
        return {
          provider: providerName,
          status: s.value.success ? 'ok' : 'fail',
          latencyMs: Math.round(s.value.durationSeconds * 1000),
          startedAt: startedAt.toISOString(),
          ...(s.value.error ? { error: s.value.error } : {}),
        };
      }
      const errMsg = s.reason instanceof Error ? s.reason.message : String(s.reason);
      this.logger.warn(
        { provider: providerName, err: errMsg },
        'smoke-test/all: testProvider бросил исключение',
      );
      return {
        provider: providerName,
        status: 'fail',
        latencyMs: 0,
        startedAt: startedAt.toISOString(),
        error: errMsg,
      };
    });

    for (const r of out) {
      this.pushHistory({ ...r, trigger: 'manual_all', triggeredByUserId });
    }
    return out;
  }

  /**
   * Последние N записей smoke-test истории (в порядке от новых к старым).
   * Источник — in-memory ring-buffer (см. шапку класса).
   */
  getHistory(limit: number): HistoryRecord[] {
    const safeLimit = Math.min(Math.max(limit, 1), HISTORY_MAX);
    return this.history.slice(-safeLimit).reverse();
  }

  // ─────────────────────────── private ─────────────────────────────────

  private pushHistory(record: HistoryRecord): void {
    this.history.push(record);
    while (this.history.length > HISTORY_MAX) {
      this.history.shift();
    }
  }
}
