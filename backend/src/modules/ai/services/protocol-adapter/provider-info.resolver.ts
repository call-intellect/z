import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';

import type {
  ProtocolAdapterProviderInfo,
  ProtocolKind,
} from './protocol-adapter.types';

/**
 * SBA α-10 wave 3 — резолв LlmProvider записи из БД в
 * ProtocolAdapterProviderInfo для адаптера.
 *
 * Кэширует записи в памяти на 60 секунд (как и LlmRouter.priceCache),
 * чтобы не бить БД на каждый LLM-вызов.
 *
 * Fallback: если в БД нет записи для провайдера (например, в test'е сидов
 * нет, либо feature-flag только что включили) — формируем info из ENV
 * cfg.ai.<name> (anthropic / openai-via-proxy / deepseek / ollama / minimax).
 * Это нужно, чтобы переход на registry не ломал прод даже если seed не
 * прогнан.
 */
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
      const info: ProtocolAdapterProviderInfo = {
        name: row.name,
        baseUrl: row.baseUrl,
        // ВНИМАНИЕ: schema хранит зашифрованный ключ. Расшифровка делается на
        // уровне crypto-сервиса; на wave 3 мы пока пробрасываем как есть.
        // Для adapter registry feature-flag=true в проде апи-ключи берутся
        // из ENV (см. ENV fallback ниже).
        apiKey: row.apiKeyEncrypted,
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

    // Fallback: формируем info из ENV.
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

  /**
   * Инвалидация кэша (вызывается из admin при изменении LlmProvider).
   */
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
