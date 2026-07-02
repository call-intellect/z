import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type LlmProvider } from '@prisma/client';

import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProviderInfoResolver } from '../../ai/services/protocol-adapter/provider-info.resolver';

import type { CreateLlmProviderDto, UpdateLlmProviderDto } from './dto/admin-llm-providers.dto';

@Injectable()
export class AdminLlmProvidersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ProviderInfoResolver)
    private readonly providerInfo: ProviderInfoResolver,
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
    await this.getRow(id);
    const row = await this.prisma.llmProvider.update({
      where: { id },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.protocolKind !== undefined ? { protocolKind: dto.protocolKind } : {}),
        ...(dto.capability !== undefined ? { capability: dto.capability } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
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
    await this.getRow(id);
    await this.prisma.llmProvider.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.providerInfo.invalidate();
    return { ok: true as const };
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
