import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

import { AdminCacheService } from './admin-cache.service';

@Injectable()
export class AdminPricesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly router: LlmRouterService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  async listPrices(args: {
    activeOnly: boolean;
    modelId?: string;
    providerId?: string;
    provider?: string;
    model?: string;
  }) {
    const where: Prisma.LlmModelPriceWhereInput = {
      ...(args.activeOnly ? { effectiveTo: null } : {}),
      ...(args.modelId ? { modelId: args.modelId } : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
    };
    const items = await this.prisma.llmModelPrice.findMany({
      where,
      orderBy: [{ provider: 'asc' }, { model: 'asc' }, { effectiveFrom: 'desc' }],
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
    modelId?: string;
  }) {
    const effectiveFrom = args.effectiveFrom ?? new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.llmModelPrice.updateMany({
        where: args.modelId
          ? { modelId: args.modelId, effectiveTo: null }
          : { provider: args.provider, model: args.model, effectiveTo: null },
        data: { effectiveTo: effectiveFrom },
      });
      await tx.llmModelPrice.create({
        data: {
          provider: args.provider,
          model: args.model,
          inputCostPerMillionTokens: new Prisma.Decimal(args.inputCostPerMillionTokens.toFixed(6)),
          outputCostPerMillionTokens: new Prisma.Decimal(
            args.outputCostPerMillionTokens.toFixed(6),
          ),
          cachedCostPerMillionTokens: new Prisma.Decimal(
            args.cachedCostPerMillionTokens.toFixed(6),
          ),
          currency: args.currency,
          effectiveFrom,
          ...(args.modelId ? { modelId: args.modelId } : {}),
        },
      });
    });

    this.router.refreshPrices();
    this.cache.invalidate('usage:');
    return { ok: true as const };
  }
}
