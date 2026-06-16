import { Inject, Injectable } from '@nestjs/common';
import type { ApiKey, ApiKeyScope } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class ApiKeysRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  countActive(userId: string): Promise<number> {
    return this.prisma.apiKey.count({ where: { userId, revokedAt: null } });
  }

  listByUser(userId: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: {
    userId: string;
    tenantId?: string | null;
    name: string;
    hashedKey: string;
    prefix: string;
    scopes: ApiKeyScope[];
    scope?: 'api' | 'ingest';
  }): Promise<ApiKey> {
    return this.prisma.apiKey.create({
      data: {
        userId: input.userId,
        tenantId: input.tenantId ?? null,
        name: input.name,
        hashedKey: input.hashedKey,
        prefix: input.prefix,
        scopes: input.scopes,
        scope: input.scope ?? 'api',
      },
    });
  }

  findByHashed(hashedKey: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { hashedKey } });
  }

  findActiveByPrefix(prefix: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { prefix, revokedAt: null },
      take: 5,
    });
  }

  findById(id: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { id } });
  }

  revoke(id: string): Promise<ApiKey> {
    return this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.prisma.apiKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }
}
