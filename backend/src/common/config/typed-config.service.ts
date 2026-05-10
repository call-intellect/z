import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Типизированная обёртка над `ConfigService`.
 * Группирует ENV по логическим разделам:
 *   cfg.runtime, cfg.db, cfg.redis, cfg.auth, cfg.cors, cfg.livekit,
 *   cfg.turn, cfg.s3, cfg.ai.*, cfg.crossmark, cfg.retention, cfg.idle,
 *   cfg.quotas, cfg.admin.
 *
 * Использовать ВЕЗДЕ вместо `process.env.*`.
 */
@Injectable()
export class TypedConfigService {
  constructor(
    @Inject(ConfigService) private readonly raw: ConfigService<Env, true>,
  ) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.raw.get(key, { infer: true }) as Env[K];
  }

  // ─────────────────────────── runtime ───────────────────────────
  get runtime() {
    return {
      nodeEnv: this.get('NODE_ENV'),
      port: this.get('PORT'),
      logLevel: this.get('LOG_LEVEL'),
      isProduction: this.get('NODE_ENV') === 'production',
      isDevelopment: this.get('NODE_ENV') === 'development',
      isTest: this.get('NODE_ENV') === 'test',
    } as const;
  }

  // ─────────────────────────── db / redis ────────────────────────
  get db() {
    return {
      url: this.get('DATABASE_URL'),
    } as const;
  }

  get redis() {
    return {
      url: this.get('REDIS_URL'),
    } as const;
  }

  // ─────────────────────────── auth ───────────────────────────────
  get auth() {
    const rawDomain = this.get('COOKIE_DOMAIN');
    const standaloneRaw = this.get('COOKIE_STANDALONE_DOMAIN') ?? rawDomain;
    // Для localhost браузеры (Chrome/Edge/Safari) не принимают cookie
    // с Domain=.localhost — игнорируют. В dev возвращаем undefined,
    // чтобы express не выставлял атрибут Domain — cookie будет привязан
    // к origin (localhost).
    const isLocal = (d: string) =>
      d === 'localhost' || d === '.localhost' || d.endsWith('.localhost');
    return {
      sessionSecret: this.get('JWT_SESSION_SECRET'),
      deepLinkSecret: this.get('JWT_DEEP_LINK_SECRET'),
      cookieDomain: isLocal(rawDomain) ? undefined : rawDomain,
      cookieStandaloneDomain: isLocal(standaloneRaw) ? undefined : standaloneRaw,
      publicFrontendUrl: this.get('PUBLIC_FRONTEND_URL'),
      sessionTtlSeconds: this.get('SESSION_TTL_SECONDS'),
      deepLinkTtlSeconds: this.get('DEEP_LINK_TTL_SECONDS'),
    } as const;
  }

  // ─────────────────────────── argon (standalone passwords) ─────
  get argon() {
    return {
      memoryKb: this.get('ARGON_MEMORY_KB'),
      iterations: this.get('ARGON_ITERATIONS'),
      parallelism: this.get('ARGON_PARALLELISM'),
    } as const;
  }

  // ─────────────────────────── mail (SMTP) ──────────────────────
  get mail() {
    return {
      host: this.get('MAIL_HOST'),
      port: this.get('MAIL_PORT'),
      ssl: this.get('MAIL_SSL'),
      username: this.get('MAIL_USERNAME'),
      password: this.get('MAIL_PASSWORD'),
      from: this.get('MAIL_FROM'),
      fromName: this.get('MAIL_FROM_NAME'),
      dryRun: this.get('MAIL_DRY_RUN'),
    } as const;
  }

  // ─────────────────────────── cors ───────────────────────────────
  /**
   * Источник CORS — `PUBLIC_FRONTEND_URL`. В dev добавляем localhost.
   */
  get cors() {
    const allowed: string[] = [this.get('PUBLIC_FRONTEND_URL')];
    if (this.runtime.isDevelopment) {
      allowed.push('http://localhost:3000', 'http://localhost:3001');
    }
    return { allowed } as const;
  }

  // ─────────────────────────── livekit ───────────────────────────
  get livekit() {
    return {
      apiUrl: this.get('LIVEKIT_API_URL'),
      apiKey: this.get('LIVEKIT_API_KEY'),
      apiSecret: this.get('LIVEKIT_API_SECRET'),
      webhookApiKey: this.get('LIVEKIT_WEBHOOK_API_KEY'),
      webhookApiSecret: this.get('LIVEKIT_WEBHOOK_API_SECRET'),
    } as const;
  }

  // ─────────────────────────── turn ───────────────────────────────
  get turn() {
    return {
      mode: this.get('TURN_MODE'),
      host: this.get('TURN_HOST'),
      port: this.get('TURN_PORT'),
      username: this.get('TURN_USERNAME'),
      password: this.get('TURN_PASSWORD'),
      tls: this.get('TURN_TLS'),
    } as const;
  }

  // ─────────────────────────── s3 ─────────────────────────────────
  get s3() {
    return {
      endpointUrl: this.get('S3_ENDPOINT_URL'),
      region: this.get('S3_REGION'),
      bucket: this.get('S3_BUCKET'),
      accessKey: this.get('S3_ACCESS_KEY'),
      secretKey: this.get('S3_SECRET_KEY'),
      presignedTtlSeconds: this.get('S3_PRESIGNED_TTL_SECONDS'),
    } as const;
  }

  // ─────────────────────────── ai ─────────────────────────────────
  get ai() {
    return {
      anthropic: {
        apiKey: this.get('ANTHROPIC_API_KEY'),
        model: this.get('ANTHROPIC_MODEL'),
        useProxy: this.get('ANTHROPIC_USE_PROXY'),
        proxyUrl: this.get('ANTHROPIC_PROXY_URL'),
      },
      vox: {
        apiUrl: this.get('VOX_API_URL'),
        apiToken: this.get('VOX_API_TOKEN'),
        model: this.get('VOX_MODEL'),
        language: this.get('VOX_LANGUAGE'),
        punctuationMode: this.get('VOX_PUNCTUATION_MODE'),
      },
      openai: {
        apiKey: this.get('OPENAI_API_KEY'),
        baseUrl: this.get('OPENAI_BASE_URL'),
      },
      deepseek: {
        apiKey: this.get('DEEPSEEK_API_KEY'),
      },
      minimax: {
        apiKey: this.get('MINIMAX_API_KEY'),
        baseUrl: this.get('MINIMAX_BASE_URL'),
      },
      grsai: {
        apiKey: this.get('GRSAI_API_KEY'),
        baseUrl: this.get('GRSAI_BASE_URL'),
      },
      kie: {
        apiKey: this.get('KIE_API_KEY'),
        baseUrl: this.get('KIE_BASE_URL'),
      },
      proxy: {
        baseUrl: this.get('PROXY_BASE_URL'),
        prefix: this.get('PROXY_PREFIX'),
      },
      embeddings: {
        provider: this.get('EMBEDDING_PROVIDER'),
        model: this.get('EMBEDDING_MODEL'),
        dimensions: this.get('EMBEDDING_DIMENSIONS'),
        proxyApiKey: this.get('OPENAI_PROXY_API_KEY'),
        proxyEmbeddingsUrl: this.get('OPENAI_PROXY_EMBEDDINGS_URL'),
        fallbackLocalUrl: this.get('EMBEDDING_FALLBACK_LOCAL_URL'),
        batchSize: this.get('EMBEDDING_BATCH_SIZE'),
        chunkTargetTokens: this.get('EMBEDDING_CHUNK_TARGET_TOKENS'),
        chunkOverlapTokens: this.get('EMBEDDING_CHUNK_OVERLAP_TOKENS'),
      },
    } as const;
  }

  // ─────────────────────────── crossmark ─────────────────────────
  get crossmark() {
    return {
      hmacTimestampWindowSeconds: this.get('CROSSMARK_HMAC_TIMESTAMP_WINDOW_SECONDS'),
    } as const;
  }

  // ─────────────────────────── retention ─────────────────────────
  get retention() {
    return {
      defaultDays: this.get('DEFAULT_RETENTION_DAYS'),
      cron: this.get('RETENTION_CRON'),
      softDeleteGraceDays: this.get('SOFT_DELETE_GRACE_DAYS'),
      webhookDeliveryDays: this.get('WEBHOOK_DELIVERY_RETENTION_DAYS'),
      shareViewDays: this.get('SHARE_VIEW_RETENTION_DAYS'),
      apiAccessLogDays: this.get('API_ACCESS_LOG_RETENTION_DAYS'),
    } as const;
  }

  // ─────────────────────────── webhooks-out ──────────────────────
  get webhooksOut() {
    return {
      encryptionKey: this.get('WEBHOOK_SECRETS_ENCRYPTION_KEY'),
      deliveryTimeoutMs: this.get('WEBHOOK_DELIVERY_TIMEOUT_MS'),
      maxAttempts: this.get('WEBHOOK_MAX_ATTEMPTS'),
      egressAllowedHosts: this.get('WEBHOOK_EGRESS_ALLOWED_HOSTS')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    } as const;
  }

  // ─────────────────────────── workspace limits / quotas ────────
  get workspace() {
    return {
      clipMaxDurationSeconds: this.get('CLIP_MAX_DURATION_SECONDS'),
      exportZipMaxMeetings: this.get('EXPORT_ZIP_MAX_MEETINGS'),
      exportZipMaxBytes: this.get('EXPORT_ZIP_MAX_SIZE_BYTES'),

      maxApiKeysPerUser: this.get('MAX_API_KEYS_PER_USER'),
      maxWebhookSubscriptionsPerUser: this.get('MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER'),
      maxDestinationsPerUser: this.get('MAX_DESTINATIONS_PER_USER'),
      maxTagsPerUser: this.get('MAX_TAGS_PER_USER'),
      maxUserTemplatesPerUser: this.get('MAX_USER_TEMPLATES_PER_USER'),

      maxChatRequestsPerDay: this.get('MAX_CHAT_REQUESTS_PER_DAY'),
      maxChatTokensPerDay: this.get('MAX_CHAT_TOKENS_PER_DAY'),
      maxRenderJobsPerHour: this.get('MAX_RENDER_JOBS_PER_HOUR'),
      maxBulkExportsPerDay: this.get('MAX_BULK_EXPORTS_PER_DAY'),
      maxRegeneratePerMeetingPerDay: this.get('MAX_REGENERATE_PER_MEETING_PER_DAY'),
      maxMeetingsCreatedPerDayViaApi: this.get('MAX_MEETINGS_CREATED_PER_DAY_VIA_API'),
      maxEmbeddingTokensPerMonth: this.get('MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER'),

      maxHighlightsPerMeeting: this.get('MAX_HIGHLIGHTS_PER_MEETING'),
      maxBulkOperationIds: this.get('MAX_BULK_OPERATION_IDS'),
      maxChatMessageChars: this.get('MAX_CHAT_MESSAGE_CHARS'),
      maxRoomMessageChars: this.get('MAX_ROOM_MESSAGE_CHARS'),

      maxCardsPerUser: this.get('MAX_CARDS_PER_USER'),
      maxCardRollupsPerDay: this.get('MAX_CARD_ROLLUPS_PER_DAY'),
    } as const;
  }

  // ─────────────────────────── ai feature flags ─────────────────
  /**
   * Feature-flags AI-pipeline. Отдельный геттер, чтобы не раздувать
   * `cfg.ai` (там и так много провайдеров).
   */
  get aiFeatures() {
    return {
      includeRoomChat: this.get('INCLUDE_ROOM_CHAT_IN_AI'),
    } as const;
  }

  get hashing() {
    return {
      ipDailySalt: this.get('IP_HASH_DAILY_SALT'),
    } as const;
  }

  get share() {
    return {
      tokenLengthBytes: this.get('SHARE_TOKEN_LENGTH_BYTES'),
      defaultExpirationDays: this.get('SHARE_DEFAULT_EXPIRATION_DAYS'),
      allowedExpirationDays: this.get('SHARE_ALLOWED_EXPIRATION_DAYS') as readonly number[],
    } as const;
  }

  // ─────────────────────────── ingest (Фаза 1 knowledge-core) ────
  get ingest() {
    return {
      internalToken: this.get('INGEST_INTERNAL_TOKEN'),
    } as const;
  }

  // ─────────────────────────── idle ──────────────────────────────
  get idle() {
    return {
      timeoutMinutes: this.get('IDLE_MEETING_TIMEOUT_MINUTES'),
      cron: this.get('IDLE_MEETING_CRON'),
    } as const;
  }

  // ─────────────────────────── quotas ────────────────────────────
  get quotas() {
    return {
      maxParticipantsPerMeeting: this.get('MAX_PARTICIPANTS_PER_MEETING'),
      maxMeetingDurationHours: this.get('MAX_MEETING_DURATION_HOURS'),
    } as const;
  }

  // ─────────────────────────── admin ─────────────────────────────
  get admin() {
    return {
      bootstrapEmail: this.get('ADMIN_BOOTSTRAP_EMAIL'),
      sessionTtlSeconds: this.get('ADMIN_SESSION_TTL_SECONDS'),
    } as const;
  }

  // Удобный шорткат для main.ts
  get port(): number {
    return this.runtime.port;
  }
}
