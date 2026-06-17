import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProviderInfoResolver } from '../../ai/services/protocol-adapter/provider-info.resolver';

import type { CreateLlmProviderDto, UpdateLlmProviderDto } from './dto/admin-llm-providers.dto';

@Injectable()
export class AdminLlmProvidersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProviderInfoResolver)
    private readonly providerInfo: ProviderInfoResolver,
  ) {}

  async list(args: { includeInactive: boolean }) {
    const where: Prisma.LlmProviderWhereInput = {
      deletedAt: null,
      ...(args.includeInactive ? {} : { isActive: true }),
    };
    const items = await this.prisma.llmProvider.findMany({
      where,
      orderBy: { name: 'asc' },
    });
    return {
      items: items.map((p) => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        protocolKind: p.protocolKind,
        capability: p.capability,
        isActive: p.isActive,
        hasApiKey: Boolean(p.apiKeyEncrypted),
        defaultHeaders: p.defaultHeaders,
        globalRps: p.globalRps,
        lastSmokeAt: p.lastSmokeAt?.toISOString() ?? null,
        lastSmokeSuccess: p.lastSmokeSuccess,
        lastSmokeError: p.lastSmokeError,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  async getById(id: string) {
    const row = await this.prisma.llmProvider.findUnique({ where: { id } });
    if (!row || row.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'provider_not_found', message: 'LlmProvider не найден' },
      });
    }
    return row;
  }

  async create(dto: CreateLlmProviderDto) {
    const existing = await this.prisma.llmProvider.findUnique({
      where: { name: dto.name },
    });
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
        ...(dto.apiKey ? { apiKeyEncrypted: dto.apiKey } : {}),
        ...(dto.defaultHeaders
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
        ...(dto.globalRps ? { globalRps: dto.globalRps } : {}),
      },
    });
    this.providerInfo.invalidate();
    return row;
  }

  async update(id: string, dto: UpdateLlmProviderDto) {
    await this.getById(id);
    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.protocolKind !== undefined ? { protocolKind: dto.protocolKind } : {}),
        ...(dto.capability !== undefined ? { capability: dto.capability } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.apiKey ? { apiKeyEncrypted: dto.apiKey } : {}),
        ...(dto.defaultHeaders !== undefined
          ? { defaultHeaders: dto.defaultHeaders as Prisma.InputJsonValue }
          : {}),
        ...(dto.globalRps !== undefined ? { globalRps: dto.globalRps } : {}),
      },
    });
    this.providerInfo.invalidate();
    return row;
  }

  async softDelete(id: string) {
    await this.getById(id);
    await this.prisma.llmProvider.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.providerInfo.invalidate();
    return { ok: true as const };
  }
}
