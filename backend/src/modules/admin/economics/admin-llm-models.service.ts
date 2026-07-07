import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type LlmTaskRoute } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ProviderInfoResolver } from '../../ai/services/protocol-adapter/provider-info.resolver';

import type {
  CreateLlmModelDto,
  RemoveModelDto,
  UpdateLlmModelDto,
} from './dto/admin-llm-models.dto';

interface LegacyChainEntry {
  provider: string;
  model?: string;
}

@Injectable()
export class AdminLlmModelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(ProviderInfoResolver)
    private readonly providerInfo?: ProviderInfoResolver,
    @Optional()
    @Inject(LlmRouterService)
    private readonly router?: LlmRouterService,
  ) {}

  async list(args: {
    providerId?: string;
    category?: 'flagship' | 'fast' | 'reasoning' | 'embedding' | 'experimental';
    includeInactive: boolean;
  }) {
    const where: Prisma.LlmModelWhereInput = {
      deletedAt: null,
      ...(args.includeInactive ? {} : { isActive: true }),
      ...(args.providerId ? { providerId: args.providerId } : {}),
      ...(args.category ? { category: args.category } : {}),
    };
    const items = await this.prisma.llmModel.findMany({
      where,
      orderBy: [{ providerId: 'asc' }, { modelKey: 'asc' }],
      include: {
        provider: { select: { id: true, name: true, displayName: true, defaultModelKey: true } },
      },
    });
    return {
      items: items.map((m) => ({
        id: m.id,
        providerId: m.providerId,
        providerName: m.provider.name,
        providerDisplayName: m.provider.displayName,
        modelKey: m.modelKey,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        capabilitiesJson: m.capabilitiesJson,
        category: m.category,
        isActive: m.isActive,
        isDefault: m.modelKey === m.provider.defaultModelKey,
        verifiedAt: m.verifiedAt?.toISOString() ?? null,
        notes: m.notes,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.llmModel.findUnique({
      where: { id },
      include: { provider: true },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'model_not_found', message: 'LlmModel не найден' },
      });
    }
    return row;
  }

  async create(dto: CreateLlmModelDto) {
    const exists = await this.prisma.llmModel.findFirst({
      where: { providerId: dto.providerId, modelKey: dto.modelKey },
    });
    if (exists) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'model_exists',
          message: `LlmModel ${dto.modelKey} уже существует у этого provider'а`,
        },
      });
    }
    return this.prisma.llmModel.create({
      data: {
        providerId: dto.providerId,
        modelKey: dto.modelKey,
        displayName: dto.displayName,
        ...(dto.contextWindow ? { contextWindow: dto.contextWindow } : {}),
        ...(dto.capabilities
          ? { capabilitiesJson: dto.capabilities as Prisma.InputJsonValue }
          : {}),
        ...(dto.category ? { category: dto.category } : {}),
        isActive: dto.isActive,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
    });
  }

  async update(id: string, dto: UpdateLlmModelDto) {
    await this.getById(id);
    return this.prisma.llmModel.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.contextWindow !== undefined ? { contextWindow: dto.contextWindow } : {}),
        ...(dto.capabilities !== undefined
          ? { capabilitiesJson: dto.capabilities as Prisma.InputJsonValue }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async setDefaultModel(id: string): Promise<{ ok: true }> {
    const row = await this.getById(id);
    if (!row.isActive) {
      throw new UnprocessableEntityException({
        ok: false,
        error: {
          code: 'default_model_inactive',
          message: `Модель "${row.modelKey}" неактивна — сначала активируйте`,
        },
      });
    }
    await this.prisma.llmProvider.update({
      where: { id: row.providerId },
      data: { defaultModelKey: row.modelKey },
    });
    this.providerInfo?.invalidate();
    return { ok: true };
  }

  async previewRemoval(id: string): Promise<{
    modelKey: string;
    providerName: string;
    isDefault: boolean;
    affectedRoutesCount: number;
    affectedTenantsCount: number;
    inDefaultChain: boolean;
    currentDefaultModel: string | null;
  }> {
    const row = await this.getById(id);
    const providerName = row.provider.name;
    const [tieredRoutes, legacyRoutes] = await Promise.all([
      this.prisma.llmTaskRoute.findMany({
        where: { providerName, model: row.modelKey, tier: { not: null } },
        select: { tenantId: true },
      }),
      this.prisma.llmTaskRoute.findMany({
        where: { tier: null, providers: { not: Prisma.JsonNull } },
        select: { tenantId: true, providers: true },
      }),
    ]);
    const legacyMatches = legacyRoutes.filter(
      (r) =>
        Array.isArray(r.providers) &&
        (r.providers as unknown as LegacyChainEntry[]).some(
          (p) => p?.provider === providerName && p?.model === row.modelKey,
        ),
    );
    const affectedRoutesCount = tieredRoutes.length + legacyMatches.length;
    const tenantSet = new Set(
      [...tieredRoutes, ...legacyMatches].map((r) => r.tenantId ?? '__global__'),
    );
    const chain = await this.cfg
      ?.getDynamic<LegacyChainEntry[]>('llm.router.defaultChain', undefined, [])
      .catch(() => []);
    const inDefaultChain =
      Array.isArray(chain) &&
      chain.some((e) => e?.provider === providerName && e?.model === row.modelKey);
    const currentDefaultModel = row.provider.defaultModelKey;
    return {
      modelKey: row.modelKey,
      providerName,
      isDefault: currentDefaultModel === row.modelKey,
      affectedRoutesCount,
      affectedTenantsCount: tenantSet.size,
      inDefaultChain,
      currentDefaultModel: currentDefaultModel !== row.modelKey ? currentDefaultModel : null,
    };
  }

  async softDeleteWithFallback(
    id: string,
    dto: RemoveModelDto,
    userId: string,
  ): Promise<{ ok: true; routesMigrated: number }> {
    const row = await this.getById(id);
    const providerName = row.provider.name;

    if (row.provider.defaultModelKey === row.modelKey) {
      const reassignTo = dto.reassignDefaultModelTo;
      if (!reassignTo) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'must_reassign_default_model',
            message: `"${row.modelKey}" — дефолтная модель провайдера "${providerName}". Сначала выбери новую дефолтную модель.`,
          },
        });
      }
      const replacement = await this.prisma.llmModel.findFirst({
        where: {
          providerId: row.providerId,
          modelKey: reassignTo,
          isActive: true,
          deletedAt: null,
        },
      });
      if (!replacement) {
        throw new UnprocessableEntityException({
          ok: false,
          error: {
            code: 'default_model_invalid',
            message: `Модель "${reassignTo}" не найдена/не активна у провайдера "${providerName}"`,
          },
        });
      }
      await this.prisma.llmProvider.update({
        where: { id: row.providerId },
        data: { defaultModelKey: reassignTo },
      });
      this.providerInfo?.invalidate();
    }

    const provider = await this.prisma.llmProvider.findUniqueOrThrow({
      where: { id: row.providerId },
    });
    const defaultModelKey = provider.defaultModelKey;

    if (!defaultModelKey || defaultModelKey === row.modelKey) {
      await this.assertModelNotInUse(providerName, row.modelKey);
      await this.prisma.llmModel.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
      return { ok: true, routesMigrated: 0 };
    }

    const routesMigrated = await this.migrateModelRoutesToDefault(
      providerName,
      row.modelKey,
      defaultModelKey,
      userId,
    );
    await this.prisma.llmModel.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.providerInfo?.invalidate();
    await this.router?.refreshCache();
    return { ok: true, routesMigrated };
  }

  private async assertModelNotInUse(providerName: string, modelKey: string): Promise<void> {
    const activeRoute = await this.prisma.llmTaskRoute.findFirst({
      where: { providerName, model: modelKey, isActive: true, tier: { not: null } },
      select: { taskType: true },
    });
    if (activeRoute) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'model_in_use_by_routes',
          message: `Модель "${modelKey}" провайдера "${providerName}" используется в активном маршруте taskType="${activeRoute.taskType}" — сначала уберите её из маршрутизации`,
        },
      });
    }
  }

  private async migrateModelRoutesToDefault(
    providerName: string,
    oldModelKey: string,
    newModelKey: string,
    userId: string,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      let migratedCount = 0;

      const tieredRoutes: LlmTaskRoute[] = await tx.llmTaskRoute.findMany({
        where: { providerName, model: oldModelKey, tier: { not: null } },
      });
      for (const route of tieredRoutes) {
        await tx.llmTaskRoute.update({ where: { id: route.id }, data: { model: newModelKey } });
        await tx.llmTaskRouteChange.create({
          data: {
            taskType: route.taskType,
            tenantId: route.tenantId,
            tier: route.tier,
            changeType: 'model_deleted_auto_migrated',
            before: { providerName, model: oldModelKey } as unknown as Prisma.InputJsonValue,
            after: { providerName, model: newModelKey } as unknown as Prisma.InputJsonValue,
            changedById: userId,
            reason: 'model_deleted_auto_migrated',
          },
        });
        migratedCount += 1;
      }

      const legacyRoutes = await tx.llmTaskRoute.findMany({
        where: { tier: null, providers: { not: Prisma.JsonNull } },
      });
      for (const route of legacyRoutes) {
        const providers = Array.isArray(route.providers)
          ? (route.providers as unknown as LegacyChainEntry[])
          : [];
        if (!providers.some((p) => p?.provider === providerName && p?.model === oldModelKey)) {
          continue;
        }
        const before = providers;
        const replaced = providers.map((p) =>
          p?.provider === providerName && p?.model === oldModelKey
            ? { provider: providerName, model: newModelKey }
            : p,
        );
        const deduped = dedupeByProviderModel(replaced);
        await tx.llmTaskRoute.update({
          where: { id: route.id },
          data: { providers: deduped as unknown as Prisma.InputJsonValue },
        });
        await tx.llmTaskRouteChange.create({
          data: {
            taskType: route.taskType,
            tenantId: route.tenantId,
            tier: null,
            changeType: 'model_deleted_auto_migrated',
            before: before as unknown as Prisma.InputJsonValue,
            after: deduped as unknown as Prisma.InputJsonValue,
            changedById: userId,
            reason: 'model_deleted_auto_migrated',
          },
        });
        migratedCount += 1;
      }

      return migratedCount;
    });
  }

  async listPriceHistory(modelId: string) {
    const model = await this.getById(modelId);
    const items = await this.prisma.llmModelPrice.findMany({
      where: {
        OR: [{ modelId }, { provider: model.provider.name, model: model.modelKey }],
      },
      orderBy: { effectiveFrom: 'desc' },
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
      })),
    };
  }
}

function dedupeByProviderModel<T extends { provider?: string; model?: string }>(
  entries: T[],
): T[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.provider ?? ''}::${e.model ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
