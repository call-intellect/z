import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { openaiCompatibleEmbed } from '../../embeddings/services/openai-compatible-embed.util';

import type {
  CreateEmbeddingModelDto,
  CreateEmbeddingProviderDto,
  UpdateEmbeddingModelDto,
  UpdateEmbeddingProviderDto,
} from './dto/admin-embedding-providers.dto';

type EmbeddingProviderWithModels = Prisma.EmbeddingProviderGetPayload<{
  include: { models: true };
}>;

@Injectable()
export class AdminEmbeddingProvidersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async list(args: { includeInactive: boolean }) {
    const where: Prisma.EmbeddingProviderWhereInput = {
      deletedAt: null,
      ...(args.includeInactive ? {} : { isActive: true }),
    };
    const items = await this.prisma.embeddingProvider.findMany({
      where,
      orderBy: { priority: 'asc' },
      include: { models: { where: { deletedAt: null } } },
    });
    return { items: items.map((p) => this.present(p)) };
  }

  async getById(id: string) {
    return this.present(await this.getRow(id));
  }

  async create(dto: CreateEmbeddingProviderDto) {
    const existing = await this.prisma.embeddingProvider.findUnique({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'embedding_provider_name_conflict',
          message: `Провайдер эмбеддингов с name=${dto.name} уже существует`,
        },
      });
    }
    const dims = this.cfg.ai.embeddings.dimensions;
    const models = dto.models ?? [];
    const needsReindex = models.some((m) => m.dimensions !== dims);
    const row = await this.prisma.embeddingProvider.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        baseUrl: dto.baseUrl,
        protocolKind: dto.protocolKind,
        isActive: dto.isActive,
        priority: dto.priority,
        needsReindex,
        ...(dto.apiKey ? { apiKeyEncrypted: this.crypto.encrypt(dto.apiKey) } : {}),
        ...(dto.defaultHeaders
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
        ...(models.length > 0
          ? { models: { create: models.map((m) => this.buildModelData(m)) } }
          : {}),
      },
      include: { models: { where: { deletedAt: null } } },
    });
    return this.present(row);
  }

  async update(id: string, dto: UpdateEmbeddingProviderDto) {
    await this.getRow(id);
    const row = await this.prisma.embeddingProvider.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.protocolKind !== undefined ? { protocolKind: dto.protocolKind } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.apiKey ? { apiKeyEncrypted: this.crypto.encrypt(dto.apiKey) } : {}),
        ...(dto.defaultHeaders !== undefined
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
      },
      include: { models: { where: { deletedAt: null } } },
    });
    return this.present(row);
  }

  async softDelete(id: string) {
    await this.getRow(id);
    await this.prisma.embeddingProvider.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true as const };
  }

  async activate(id: string) {
    const provider = await this.getRow(id);
    const model = provider.models.find((m) => m.isActive && !m.deletedAt);
    if (!model) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'embedding_provider_no_active_model',
          message: 'У провайдера нет активной модели для активации',
        },
      });
    }
    const dims = this.cfg.ai.embeddings.dimensions;
    if (model.dimensions !== dims) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'embedding_dimension_mismatch_requires_reindex',
          message: `Размерность модели (${model.dimensions}) не совпадает с текущей размерностью колонок (${dims}); нужна реиндексация`,
        },
      });
    }
    const row = await this.prisma.embeddingProvider.update({
      where: { id },
      data: { isActive: true },
      include: { models: { where: { deletedAt: null } } },
    });
    return this.present(row);
  }

  async addModel(providerId: string, dto: CreateEmbeddingModelDto) {
    await this.getRow(providerId);
    try {
      await this.prisma.embeddingModel.create({
        data: { providerId, ...this.buildModelData(dto) },
      });
    } catch (err) {
      throw this.mapModelConflict(err);
    }
    if (dto.dimensions !== this.cfg.ai.embeddings.dimensions) {
      await this.prisma.embeddingProvider.update({
        where: { id: providerId },
        data: { needsReindex: true },
      });
    }
    return this.present(await this.getRow(providerId));
  }

  async updateModel(providerId: string, modelId: string, dto: UpdateEmbeddingModelDto) {
    await this.getRow(providerId);
    const existing = await this.prisma.embeddingModel.findFirst({
      where: { id: modelId, providerId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'embedding_model_not_found', message: 'Модель эмбеддингов не найдена' },
      });
    }
    try {
      await this.prisma.embeddingModel.update({
        where: { id: modelId },
        data: {
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
          ...(dto.dimensions !== undefined ? { dimensions: dto.dimensions } : {}),
          ...(dto.pricePerMillionInputTokensKopecks !== undefined
            ? { pricePerMillionInputTokensKopecks: dto.pricePerMillionInputTokensKopecks }
            : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        },
      });
    } catch (err) {
      throw this.mapModelConflict(err);
    }
    if (dto.dimensions !== undefined && dto.dimensions !== this.cfg.ai.embeddings.dimensions) {
      await this.prisma.embeddingProvider.update({
        where: { id: providerId },
        data: { needsReindex: true },
      });
    }
    return this.present(await this.getRow(providerId));
  }

  async softDeleteModel(providerId: string, modelId: string) {
    await this.getRow(providerId);
    const existing = await this.prisma.embeddingModel.findFirst({
      where: { id: modelId, providerId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'embedding_model_not_found', message: 'Модель эмбеддингов не найдена' },
      });
    }
    await this.prisma.embeddingModel.update({
      where: { id: modelId },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true as const };
  }

  async smoke(id: string) {
    const provider = await this.getRow(id);
    const model = provider.models.find((m) => m.isActive && !m.deletedAt);
    if (!model) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'embedding_provider_no_active_model',
          message: 'У провайдера нет активной модели для smoke-теста',
        },
      });
    }
    const apiKey = provider.apiKeyEncrypted ? this.crypto.decrypt(provider.apiKeyEncrypted) : null;
    try {
      await openaiCompatibleEmbed({
        baseUrl: provider.baseUrl,
        model: model.modelKey,
        apiKey,
        texts: ['ping'],
      });
      await this.prisma.embeddingProvider.update({
        where: { id },
        data: { lastSmokeAt: new Date(), lastSmokeSuccess: true, lastSmokeError: null },
      });
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.embeddingProvider.update({
        where: { id },
        data: { lastSmokeAt: new Date(), lastSmokeSuccess: false, lastSmokeError: message },
      });
      return { ok: false as const, error: message };
    }
  }

  private async getRow(id: string): Promise<EmbeddingProviderWithModels> {
    const row = await this.prisma.embeddingProvider.findUnique({
      where: { id },
      include: { models: { where: { deletedAt: null } } },
    });
    if (!row || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'embedding_provider_not_found',
          message: 'Провайдер эмбеддингов не найден',
        },
      });
    }
    return row;
  }

  private buildModelData(dto: CreateEmbeddingModelDto) {
    return {
      modelKey: dto.modelKey,
      displayName: dto.displayName,
      dimensions: dto.dimensions,
      isActive: dto.isActive,
      ...(dto.pricePerMillionInputTokensKopecks !== undefined
        ? { pricePerMillionInputTokensKopecks: dto.pricePerMillionInputTokensKopecks }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };
  }

  private mapModelConflict(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return new ConflictException({
        ok: false,
        error: {
          code: 'embedding_model_key_conflict',
          message: 'Модель с таким modelKey у этого провайдера уже существует',
        },
      });
    }
    return err;
  }

  private present(row: EmbeddingProviderWithModels) {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      baseUrl: row.baseUrl,
      protocolKind: row.protocolKind,
      hasApiKey: Boolean(row.apiKeyEncrypted),
      defaultHeaders: row.defaultHeaders,
      isActive: row.isActive,
      priority: row.priority,
      needsReindex: row.needsReindex,
      lastSmokeAt: row.lastSmokeAt?.toISOString() ?? null,
      lastSmokeSuccess: row.lastSmokeSuccess,
      lastSmokeError: row.lastSmokeError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      models: row.models.map((m) => ({
        id: m.id,
        modelKey: m.modelKey,
        displayName: m.displayName,
        dimensions: m.dimensions,
        pricePerMillionInputTokensKopecks: m.pricePerMillionInputTokensKopecks,
        isActive: m.isActive,
        verifiedAt: m.verifiedAt?.toISOString() ?? null,
        notes: m.notes,
      })),
    };
  }
}
