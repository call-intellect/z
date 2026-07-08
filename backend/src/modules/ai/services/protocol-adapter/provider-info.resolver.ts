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
  private dbChecked = false;
  private dbHasProviders = false;

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
      // Ф3 — резолв эффективного подключения (единственная реализация; см.
      // раздел «Резолв эффективного подключения» ТЗ 2026-07-02): прокси-тумблер
      // провайдера перекрывает baseUrl/apiKey, ключ префиксуется PROXY_PREFIX.
      const proxyRoot = this.cfg.ai.proxy.baseUrl.replace(/\/v1\/?$/, '');
      const effectiveBaseUrl = !row.useProxy
        ? row.baseUrl
        : row.proxyPath
          ? `${proxyRoot}/${row.proxyPath}/v1`
          : this.cfg.ai.proxy.baseUrl;
      const decryptedApiKey =
        row.apiKeyEncrypted && this.crypto.isEncrypted(row.apiKeyEncrypted)
          ? this.crypto.decrypt(row.apiKeyEncrypted)
          : row.apiKeyEncrypted;
      const effectiveApiKey =
        row.useProxy && decryptedApiKey
          ? `${this.cfg.ai.proxy.prefix}:${decryptedApiKey}`
          : decryptedApiKey;
      const info: ProtocolAdapterProviderInfo = {
        name: row.name,
        baseUrl: effectiveBaseUrl,
        apiKey: effectiveApiKey,
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

    const envInfo = await this.buildFromEnvIfDbEmpty(name);
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
    this.dbChecked = false;
  }

  private async buildFromEnvIfDbEmpty(name: string): Promise<{
    info: ProtocolAdapterProviderInfo;
    protocolKind: ProtocolKind;
  } | null> {
    if (!this.dbChecked) {
      try {
        const count = await this.prisma.llmProvider.count({
          where: { deletedAt: null },
        });
        this.dbHasProviders = count > 0;
      } catch (err) {
        this.logger.warn(
          `ProviderInfoResolver: db count failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.dbChecked = true;
    }
    if (this.dbHasProviders) return null;
    return this.buildFromEnv(name);
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
            // Легаси OpenAiProxyService всегда ходит через прокси и всегда
            // префиксует ключ `${PROXY_PREFIX}:${OPENAI_API_KEY}` (см. его
            // конструктор) — buildFromEnv обязан вернуть тот же готовый к
            // использованию ключ, иначе override.apiKey уйдёт в прокси без
            // префикса и получит 401.
            apiKey: `${this.cfg.ai.proxy.prefix}:${this.cfg.ai.openai.apiKey}`,
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
      case 'kie':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.kie.baseUrl,
            apiKey: this.cfg.ai.kie.apiKey,
            timeoutMs: this.cfg.ai.kie.timeoutMs,
          },
          protocolKind: 'kie-native',
        };
      case 'grsai':
        return {
          info: {
            name,
            baseUrl: this.cfg.ai.grsai.baseUrl,
            apiKey: this.cfg.ai.grsai.apiKey,
          },
          protocolKind: 'grsai-native',
        };
      default:
        return null;
    }
  }
}
