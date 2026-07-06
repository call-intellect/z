import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type LlmProvider } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProviderInfoResolver } from '../../ai/services/protocol-adapter/provider-info.resolver';

import { discoverProviderModels } from './discover-provider-models.util';
import type { CreateLlmProviderDto, UpdateLlmProviderDto } from './dto/admin-llm-providers.dto';

@Injectable()
export class AdminLlmProvidersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ProviderInfoResolver)
    private readonly providerInfo: ProviderInfoResolver,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  async list(args: { includeInactive: boolean }) {
    const where: Prisma.LlmProviderWhereInput = {
      deletedAt: null,
      ...(args.includeInactive ? {} : { isActive: true }),
    };
    const items = await this.prisma.llmProvider.findMany({ where, orderBy: { name: 'asc' } });
    return { items: items.map((p) => this.present(p)) };
  }

  async getById(id: string) {
    return this.present(await this.getRow(id));
  }

  async create(dto: CreateLlmProviderDto) {
    const existing = await this.prisma.llmProvider.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'provider_exists',
          message: `LlmProvider с name=${dto.name} уже существует`,
        },
      });
    }
    const row = await this.prisma.llmProvider.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        baseUrl: dto.baseUrl,
        protocolKind: dto.protocolKind,
        capability: dto.capability,
        isActive: dto.isActive,
        useProxy: dto.useProxy,
        ...(dto.proxyPath !== undefined ? { proxyPath: dto.proxyPath } : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.defaultModelKey !== undefined ? { defaultModelKey: dto.defaultModelKey } : {}),
        ...(dto.apiKey ? { apiKeyEncrypted: this.crypto.encrypt(dto.apiKey) } : {}),
        ...(dto.defaultHeaders
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
        ...(dto.globalRps ? { globalRps: dto.globalRps } : {}),
      },
    });
    this.providerInfo.invalidate();
    return this.present(row);
  }

  async update(id: string, dto: UpdateLlmProviderDto) {
    const existing = await this.getRow(id);
    if (dto.isActive === false) {
      await this.assertProviderNotInUse(existing.name);
    }
    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.protocolKind !== undefined ? { protocolKind: dto.protocolKind } : {}),
        ...(dto.capability !== undefined ? { capability: dto.capability } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.useProxy !== undefined ? { useProxy: dto.useProxy } : {}),
        ...(dto.proxyPath !== undefined ? { proxyPath: dto.proxyPath } : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.defaultModelKey !== undefined ? { defaultModelKey: dto.defaultModelKey } : {}),
        ...(dto.apiKey === null
          ? { apiKeyEncrypted: null }
          : dto.apiKey
            ? { apiKeyEncrypted: this.crypto.encrypt(dto.apiKey) }
            : {}),
        ...(dto.defaultHeaders !== undefined
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
        ...(dto.globalRps !== undefined ? { globalRps: dto.globalRps } : {}),
      },
    });
    this.providerInfo.invalidate();
    return this.present(row);
  }

  async softDelete(id: string) {
    const row = await this.getRow(id);
    await this.assertProviderNotInUse(row.name);
    await this.prisma.llmProvider.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.providerInfo.invalidate();
    return { ok: true as const };
  }

  /**
   * Ф2026-07-06: назначить провайдера дефолтным. Атомарно снимает флаг
   * со старого дефолта (если был) и ставит на новый. model должен принадлежать
   * провайдеру и быть активным.
   */
  async setDefaultProvider(id: string, model: string): Promise<{ ok: true }> {
    const row = await this.getRow(id);
    const modelRow = await this.prisma.llmModel.findFirst({
      where: { providerId: id, modelKey: model, isActive: true, deletedAt: null },
    });
    if (!modelRow) {
      throw new UnprocessableEntityException({
        ok: false,
        error: {
          code: 'default_model_invalid',
          message: `Модель "${model}" не найдена/не активна у провайдера "${row.name}"`,
        },
      });
    }
    await this.prisma.$transaction([
      this.prisma.llmProvider.updateMany({
        where: { isDefaultProvider: true },
        data: { isDefaultProvider: false },
      }),
      this.prisma.llmProvider.update({
        where: { id },
        data: { isDefaultProvider: true, defaultModelKey: model },
      }),
    ]);
    this.providerInfo.invalidate();
    return { ok: true };
  }

  /**
   * Возвращает текущий дефолт (провайдер+модель) или null, если не назначен.
   */
  private async getDefaultProvider(): Promise<{
    providerName: string;
    model: string | null;
  } | null> {
    const row = await this.prisma.llmProvider.findFirst({
      where: { isDefaultProvider: true, deletedAt: null },
    });
    return row ? { providerName: row.name, model: row.defaultModelKey } : null;
  }

  /**
   * Ф2026-07-06: предпросмотр удаления — сколько маршрутов затронуто, текущий дефолт.
   * НЕ мутирует ничего.
   */
  async previewRemoval(id: string): Promise<{
    providerName: string;
    isDefault: boolean;
    affectedRoutesCount: number;
    affectedTenantsCount: number;
    inDefaultChain: boolean;
    currentDefault: { providerName: string; model: string | null } | null;
  }> {
    const row = await this.getRow(id);
    const [tieredRoutes, legacyRoutes] = await Promise.all([
      this.prisma.llmTaskRoute.findMany({
        where: { providerName: row.name, tier: { not: null } },
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
        (r.providers as Array<{ provider?: string }>).some((p) => p?.provider === row.name),
    );
    const affectedRoutesCount = tieredRoutes.length + legacyMatches.length;
    const tenantSet = new Set(
      [...tieredRoutes, ...legacyMatches].map((r) => r.tenantId ?? '__global__'),
    );
    const defaultChainRaw = await this.cfg
      ?.getDynamic<Array<{ provider: string }>>('llm.router.defaultChain', undefined, [])
      .catch(() => []);
    const inDefaultChain =
      Array.isArray(defaultChainRaw) && defaultChainRaw.some((e) => e?.provider === row.name);
    return {
      providerName: row.name,
      isDefault: row.isDefaultProvider,
      affectedRoutesCount,
      affectedTenantsCount: tenantSet.size,
      inDefaultChain,
      currentDefault: await this.getDefaultProvider(),
    };
  }

  async discoverModels(id: string) {
    const row = await this.getRow(id);
    if (row.protocolKind === 'anthropic-messages') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'discovery_not_supported',
          message: 'Anthropic Messages API не поддерживает discovery моделей (нет GET /models)',
        },
      });
    }
    const resolved = await this.providerInfo.resolveByName(row.name);
    const baseUrl = resolved?.info.baseUrl ?? row.baseUrl;
    const apiKey = resolved?.info.apiKey ?? null;
    const existing = await this.prisma.llmModel.findMany({
      where: { providerId: id, deletedAt: null },
      select: { modelKey: true },
    });
    const existingKeys = new Set(existing.map((m) => m.modelKey));
    try {
      const models = await discoverProviderModels({
        baseUrl,
        apiKey,
        defaultHeaders: resolved?.info.defaultHeaders,
        timeoutMs: resolved?.info.timeoutMs,
      });
      return {
        ok: true as const,
        models: models.map((m) => ({ id: m.id, alreadyInCatalog: existingKeys.has(m.id) })),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false as const, error: message };
    }
  }

  /**
   * Ф6 (2026-07-02): гард 409 `provider_in_use_by_routes` — запрещает
   * деактивацию/удаление провайдера, который используется в активном
   * маршруте `LlmTaskRoute` или входит в дефолт-цепочку `llm.router.defaultChain`.
   */
  private async assertProviderNotInUse(providerName: string): Promise<void> {
    const activeRoute = await this.prisma.llmTaskRoute.findFirst({
      where: { tenantId: null, providerName, isActive: true, tier: { not: null } },
      select: { taskType: true },
    });
    if (activeRoute) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'provider_in_use_by_routes',
          message: `Провайдер "${providerName}" используется в активном маршруте taskType="${activeRoute.taskType}" — сначала уберите его из маршрутизации`,
        },
      });
    }
    const defaultChainRaw = await this.cfg
      ?.getDynamic<Array<{ provider: string }>>('llm.router.defaultChain', undefined, [])
      .catch(() => []);
    if (
      Array.isArray(defaultChainRaw) &&
      defaultChainRaw.some((e) => e?.provider === providerName)
    ) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'provider_in_use_by_routes',
          message: `Провайдер "${providerName}" входит в дефолт-цепочку (llm.router.defaultChain) — сначала уберите его оттуда`,
        },
      });
    }
  }

  private async getRow(id: string): Promise<LlmProvider> {
    const row = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'provider_not_found', message: 'LlmProvider не найден' },
      });
    }
    return row;
  }

  private present(row: LlmProvider) {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      baseUrl: row.baseUrl,
      protocolKind: row.protocolKind,
      capability: row.capability,
      isActive: row.isActive,
      useProxy: row.useProxy,
      proxyPath: row.proxyPath,
      timeoutMs: row.timeoutMs,
      defaultModelKey: row.defaultModelKey,
      hasApiKey: Boolean(row.apiKeyEncrypted),
      defaultHeaders: row.defaultHeaders,
      globalRps: row.globalRps,
      lastSmokeAt: row.lastSmokeAt?.toISOString() ?? null,
      lastSmokeSuccess: row.lastSmokeSuccess,
      lastSmokeError: row.lastSmokeError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
