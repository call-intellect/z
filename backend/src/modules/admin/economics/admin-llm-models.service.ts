import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type {
  CreateLlmModelDto,
  UpdateLlmModelDto,
} from './dto/admin-llm-models.dto';

/**
 * SBA α-10 wave 3 — AdminLlmModelsService.
 *
 * CRUD реестра LlmModel + price-history доступ для UI (через JOIN с
 * LlmModelPrice по modelId).
 */
@Injectable()
export class AdminLlmModelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
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
        provider: { select: { id: true, name: true, displayName: true } },
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
        ...(dto.contextWindow !== undefined
          ? { contextWindow: dto.contextWindow }
          : {}),
        ...(dto.capabilities !== undefined
          ? { capabilitiesJson: dto.capabilities as Prisma.InputJsonValue }
          : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });
  }

  async softDelete(id: string) {
    await this.getById(id);
    await this.prisma.llmModel.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { ok: true as const };
  }

  /** Price history по modelId (объединяем по modelId если связан, иначе по строке model). */
  async listPriceHistory(modelId: string) {
    const model = await this.getById(modelId);
    const items = await this.prisma.llmModelPrice.findMany({
      where: {
        OR: [
          { modelId },
          { provider: model.provider.name, model: model.modelKey },
        ],
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
