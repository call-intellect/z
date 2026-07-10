import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';

import { resolveEffectiveConnection } from './effective-connection.util';
import type { ProtocolAdapterProviderInfo, ProtocolKind } from './protocol-adapter.types';

interface ProviderCacheEntry {
  info: ProtocolAdapterProviderInfo;
  protocolKind: ProtocolKind;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class ProviderInfoResolver {
  private readonly logger = new Logger(ProviderInfoResolver.name);
  private readonly cache = new Map<string, ProviderCacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
  ) {}

  async resolveByName(name: string): Promise<{
    info: ProtocolAdapterProviderInfo;
    protocolKind: ProtocolKind;
  } | null> {
    const now = Date.now();
    const cached = this.cache.get(name);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      return { info: cached.info, protocolKind: cached.protocolKind };
    }

    let row: {
      name: string;
      baseUrl: string;
      apiKeyEncrypted: string | null;
      protocolKind: string;
      defaultHeaders: unknown;
      useProxy: boolean;
      proxyPath: string | null;
      timeoutMs: number | null;
      capability: string;
      defaultModelKey: string | null;
      billingMode: string;
    } | null = null;
    try {
      row = await this.prisma.llmProvider.findUnique({
        where: { name },
        select: {
          name: true,
          baseUrl: true,
          apiKeyEncrypted: true,
          protocolKind: true,
          defaultHeaders: true,
          useProxy: true,
          proxyPath: true,
          timeoutMs: true,
          capability: true,
          defaultModelKey: true,
          billingMode: true,
        },
      });
    } catch (err) {
      this.logger.warn(
        `ProviderInfoResolver: db lookup failed для name=${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (row) {
      const decryptedApiKey =
        row.apiKeyEncrypted && this.crypto.isEncrypted(row.apiKeyEncrypted)
          ? this.crypto.decrypt(row.apiKeyEncrypted)
          : row.apiKeyEncrypted;
      const effective = resolveEffectiveConnection(
        {
          baseUrl: row.baseUrl,
          apiKey: decryptedApiKey,
          useProxy: row.useProxy,
          proxyPath: row.proxyPath,
          protocolKind: row.protocolKind,
        },
        this.cfg.ai.proxy,
      );
      const info: ProtocolAdapterProviderInfo = {
        name: row.name,
        baseUrl: effective.baseUrl,
        apiKey: effective.apiKey,
        capability: row.capability,
        timeoutMs: row.timeoutMs,
        defaultModelKey: row.defaultModelKey,
        billingMode: row.billingMode,
        ...(row.defaultHeaders &&
        typeof row.defaultHeaders === 'object' &&
        !Array.isArray(row.defaultHeaders)
          ? {
              defaultHeaders: row.defaultHeaders as Record<string, string>,
            }
          : {}),
      };
      const entry: ProviderCacheEntry = {
        info,
        protocolKind: row.protocolKind as ProtocolKind,
        fetchedAt: now,
      };
      this.cache.set(name, entry);
      return { info, protocolKind: entry.protocolKind };
    }

    return null;
  }

  invalidate(): void {
    this.cache.clear();
  }
}
