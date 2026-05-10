import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

import { AdminCacheService } from './admin-cache.service';

/**
 * AdminPricesService (Z-Admin Фаза 7 шаг 6).
 *
 *   - `listPrices({activeOnly})` — все записи `LlmModelPrice`. activeOnly=true
 *     → только `effectiveTo IS NULL`. Сортировка: provider, model, effectiveFrom DESC.
 *   - `setPrice(...)` — транзакция: закрыть текущую активную (effectiveTo=now),
 *     создать новую с effectiveFrom=now (или переданным). Сбрасывает price-cache
 *     LlmRouter и AdminCache(`usage:`).
 */
@Injectable()
export class AdminPricesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  async listPrices(args: { activeOnly: boolean }) {
    const where: Prisma.LlmModelPriceWhereInput = args.activeOnly
      ? { effectiveTo: null }
      : {};
    const items = await this.prisma.llmModelPrice.findMany({
      where,
      orderBy: [
        { provider: 'asc' },
        { model: 'asc' },
        { effectiveFrom: 'desc' },
      ],
    });
    return {
      items: items.map((p) => ({
        id: p.id,
        provider: p.provider,
        model: p.model,
        inputCostPerMillionTokens: Number(p.inputCostPerMillionTokens),
        outputCostPerMillionTokens: Number(p.outputCostPerMillionTokens),
        cachedCostPerMillionTokens: Number(p.cachedCostPerMillionTokens),
        currency: p.currency,
        effectiveFrom: p.effectiveFrom.toISOString(),
        effectiveTo: p.effectiveTo?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async setPrice(args: {
    provider: string;
    model: string;
    inputCostPerMillionTokens: number;
    outputCostPerMillionTokens: number;
    cachedCostPerMillionTokens: number;
    currency: string;
    effectiveFrom?: Date;
  }) {
    const effectiveFrom = args.effectiveFrom ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      // Закрываем все актуальные (effectiveTo IS NULL) записи для пары provider+model.
      await tx.llmModelPrice.updateMany({
        where: {
          provider: args.provider,
          model: args.model,
          effectiveTo: null,
        },
        data: { effectiveTo: effectiveFrom },
      });
      // Создаём новую активную.
      await tx.llmModelPrice.create({
        data: {
          provider: args.provider,
          model: args.model,
          inputCostPerMillionTokens: new Prisma.Decimal(
            args.inputCostPerMillionTokens.toFixed(6),
          ),
          outputCostPerMillionTokens: new Prisma.Decimal(
            args.outputCostPerMillionTokens.toFixed(6),
          ),
          cachedCostPerMillionTokens: new Prisma.Decimal(
            args.cachedCostPerMillionTokens.toFixed(6),
          ),
          currency: args.currency,
          effectiveFrom,
        },
      });
    });

    this.router.refreshPrices();
    this.cache.invalidate('usage:');
    return { ok: true as const };
  }
}
