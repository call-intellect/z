import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { CryptoService } from '../../../../common/crypto/crypto.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';

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
      const info: ProtocolAdapterProviderInfo = {
        name: row.name,
        baseUrl: row.baseUrl,
        apiKey: decryptedApiKey,
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

    const envInfo = this.buildFromEnv(name);
    if (envInfo) {
      const entry: ProviderCacheEntry = {
        info: envInfo.info,
        protocolKind: envInfo.protocolKind,
        fetchedAt: now,
      };
      this.cache.set(name, entry);
      return envInfo;
    }
    return null;
  }

  invalidate(): void {
    this.cache.clear();
  }

  private buildFromEnv(name: string): {
    info: ProtocolAdapterProviderInfo;
    protocolKind: ProtocolKind;
  } | null {
    switch (name) {
      case 'anthropic':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.anthropic.useProxy
              ? this.cfg.ai.anthropic.proxyUrl
              : 'https://api.anthropic.com',
            apiKey: this.cfg.ai.anthropic.apiKey,
            defaultModel: this.cfg.ai.anthropic.model,
          },
          protocolKind: 'anthropic-messages',
        };
      case 'minimax':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.minimax.baseUrl,
            apiKey: this.cfg.ai.minimax.apiKey,
          },
          protocolKind: 'anthropic-messages',
        };
      case 'openai-via-proxy':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.proxy.baseUrl,
            apiKey: this.cfg.ai.openai.apiKey,
            authPrefix: this.cfg.ai.proxy.prefix,
            defaultModel: 'gpt-5-mini',
          },
          protocolKind: 'openai-responses',
        };
      case 'deepseek':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.deepseek.baseUrl,
            apiKey: this.cfg.ai.deepseek.apiKey,
            defaultModel: this.cfg.ai.deepseek.defaultModel,
          },
          protocolKind: 'openai-chat',
        };
      case 'ollama':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.ollama.baseUrl,
            apiKey: this.cfg.ai.ollama.apiKey || null,
            defaultModel: 'qwen3.5:9b',
          },
          protocolKind: 'ollama-native',
        };
      default:
        return null;
    }
  }
}
