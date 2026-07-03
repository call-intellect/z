import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type Entity, type EntityType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  ENTITY_CREATED,
  ENTITY_UPDATED,
  type EntitySyncEventName,
} from '../../tables/events/entity-sync.events';

import { KnowledgeEmbeddingService } from './embedding.service';
import { canonicalizeEntityIds, setPersonEntity } from './entity-companion.helpers';

export function normalizeEntityName(input: string): string {
  if (!input) return '';
  return input
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/["'«»“”„‟]/g, '');
}

export interface RoleLookupPrisma {
  role: {
    findMany(args: {
      where: { tenantId: string; deletedAt: null };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
}

export async function resolveRoleIdByName(
  prisma: RoleLookupPrisma,
  tenantId: string,
  hint: string,
): Promise<string | null> {
  const normalized = normalizeEntityName(hint);
  if (normalized.length === 0) return null;

  const roles = await prisma.role.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (roles.length === 0) return null;

  const lowered = normalized.toLowerCase();
  const exact = roles.find((r) => r.name.trim().toLowerCase() === lowered);
  if (exact) return exact.id;

  const fuzzy = roles.filter((r) => {
    const rn = r.name.trim().toLowerCase();
    return rn.includes(lowered) || lowered.includes(rn);
  });
  if (fuzzy.length === 1 && fuzzy[0]) return fuzzy[0].id;
  return null;
}

/**
 * EntityResolutionService (Шаг 2 baseline + Фаза 0b расширения):
 *
 *   - `findOrCreateEntity` — findOrCreate по `(tenantId, type, lower(canonicalName))`.
 *     На повторное упоминание — `mentionsCount += 1`, метаданные мерджатся.
 *   - `resolveRoleByHint` / `resolvePersonByHint` — резолв «hint»-имён из
 *     extraction'а (ownerRoleHint, decidedByPersonHint) в реальные id.
 *   - `resolveTypedEntity` — дедуп типизированных сущностей группы Б
 *     (Process/Regulation/Policy/Metric/Tool). См. ТЗ 0b §8.2.
 *   - `linkPersonEntity` / `linkEntityPerson` — линковка Entity{type=person} ↔
 *     Person (ТЗ 0b §8.3).
 *
 * LLM-арбитражная дедупликация дубликатов с разными вариантами написания —
 * Шаг 4 (`entity-resolver.worker`). Здесь — простая нормализация + cosine на
 * embedding'е имени, LLM-arbiter оставлен TODO.
 */
@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    // KC-Temporal W1.5 — Optional, чтобы интеграционные spec'и могли
    // сконструировать сервис с двумя аргументами (как делает уже существующий
    // entity-resolution.service.spec.ts).
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
    @Optional()
    @Inject(CoreQueueService)
    private readonly coreQueue?: CoreQueueService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    // Smart-tables Фаза 2 — live entitySync. Эмитим entity.created/updated
    // после успешного create/обновления, чтобы TableSyncListener (модуль
    // tables) поддерживал строки системных таблиц. @Optional: интеграционные
    // spec'и конструируют сервис с двумя аргументами — без эмиттера эмит
    // просто пропускается (no-op).
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
    @Optional()
    @Inject(LlmRouterService)
    private readonly llm?: LlmRouterService,
  ) {}

  /**
   * Smart-tables Фаза 2 — best-effort эмит события графа для live entitySync.
   * Никогда не бросает в основной поток: при отсутствии эмиттера или ошибке
   * подписчика логируем debug и продолжаем. EventEmitter2.emit синхронный, но
   * на всякий случай оборачиваем в try/catch (sync-исключение подписчика).
   */
  private emitEntityEvent(
    name: EntitySyncEventName,
    entity: { id: string; tenantId: string; type: EntityType },
  ): void {
    if (!this.events) return;
    try {
      this.events.emit(name, {
        tenantId: entity.tenantId,
        entityId: entity.id,
        entityType: entity.type,
      });
    } catch (err) {
      this.logger.debug(
        {
          event: name,
          entityId: entity.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-sync: эмит события не удался (best-effort) — продолжаем',
      );
    }
  }

  /**
   * KC-Temporal W1.5 — синхронный resolver: exact match (raw SQL, без findMany+filter)
   *   → Redis cache hit
   *   → KNN top-3 cosine raw SQL → если ≥ threshold (default 0.95) → reuse
   *   → иначе создаём новую сущность + enqueue entity-resolver worker для глубокого LLM-арбитра.
   *
   * Метрики `kc_entity_resolve_path_total{path}` и `kc_entity_resolve_latency_ms`
   * пишутся на каждый вызов. См. ТЗ §W1.5.
   */
  async findOrCreateEntity(args: {
    tenantId: string;
    type: EntityType;
    name: string;
    metadata?: Record<string, unknown>;
    // KC-Temporal W3.4 — strong-IDs. Если заданы — пытаемся резолвить по ним
    // ДО exact-name / KNN. Уникальность защищена partial unique indices
    // (см. postgres-init.sql `Entity_strong_*_uniq`).
    inn?: string | null;
    ogrn?: string | null;
    email?: string | null;
    phone?: string | null;
    domain?: string | null;
  }): Promise<{ entity: Entity; created: boolean }> {
    const normalized = args.name.trim();
    if (normalized.length === 0) {
      throw new Error('EntityResolution: пустое имя сущности');
    }
    const lowered = normalized.toLowerCase();
    const startedAt = Date.now();
    const observeLatency = (): void => {
      this.metrics?.observeKcEntityResolveLatencyMs(Date.now() - startedAt);
    };

    // 0. KC-Temporal W3.4 — резолв по сильным идентификаторам (ИНН/ОГРН/
    //    email/domain). Phone — lookup, но не unique (один номер у нескольких
    //    контактов). Это ПЕРЕД exact-name match: ИНН строже имени.
    const strong = this.normalizeStrongIds(args);
    const strongHit = await this.resolveByStrongIds({
      tenantId: args.tenantId,
      type: args.type,
      ...strong,
    });
    if (strongHit) {
      const merged = this.mergeMetadata(strongHit.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id_tenantId: { id: strongHit.id, tenantId: args.tenantId } },
        data: {
          mentionsCount: { increment: 1 },
          // Заполняем пустые strong-поля (если новый вызов принёс данные,
          // которых не было в существующей сущности).
          ...(strong.inn && !strongHit.inn ? { inn: strong.inn } : {}),
          ...(strong.ogrn && !strongHit.ogrn ? { ogrn: strong.ogrn } : {}),
          ...(strong.email && !strongHit.email ? { email: strong.email } : {}),
          ...(strong.phone && !strongHit.phone ? { phone: strong.phone } : {}),
          ...(strong.domain && !strongHit.domain ? { domain: strong.domain } : {}),
          ...(merged !== undefined ? { metadata: merged } : {}),
        },
      });
      // Кладём в cache по имени, чтобы повторный resolve по имени тоже работал.
      const cacheKey = this.buildCacheKey(args.tenantId, args.type, lowered);
      await this.writeCache(cacheKey, updated.id);
      this.metrics?.incKcEntityResolvePath({ path: 'strong_id' });
      observeLatency();
      this.emitEntityEvent(ENTITY_UPDATED, updated);
      return { entity: updated, created: false };
    }

    // 1. Redis cache hit — горячее имя возвращаем без БД-вызова.
    const cacheKey = this.buildCacheKey(args.tenantId, args.type, lowered);
    const cachedId = await this.readCache(cacheKey);
    if (cachedId) {
      const cached = await this.prisma.entity.findUnique({
        where: { id_tenantId: { id: cachedId, tenantId: args.tenantId } },
      });
      // mergedIntoId ≠ null означает, что cache устарел: сущность слита.
      if (cached && cached.mergedIntoId === null) {
        const merged = this.mergeMetadata(cached.metadata, args.metadata);
        const updated = await this.prisma.entity.update({
          where: { id_tenantId: { id: cached.id, tenantId: args.tenantId } },
          data: {
            mentionsCount: { increment: 1 },
            ...(merged !== undefined ? { metadata: merged } : {}),
          },
        });
        this.metrics?.incKcEntityResolvePath({ path: 'cache_hit' });
        observeLatency();
        this.emitEntityEvent(ENTITY_UPDATED, updated);
        return { entity: updated, created: false };
      }
      // Cache miss: запись устарела — удаляем ключ, дальше идём обычным путём.
      await this.deleteCache(cacheKey);
    }

    // 2. Exact match — раз-запрос вместо findMany+filter (см. W1.5 §1).
    const exact = await this.findExactByLowerName(
      args.tenantId,
      args.type,
      lowered,
    );
    if (exact) {
      const found = await this.prisma.entity.findUnique({
        where: { id_tenantId: { id: exact.id, tenantId: args.tenantId } },
      });
      if (found) {
        const merged = this.mergeMetadata(found.metadata, args.metadata);
        const updated = await this.prisma.entity.update({
          where: { id_tenantId: { id: found.id, tenantId: args.tenantId } },
          data: {
            mentionsCount: { increment: 1 },
            // W3.4 backfill: если caller передал strong-ID, которого нет у
            // существующей Entity — записываем его. Это симметрично ветке
            // strong-ID match выше и закрывает кейс «создали без ИНН, через
            // exact-name пришёл ИНН».
            ...(strong.inn && !found.inn ? { inn: strong.inn } : {}),
            ...(strong.ogrn && !found.ogrn ? { ogrn: strong.ogrn } : {}),
            ...(strong.email && !found.email ? { email: strong.email } : {}),
            ...(strong.phone && !found.phone ? { phone: strong.phone } : {}),
            ...(strong.domain && !found.domain ? { domain: strong.domain } : {}),
            ...(merged !== undefined ? { metadata: merged } : {}),
          },
        });
        if (args.type === 'person') {
          await this.linkEntityPerson({
            tenantId: args.tenantId,
            entityId: updated.id,
          }).catch((err) => {
            this.logger.warn(
              {
                entityId: updated.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'entity↔person линковка не удалась (продолжаем без линка)',
            );
          });
        }
        await this.writeCache(cacheKey, updated.id);
        this.metrics?.incKcEntityResolvePath({ path: 'exact' });
        observeLatency();
        this.emitEntityEvent(ENTITY_UPDATED, updated);
        return { entity: updated, created: false };
      }
    }

    // 3. KNN top-3 cosine.
    const knnHit = await this.knnResolve({
      tenantId: args.tenantId,
      type: args.type,
      name: normalized,
    });
    if (knnHit) {
      const merged = this.mergeMetadata(knnHit.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id_tenantId: { id: knnHit.id, tenantId: args.tenantId } },
        data: {
          mentionsCount: { increment: 1 },
          // Б44 [K4] W3.4 backfill: если caller передал strong-ID, которого
          // нет у найденной по KNN сущности — записываем его. Симметрично
          // strong-ID и exact-name веткам выше. Без этого KNN-reuse оставлял
          // ИНН/домен пустыми → следующий вызов с тем же ИНН не находил по
          // strong-ID и плодил дубль.
          ...(strong.inn && !knnHit.inn ? { inn: strong.inn } : {}),
          ...(strong.ogrn && !knnHit.ogrn ? { ogrn: strong.ogrn } : {}),
          ...(strong.email && !knnHit.email ? { email: strong.email } : {}),
          ...(strong.phone && !knnHit.phone ? { phone: strong.phone } : {}),
          ...(strong.domain && !knnHit.domain ? { domain: strong.domain } : {}),
          ...(merged !== undefined ? { metadata: merged } : {}),
        },
      });
      if (args.type === 'person') {
        await this.linkEntityPerson({
          tenantId: args.tenantId,
          entityId: updated.id,
        }).catch((err) => {
          this.logger.warn(
            {
              entityId: updated.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity↔person линковка не удалась (KNN-match, продолжаем)',
          );
        });
      }
      await this.writeCache(cacheKey, updated.id);
      this.metrics?.incKcEntityResolvePath({ path: 'knn' });
      observeLatency();
      this.emitEntityEvent(ENTITY_UPDATED, updated);
      return { entity: updated, created: false };
    }

    // 4. Не нашли. Создаём + enqueue async resolver на глубокий LLM-арбитраж.
    //    W3.4 — если caller передал strong-IDs, сохраняем их в выделенные
    //    колонки (partial unique защитит от гонки на уровне БД).
    const created = await this.prisma.entity.create({
      data: {
        tenantId: args.tenantId,
        type: args.type,
        canonicalName: normalized,
        mentionsCount: 1,
        metadata: (args.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ...(strong.inn ? { inn: strong.inn } : {}),
        ...(strong.ogrn ? { ogrn: strong.ogrn } : {}),
        ...(strong.email ? { email: strong.email } : {}),
        ...(strong.phone ? { phone: strong.phone } : {}),
        ...(strong.domain ? { domain: strong.domain } : {}),
      },
    });
    try {
      const [vec] = await this.embeddings.embedEntityNames([normalized]);
      if (vec) {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Entity" SET embedding = $1::vector(1536) WHERE id = $2',
          this.toVectorLiteral(vec),
          created.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          entityId: created.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity: не удалось проставить embedding — продолжаем без него',
      );
    }
    if (args.type === 'person') {
      await this.linkEntityPerson({
        tenantId: args.tenantId,
        entityId: created.id,
      }).catch((err) => {
        this.logger.warn(
          {
            entityId: created.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity↔person линковка нового Entity не удалась',
        );
      });
    }
    // Async resolver — best-effort, не ронять flow на ошибке очереди.
    if (this.coreQueue) {
      await this.coreQueue
        .enqueueEntityResolver(created.id)
        .catch((err) => {
          this.logger.debug(
            {
              entityId: created.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-resolver enqueue упал (W1.5) — продолжаем',
          );
        });
    }
    await this.writeCache(cacheKey, created.id);
    this.metrics?.incKcEntityResolvePath({ path: 'create' });
    observeLatency();
    this.emitEntityEvent(ENTITY_CREATED, created);
    return { entity: created, created: true };
  }

  // ─────────────────────────── KC-Temporal W1.5 helpers ───────────────────
  /**
   * Exact match через raw SQL: `LOWER(canonicalName) = $3` + tenant/type/
   * mergedIntoId IS NULL. Возвращает {id} или null. Замена findMany+filter,
   * чтобы не тянуть всех сущностей тенанта в память.
   */
  private async findExactByLowerName(
    tenantId: string,
    type: EntityType,
    loweredName: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT id
      FROM "Entity"
      WHERE "tenantId" = $1
        AND "type"::text = $2
        AND LOWER("canonicalName") = $3
        AND "mergedIntoId" IS NULL
      LIMIT 1
      `,
      tenantId,
      type,
      loweredName,
    );
    return rows[0] ?? null;
  }

  /**
   * KNN top-3 cosine raw SQL. Если best similarity >= threshold
   * (cfg.entityIngest.resolveThreshold, default 0.95) — возвращает
   * сущность для reuse. Иначе null.
   *
   * pgvector: `embedding <=> $1::vector` → cosine distance ([0..2]; для
   * нормированных embedding'ов text-embedding-3-small это [0..1]).
   * similarity = 1 - distance.
   */
  private async knnResolve(args: {
    tenantId: string;
    type: EntityType;
    name: string;
  }): Promise<Entity | null> {
    if (!this.embeddings) return null;
    let vec: number[] | undefined;
    try {
      const out = await this.embeddings.embedEntityNames([args.name]);
      vec = out[0];
    } catch (err) {
      this.logger.debug(
        {
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-resolution KNN: embed упал — fallback на create',
      );
      return null;
    }
    if (!vec || vec.length === 0) return null;

    const threshold = this.cfg?.entityIngest.resolveThreshold ?? 0.95;
    interface Row {
      id: string;
      distance: string | number;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT id, embedding <=> $1::vector(1536) AS distance
        FROM "Entity"
        WHERE "tenantId" = $2
          AND "type"::text = $3
          AND "mergedIntoId" IS NULL
          AND embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT 3
        `,
        this.toVectorLiteral(vec),
        args.tenantId,
        args.type,
      );
    } catch (err) {
      // Если KNN-запрос упал (например, нет pgvector в test DB) — мягкий fallback.
      this.logger.debug(
        {
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-resolution KNN: pgvector query упал — fallback на create',
      );
      return null;
    }
    if (rows.length === 0) return null;
    const best = rows[0];
    if (!best) return null;
    const dist =
      typeof best.distance === 'string' ? Number(best.distance) : best.distance;
    if (!Number.isFinite(dist)) return null;
    const similarity = 1 - dist;
    if (similarity < threshold) return null;
    const entity = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id: best.id, tenantId: args.tenantId } },
    });
    return entity;
  }

  // ─────────────────────────── KC-Temporal W3.4: strong-IDs ───────────────

  /**
   * Нормализует strong-IDs из args:
   *   - ИНН/ОГРН — оставляем только цифры (10/12 для ИНН, 13/15 для ОГРН/ОГРНИП).
   *   - email   — trim + lowercase.
   *   - phone   — trim, оставляем только `+` и цифры (E.164-friendly).
   *   - domain  — trim, lowercase, без `https://` / `www.`.
   * Возвращает `null` для пустых/невалидных значений (короче минимума).
   */
  private normalizeStrongIds(args: {
    inn?: string | null;
    ogrn?: string | null;
    email?: string | null;
    phone?: string | null;
    domain?: string | null;
  }): {
    inn: string | null;
    ogrn: string | null;
    email: string | null;
    phone: string | null;
    domain: string | null;
  } {
    const innRaw = (args.inn ?? '').replace(/\D/g, '');
    const inn = innRaw.length === 10 || innRaw.length === 12 ? innRaw : null;

    const ogrnRaw = (args.ogrn ?? '').replace(/\D/g, '');
    const ogrn = ogrnRaw.length === 13 || ogrnRaw.length === 15 ? ogrnRaw : null;

    const emailRaw = (args.email ?? '').trim().toLowerCase();
    const email = emailRaw.includes('@') && emailRaw.length >= 5 ? emailRaw : null;

    const phoneRaw = (args.phone ?? '').trim();
    const phoneCleaned = phoneRaw.replace(/[^\d+]/g, '');
    const phone = phoneCleaned.length >= 7 ? phoneCleaned : null;

    let domainRaw = (args.domain ?? '').trim().toLowerCase();
    domainRaw = domainRaw.replace(/^https?:\/\//, '').replace(/^www\./, '');
    // Срезаем path/query, если попало (например `example.com/foo`).
    domainRaw = domainRaw.split('/')[0] ?? '';
    const domain = domainRaw.includes('.') && domainRaw.length >= 3 ? domainRaw : null;

    return { inn, ogrn, email, phone, domain };
  }

  /**
   * Поиск Entity по сильным идентификаторам в порядке строгости:
   *   ИНН → ОГРН → email → domain → phone.
   * Возвращает первую найденную сущность (mergedIntoId IS NULL) в рамках
   * (tenantId, type). Если ни один strong-ID не задан — возвращает null.
   *
   * Каждый шаг — отдельный raw SQL по соответствующему partial-индексу
   * (Entity_strong_*_uniq/Entity_strong_phone_idx). За один проход
   * максимум 5 запросов, но в проде обычно ≤ 1-2 (типичный case: либо
   * customer с ИНН, либо person с email).
   */
  private async resolveByStrongIds(args: {
    tenantId: string;
    type: EntityType;
    inn: string | null;
    ogrn: string | null;
    email: string | null;
    phone: string | null;
    domain: string | null;
  }): Promise<Entity | null> {
    const lookupField = async (
      column: 'inn' | 'ogrn' | 'email' | 'domain' | 'phone',
      value: string,
    ): Promise<Entity | null> => {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
        SELECT id
        FROM "Entity"
        WHERE "tenantId" = $1
          AND "type"::text = $2
          AND "${column}" = $3
          AND "mergedIntoId" IS NULL
        LIMIT 1
        `,
        args.tenantId,
        args.type,
        value,
      );
      const hit = rows[0];
      if (!hit) return null;
      return this.prisma.entity.findUnique({
        where: { id_tenantId: { id: hit.id, tenantId: args.tenantId } },
      });
    };

    if (args.inn) {
      const e = await lookupField('inn', args.inn);
      if (e) return e;
    }
    if (args.ogrn) {
      const e = await lookupField('ogrn', args.ogrn);
      if (e) return e;
    }
    if (args.email) {
      const e = await lookupField('email', args.email);
      if (e) return e;
    }
    if (args.domain) {
      const e = await lookupField('domain', args.domain);
      if (e) return e;
    }
    // Phone — последним, т.к. не unique (один номер у нескольких контактов).
    // LIMIT 1 возвращает первый матч, но если в Org несколько Entity с одним
    // phone — это ОК-fallback (не worse чем имя).
    if (args.phone) {
      const e = await lookupField('phone', args.phone);
      if (e) return e;
    }
    return null;
  }

  /** Redis ключ кеша resolved-сущности. */
  private buildCacheKey(
    tenantId: string,
    type: EntityType,
    loweredName: string,
  ): string {
    const hash = createHash('sha1').update(loweredName).digest('hex');
    return `entity-resolve:${tenantId}:${type}:${hash}`;
  }

  private async readCache(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      const v = await this.redis.client.get(key);
      return v ?? null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, entityId: string): Promise<void> {
    if (!this.redis) return;
    const ttl = this.cfg?.entityIngest.cacheTtlSeconds ?? 3600;
    try {
      await this.redis.client.set(key, entityId, 'EX', ttl);
    } catch {
      // fail-open: cache недоступен — не ломаем основной flow.
    }
  }

  private async deleteCache(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client.del(key);
    } catch {
      // молча.
    }
  }

  // ─────────────────────────── Б29 [K6]: negative-cache пар ────────────────
  //
  // entity-resolver-cron каждые 5 минут находит пары-кандидаты (cosine >
  // threshold) и шлёт их LLM-арбитру. Без негативного маркера арбитр-вердикт
  // `distinct` НЕ персистится → одна и та же пара перепроверяется каждые 5
  // минут навсегда (раннавей-расход LLM). Фикс: после вердикта `distinct`
  // worker пишет negative-cache по упорядоченной паре (minId, maxId), а cron
  // исключает уже-судёные distinct-пары из выборки кандидатов.
  //
  // Хранилище — Redis (без миграции): TTL ограничивает «вечную» память (если
  // сущности реально изменятся, эмбеддинг сдвинется — после TTL пара снова
  // попадёт под суд). Ключ симметричен по паре (порядок id не важен).

  /** Redis-ключ negative-cache для пары сущностей (упорядоченная пара). */
  private buildPairNegativeKey(idA: string, idB: string): string {
    const [lo, hi] = idA < idB ? [idA, idB] : [idB, idA];
    return `entity-merge:distinct:${lo}:${hi}`;
  }

  /**
   * TTL negative-cache распознанных distinct-пар. Переиспользуем
   * `ENTITY_INGEST_RESOLVE_CACHE_TTL_S`, но не меньше суток — пара признана
   * РАЗНЫМИ, перепроверять её каждый час смысла нет (эмбеддинги имён почти
   * статичны). Дефолт 7 дней.
   */
  private pairNegativeTtlSeconds(): number {
    const base = this.cfg?.entityIngest.cacheTtlSeconds ?? 3600;
    const week = 7 * 24 * 3600;
    return Math.max(base, week);
  }

  /**
   * Помечает пару сущностей как «арбитр решил: РАЗНЫЕ» (verdict='distinct').
   * Вызывается worker'ом после LLM-вердикта distinct. Best-effort: при
   * отсутствии Redis или ошибке — no-op (хуже-случай = повторный суд, как до
   * фикса, не падение).
   */
  async markEntityPairDistinct(idA: string, idB: string): Promise<void> {
    if (!this.redis) return;
    if (idA === idB) return;
    try {
      await this.redis.client.set(
        this.buildPairNegativeKey(idA, idB),
        '1',
        'EX',
        this.pairNegativeTtlSeconds(),
      );
    } catch {
      // fail-open: negative-cache недоступен — не ломаем merge-flow.
    }
  }

  /**
   * Возвращает true, если пара уже судилась и признана distinct (есть в
   * negative-cache). Используется cron'ом для исключения уже-судёных пар.
   * Best-effort: при отсутствии Redis / ошибке — false (= не исключаем,
   * безопасный дефолт «пусть пересудят»).
   */
  async isEntityPairDistinct(idA: string, idB: string): Promise<boolean> {
    if (!this.redis) return false;
    if (idA === idB) return false;
    try {
      const v = await this.redis.client.get(this.buildPairNegativeKey(idA, idB));
      return v != null;
    } catch {
      return false;
    }
  }

  // ─────────────────────────── Фаза 0b: hint resolvers ─────────────────────

  /**
   * Резолвит подсказку имени должности (`ownerRoleHint` из extraction'а)
   * в реальный Role.id. Алгоритм:
   *   1. Точное совпадение нормализованного имени (case-insensitive).
   *   2. ILIKE-fuzzy (содержит подстроку) среди активных Role.
   *
   * Возвращает null, если кандидатов нет или их > 1 (неоднозначность).
   * LLM-arbiter — TODO (Фаза γ).
   */
  async resolveRoleByHint(
    tenantId: string,
    hint: string,
  ): Promise<string | null> {
    const resolved = await resolveRoleIdByName(this.prisma, tenantId, hint);
    if (resolved) return resolved;

    const normalized = this.normalizeName(hint);
    if (normalized.length === 0) return null;
    const lowered = normalized.toLowerCase();
    const roles = await this.prisma.role.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    const fuzzy = roles.filter((r) => {
      const rn = r.name.trim().toLowerCase();
      return rn.includes(lowered) || lowered.includes(rn);
    });
    if (fuzzy.length > 1) {
      this.logger.debug(
        { tenantId, hint, candidates: fuzzy.length },
        'resolveRoleByHint: неоднозначная подсказка — пропуск',
      );
    }
    return null;
  }

  /**
   * Резолвит подсказку имени персоны (`decidedByPersonHint` / упоминание
   * «Настя» из транскрипта) в реальный Person.id. Каскад резолва:
   *   0. нормализация имени;
   *   1. exact name (case-insensitive) → cache alias + return;
   *   2. per-Org alias-cache (EntityAlias) → проверка живости Person → return;
   *   3. fuzzy substring: ровно 1 → cache alias + return;
   *   4. эмбеддинг-склейка (cosine Person→Entity.embedding): ровно 1 ≥ порога
   *      (knowledge.entity_name_resolve_threshold, default 0.9) → cache + return;
   *      ≥2 → неоднозначно → к арбитру;
   *   5. LLM-арбитр (опц., fail-closed): только при наличии llm + context;
   *      уверенный выбор → cache + return, иначе null.
   *
   * R-2 fail-closed: при любой неоднозначности без явного разрешения — null;
   * разных людей НИКОГДА не склеиваем.
   */
  async resolvePersonByHint(
    tenantId: string,
    hint: string,
    context?: string,
  ): Promise<string | null> {
    const normalized = this.normalizeName(hint);
    if (normalized.length === 0) return null;
    const lowered = normalized.toLowerCase();

    const persons = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (persons.length === 0) return null;

    const exact = persons.find((p) => p.name.trim().toLowerCase() === lowered);
    if (exact) {
      await this.populateAlias(tenantId, lowered, exact.id);
      return exact.id;
    }

    const cached = await this.prisma.entityAlias
      .findUnique({
        where: { tenantId_alias: { tenantId, alias: lowered } },
        select: { personId: true },
      })
      .catch(() => null);
    if (cached?.personId) {
      const alive = await this.prisma.person
        .findFirst({
          where: { id: cached.personId, tenantId, deletedAt: null },
          select: { id: true },
        })
        .catch(() => null);
      if (alive) return alive.id;
      await this.prisma.entityAlias
        .delete({ where: { tenantId_alias: { tenantId, alias: lowered } } })
        .catch(() => undefined);
    }

    const fuzzy = persons.filter((p) => {
      const pn = p.name.trim().toLowerCase();
      return pn.includes(lowered) || lowered.includes(pn);
    });
    if (fuzzy.length === 1 && fuzzy[0]) {
      await this.populateAlias(tenantId, lowered, fuzzy[0].id);
      return fuzzy[0].id;
    }

    const embeddingCandidates = await this.resolvePersonByEmbedding(
      tenantId,
      normalized,
    );
    if (embeddingCandidates.length === 1 && embeddingCandidates[0]) {
      await this.populateAlias(tenantId, lowered, embeddingCandidates[0].id);
      return embeddingCandidates[0].id;
    }

    const nameById = new Map(persons.map((p) => [p.id, p.name]));
    const arbiterPool: Array<{ id: string; name: string }> =
      embeddingCandidates.length >= 2
        ? embeddingCandidates.map((c) => ({
            id: c.id,
            name: nameById.get(c.id) ?? '',
          }))
        : fuzzy.length >= 2
          ? fuzzy.map((p) => ({ id: p.id, name: p.name }))
          : [];
    if (arbiterPool.length >= 2 && this.llm && context) {
      const chosen = await this.arbitratePersonByLlm(
        tenantId,
        normalized,
        context,
        arbiterPool,
      );
      if (chosen) {
        await this.populateAlias(tenantId, lowered, chosen);
        return chosen;
      }
    }

    if (arbiterPool.length >= 2 || fuzzy.length > 1) {
      this.logger.debug(
        { tenantId, hint, candidates: arbiterPool.length || fuzzy.length },
        'resolvePersonByHint: неоднозначная подсказка — fail-closed (null)',
      );
    }
    return null;
  }

  /**
   * Слой источника Ф4 (R14) — нечёткий резолв имени в РАНЖИРОВАННЫХ кандидатов
   * Person с уверенностью (0..1). Каскад без точного равенства строки как
   * решающего: EntityAlias (кэш) → триграммное сходство (pg_trgm) →
   * близость Person→Entity.embedding. Кандидаты дедупятся по personId с
   * максимумом уверенности. `contextEntityIds` (например «Молочные реки») сужают
   * выбор: кандидаты, связанные с контекст-сущностью через общий источник
   * (SourceParticipant↔SourceEntity) или IdeaBlockEntity, остаются; если хотя бы
   * один такой найден — несвязанные отбрасываются (контекст сужает до одного).
   * Возвращает по убыванию уверенности. Детерминизм К1 — в ОБХОДЕ по этим id,
   * не в этом резолве.
   */
  async resolvePersonCandidates(args: {
    tenantId: string;
    hint: string;
    contextEntityIds?: string[];
  }): Promise<Array<{ personId: string; confidence: number }>> {
    const { tenantId } = args;
    const normalized = this.normalizeName(args.hint);
    if (normalized.length === 0) return [];
    const lowered = normalized.toLowerCase();

    const byPerson = new Map<string, number>();
    const bump = (personId: string, confidence: number): void => {
      const prev = byPerson.get(personId);
      if (prev === undefined || confidence > prev) {
        byPerson.set(personId, confidence);
      }
    };

    const cached = await this.prisma.entityAlias
      .findUnique({
        where: { tenantId_alias: { tenantId, alias: lowered } },
        select: { personId: true },
      })
      .catch(() => null);
    if (cached?.personId) {
      const alive = await this.prisma.person
        .findFirst({
          where: { id: cached.personId, tenantId, deletedAt: null },
          select: { id: true },
        })
        .catch(() => null);
      if (alive) bump(alive.id, 1);
    }

    for (const c of await this.resolvePersonByTrigram(tenantId, normalized)) {
      bump(c.id, c.score);
    }

    for (const c of await this.resolvePersonByEmbedding(tenantId, normalized)) {
      bump(c.id, c.score);
    }

    let candidates = [...byPerson.entries()]
      .map(([personId, confidence]) => ({ personId, confidence }))
      .sort((a, b) => b.confidence - a.confidence);

    if (
      candidates.length > 1 &&
      args.contextEntityIds &&
      args.contextEntityIds.length > 0
    ) {
      const narrowed = await this.narrowByContextEntities(
        tenantId,
        candidates.map((c) => c.personId),
        args.contextEntityIds,
      );
      if (narrowed.size > 0) {
        candidates = candidates.filter((c) => narrowed.has(c.personId));
      }
    }

    return candidates;
  }

  /**
   * Триграммное сходство имени Person (pg_trgm). Возвращает кандидатов
   * `similarity(name, hint) >= порог` (knowledge.person_resolve_trgm_threshold,
   * default 0.3), top-5 по убыванию. tenantId + deletedAt IS NULL в WHERE.
   * Параметризованный SQL; при недоступности pg_trgm — пустой массив.
   */
  private async resolvePersonByTrigram(
    tenantId: string,
    name: string,
  ): Promise<Array<{ id: string; score: number }>> {
    const threshold =
      (await this.cfg
        ?.getDynamic<number>('knowledge.person_resolve_trgm_threshold', undefined, 0.3)
        .catch(() => 0.3)) ?? 0.3;

    interface Row {
      id: string;
      score: string | number;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT id, similarity("name", $2) AS score
        FROM "persons"
        WHERE "tenantId" = $1
          AND "deletedAt" IS NULL
          AND similarity("name", $2) >= $3
        ORDER BY score DESC
        LIMIT 5
        `,
        tenantId,
        name,
        threshold,
      );
    } catch {
      return [];
    }
    const out: Array<{ id: string; score: number }> = [];
    for (const r of rows) {
      const score = typeof r.score === 'string' ? Number(r.score) : r.score;
      if (Number.isFinite(score)) out.push({ id: r.id, score });
    }
    return out;
  }

  /**
   * Контекст-сужение: возвращает подмножество personId, которые встречаются в
   * одном источнике с контекст-сущностью (через SourceParticipant↔SourceEntity
   * по общему rawEventId) ИЛИ совместно упомянуты в блоке (IdeaBlockEntity).
   * Резолвит merged-сущности в канон до сравнения. tenantId во всех WHERE.
   */
  private async narrowByContextEntities(
    tenantId: string,
    personIds: string[],
    contextEntityIds: string[],
  ): Promise<Set<string>> {
    if (personIds.length === 0 || contextEntityIds.length === 0) {
      return new Set();
    }
    const canonIds = await this.canonicalizeEntityIds(tenantId, contextEntityIds);
    if (canonIds.length === 0) return new Set();

    interface Row {
      personId: string;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT DISTINCT sp."personId" AS "personId"
        FROM "SourceParticipant" sp
        JOIN "SourceEntity" se
          ON se."rawEventId" = sp."rawEventId"
         AND se."tenantId" = sp."tenantId"
        WHERE sp."tenantId" = $1
          AND sp."personId" = ANY($2::text[])
          AND se."entityId" = ANY($3::text[])
        `,
        tenantId,
        personIds,
        canonIds,
      );
    } catch {
      return new Set();
    }
    return new Set(rows.map((r) => r.personId));
  }

  private async canonicalizeEntityIds(
    tenantId: string,
    entityIds: string[],
  ): Promise<string[]> {
    if (entityIds.length === 0) return [];
    const map = await canonicalizeEntityIds(this.prisma, tenantId, entityIds);
    return [...new Set(map.values())];
  }

  /**
   * Per-Org alias-cache: upsert EntityAlias по (tenantId, alias)→personId.
   * Best-effort — на ошибке debug-лог, не бросаем (резолв уже состоялся).
   */
  private async populateAlias(
    tenantId: string,
    alias: string,
    personId: string,
  ): Promise<void> {
    try {
      await this.prisma.entityAlias.upsert({
        where: { tenantId_alias: { tenantId, alias } },
        create: { tenantId, alias, personId },
        update: { personId },
      });
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          alias,
          err: err instanceof Error ? err.message : String(err),
        },
        'populateAlias: upsert EntityAlias не удался (best-effort)',
      );
    }
  }

  /**
   * Эмбеддинг-склейка имени: cosine между embedding'ом hint и Person→Entity.
   * Возвращает кандидатов с similarity ≥ порога (top-5). Пустой массив, если
   * нет embedding'а / pgvector недоступен / порог не достигнут.
   */
  private async resolvePersonByEmbedding(
    tenantId: string,
    name: string,
  ): Promise<Array<{ id: string; score: number }>> {
    if (!this.embeddings) return [];
    let vec: number[] | null;
    try {
      vec = await this.embeddings.embedQuery(name);
    } catch {
      return [];
    }
    if (!vec || vec.length === 0) return [];

    const threshold =
      (await this.cfg
        ?.getDynamic<number>('knowledge.entity_name_resolve_threshold', undefined, 0.9)
        .catch(() => 0.9)) ?? 0.9;

    interface Row {
      id: string;
      score: string | number;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT p.id AS id, 1 - (e.embedding <=> $1::vector(1536)) AS score
        FROM persons p
        JOIN "Entity" e ON e.id = p."entityId"
        WHERE p."tenantId" = $2
          AND p."deletedAt" IS NULL
          AND e.embedding IS NOT NULL
        ORDER BY e.embedding <=> $1::vector(1536)
        LIMIT 5
        `,
        this.toVectorLiteral(vec),
        tenantId,
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'resolvePersonByEmbedding: pgvector KNN упал — возвращаем []',
      );
      return [];
    }
    const out: Array<{ id: string; score: number }> = [];
    for (const r of rows) {
      const score = typeof r.score === 'string' ? Number(r.score) : r.score;
      if (Number.isFinite(score) && score >= threshold) {
        out.push({ id: r.id, score });
      }
    }
    return out;
  }

  async resolveEntityHintsByEmbedding(
    tenantId: string,
    question: string,
    topK: number,
    minSim: number,
  ): Promise<string[]> {
    if (!this.embeddings) return [];
    let vec: number[] | null;
    try {
      vec = await this.embeddings.embedQuery(question);
    } catch {
      return [];
    }
    if (!vec || vec.length === 0) return [];
    const limit = Math.max(1, Math.floor(topK));
    interface Row {
      canonicalName: string;
      score: string | number;
    }
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRawUnsafe<Row[]>(
        `
        SELECT "canonicalName" AS "canonicalName",
               1 - (embedding <=> $1::vector(1536)) AS score
        FROM "Entity"
        WHERE "tenantId" = $2
          AND "mergedIntoId" IS NULL
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector(1536)
        LIMIT ${limit}
        `,
        this.toVectorLiteral(vec),
        tenantId,
      );
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'resolveEntityHintsByEmbedding: pgvector KNN упал — возвращаем []',
      );
      return [];
    }
    const out: string[] = [];
    for (const r of rows) {
      const score = typeof r.score === 'string' ? Number(r.score) : r.score;
      if (Number.isFinite(score) && score >= minSim) {
        const name = r.canonicalName?.trim();
        if (name) out.push(name);
      }
    }
    return out;
  }

  /**
   * LLM-арбитр выбора одного Person из неоднозначных кандидатов (fail-closed).
   * Cache-friendly: стабильный SYSTEM, переменные данные (имя/контекст/список)
   * в конце user. На любой ошибке / неуверенности / id вне списка → null.
   */
  private async arbitratePersonByLlm(
    tenantId: string,
    name: string,
    context: string,
    candidates: Array<{ id: string; name: string }>,
  ): Promise<string | null> {
    if (!this.llm) return null;
    const allowed = new Set(candidates.map((c) => c.id));
    const list = candidates
      .map((c) => `- id=${c.id} name=${c.name}`)
      .join('\n');
    const system =
      'Ты выбираешь, какому из перечисленных людей относится упомянутое имя. ' +
      'Верни JSON {"personId": "<id>|null"}. Если непонятно — null.';
    const user = `Имя: ${name}\nКонтекст: ${context}\nКандидаты:\n${list}`;
    try {
      const res = await this.llm.call({
        taskType: 'entity-name-resolve',
        systemPrompt: system,
        userMessage: user,
        tenantId,
        responseFormat: { type: 'json_object' },
      });
      const parsed = JSON.parse(res.text) as { personId?: unknown };
      const id = parsed?.personId;
      if (typeof id === 'string' && allowed.has(id)) return id;
      return null;
    } catch (err) {
      this.logger.debug(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'arbitratePersonByLlm: LLM-арбитр упал/неуверен — fail-closed (null)',
      );
      return null;
    }
  }

  // ─────────────────────────── Фаза 0b: typed entity dedup ─────────────────

  /**
   * Дедуп типизированных сущностей группы Б (Process/Regulation/Policy/
   * Metric/Tool). Алгоритм (ТЗ 0b §8.2):
   *   1. Точное совпадение нормализованного имени в Org → returnExisting.
   *   2. Cosine sim >= 0.92 с embedding'ом существующего → returnExisting.
   *   3. Cosine sim 0.78..0.92 → LLM-arbiter (TODO, сейчас всегда createNew).
   *   4. < 0.78 → createNew.
   *
   * Возвращает `{ existingId, matchKind }`. `existingId=null` означает «надо
   * создавать новую». `matchKind='exact'|'cosine'` — что сработало.
   *
   * NB: Реальное создание делает `GraphService.upsertEntity` — этот метод
   * только подсказывает «есть ли дубль». Используется как hook'дополнение к
   * uniqueIndex'у БД (он защитит от race), но даёт более умный fuzzy-match
   * до удара в БД.
   */
  async resolveTypedEntity(args: {
    tenantId: string;
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool';
    name: string;
  }): Promise<{
    existingId: string | null;
    matchKind: 'exact' | 'cosine' | 'llm' | 'none';
  }> {
    const normalized = this.normalizeName(args.name);
    if (normalized.length === 0) {
      return { existingId: null, matchKind: 'none' };
    }
    const lowered = normalized.toLowerCase();

    // 1. Точное совпадение по name (case-insensitive).
    const exact = await this.findTypedEntityByName(
      args.tenantId,
      args.type,
      lowered,
    );
    if (exact) {
      return { existingId: exact.id, matchKind: 'exact' };
    }

    // 2. Cosine sim — TODO. У моделей группы Б в schema.prisma пока нет
    //    pgvector-колонки embedding (см. Process/Regulation/.../Tool/Metric).
    //    Альтернатива: pg_trgm для fuzzy-match по name. Если расширение не
    //    установлено — пропускаем (MVP-приёмлемо: точное совпадение покрывает
    //    основные случаи; реальный fuzzy появится через embedding'и в γ).
    try {
      const fuzzyMatch = await this.findTypedEntityByPgTrgm(
        args.tenantId,
        args.type,
        normalized,
      );
      if (fuzzyMatch) {
        return { existingId: fuzzyMatch.id, matchKind: 'cosine' };
      }
    } catch (err) {
      this.logger.debug(
        {
          type: args.type,
          err: err instanceof Error ? err.message : String(err),
        },
        'resolveTypedEntity: pg_trgm недоступен — пропускаем fuzzy-match',
      );
    }

    // 3. LLM-arbiter — TODO. На эту итерацию точного совпадения достаточно.
    return { existingId: null, matchKind: 'none' };
  }

  // ─────────────────────────── Person ↔ Entity линковка ────────────────────

  /**
   * Линковка Entity{type=person} ↔ Person (ТЗ 0b §8.3). Вызывается при
   * создании Person'а (см. POST /api/v1/persons).
   *
   * Ищет существующий Entity{type='person', tenantId, canonicalName похоже
   * на person.name}. Если найден — Person.entityId = entity.id.
   */
  async linkPersonEntity(args: {
    tenantId: string;
    personId: string;
  }): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { tenantId: true, name: true, entityId: true, deletedAt: true },
    });
    if (!person || person.deletedAt || person.tenantId !== args.tenantId) {
      return;
    }
    if (person.entityId) return; // уже слинкован

    const lowered = this.normalizeName(person.name).toLowerCase();
    if (lowered.length === 0) return;

    // Берём ВСЕ person-Entity Org и ищем по нормализованному имени (как в
    // linkEntityPerson). Прежний findFirst без фильтра по имени брал первый
    // person-Entity и при >1 сущности не находил нужный.
    //
    // Б15/Б20 [K3]: детерминированный orderBy (id ASC) + при >1 совпадении
    // по имени НЕ линкуем (тёзки → неоднозначность, как в resolveRoleByHint /
    // resolvePersonByHint). Без orderBy `findMany` отдавал произвольный порядок
    // строк, и `.find` приклеивал «первого попавшегося» тёзку.
    const entities = await this.prisma.entity.findMany({
      where: {
        tenantId: args.tenantId,
        type: 'person',
        mergedIntoId: null,
      },
      orderBy: { id: 'asc' },
      select: { id: true, canonicalName: true },
    });
    const matches = entities.filter(
      (e) => this.normalizeName(e.canonicalName).toLowerCase() === lowered,
    );
    if (matches.length === 0) {
      // Точного совпадения нет — fuzzy/cosine — TODO.
      return;
    }
    if (matches.length > 1) {
      this.logger.debug(
        { personId: args.personId, candidates: matches.length },
        'linkPersonEntity: >1 person-Entity-тёзка — пропуск (неоднозначность)',
      );
      return;
    }
    const entity = matches[0]!;

    await setPersonEntity(this.prisma, args.personId, {
      id: entity.id,
      tenantId: args.tenantId,
    });
    this.logger.debug(
      { personId: args.personId, entityId: entity.id },
      'person ↔ entity линковка установлена (Person.entityId заполнен)',
    );
  }

  /**
   * Обратный путь: при создании Entity{type=person} — ищем Person с похожим
   * именем и заполняем Person.entityId.
   *
   * Идемпотентно: если уже слинкован — no-op.
   */
  async linkEntityPerson(args: {
    tenantId: string;
    entityId: string;
  }): Promise<void> {
    const entity = await this.prisma.entity.findUnique({
      where: { id_tenantId: { id: args.entityId, tenantId: args.tenantId } },
      select: { tenantId: true, type: true, canonicalName: true },
    });
    if (
      !entity ||
      entity.type !== 'person' ||
      entity.tenantId !== args.tenantId
    ) {
      return;
    }
    const lowered = this.normalizeName(entity.canonicalName).toLowerCase();
    if (lowered.length === 0) return;

    // Ищем Person, у кого ещё нет entityId, в той же Org.
    //
    // Б15/Б20 [K3]: детерминированный orderBy (id ASC) + при >1 совпадении по
    // имени НЕ линкуем (тёзки → неоднозначная атрибуция). Прежний `.find` без
    // orderBy брал произвольного первого тёзку.
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        entityId: null,
      },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    const matches = persons.filter(
      (p) => this.normalizeName(p.name).toLowerCase() === lowered,
    );
    if (matches.length === 0) return;
    if (matches.length > 1) {
      this.logger.debug(
        { entityId: args.entityId, candidates: matches.length },
        'linkEntityPerson: >1 Person-тёзка — пропуск (неоднозначность)',
      );
      return;
    }
    const match = matches[0]!;
    await setPersonEntity(this.prisma, match.id, {
      id: args.entityId,
      tenantId: args.tenantId,
    });
    this.logger.debug(
      { personId: match.id, entityId: args.entityId },
      'entity ↔ person линковка установлена (новый Entity нашёл Person-а)',
    );
  }

  /**
   * Гарантирует наличие Entity{type=person} для данного Person и заполняет
   * Person.entityId. Идемпотентно: если entityId уже задан — просто
   * возвращает его. Ленивое создание для атрибуции авторства (role='subject').
   *
   * Возвращает Entity.id или null (Person не найден / удалён / чужая Org /
   * пустое имя).
   */
  async ensurePersonEntity(args: {
    tenantId: string;
    personId: string;
  }): Promise<string | null> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { tenantId: true, name: true, entityId: true, deletedAt: true },
    });
    if (!person || person.deletedAt || person.tenantId !== args.tenantId) {
      return null;
    }
    if (person.entityId) return person.entityId; // уже слинкован

    if (this.normalizeName(person.name).length === 0) {
      // findOrCreateEntity бросает на пустом имени — не зовём.
      return null;
    }

    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'person',
      name: person.name,
    });
    await setPersonEntity(this.prisma, args.personId, {
      id: entity.id,
      tenantId: args.tenantId,
    });
    this.logger.debug(
      { personId: args.personId, entityId: entity.id },
      'ensurePersonEntity: person-Entity создан/найден, Person.entityId заполнен',
    );
    return entity.id;
  }

  /**
   * Резолвит автора рассуждения (role='subject') в Entity.id (type=person),
   * лениво создавая person-Entity при необходимости. Источники по приоритету
   * (первый успех возвращает):
   *   0. authorPersonId — прямой Person.id (chatbox responsible / dump uploader, strong-ID).
   *   0b. authorEmail — Person по email (case-insensitive, email-источник).
   *   1. authorUserId — текстовые каналы (free_note / in_app).
   *   2. speakerParticipantId — встречи (дорожка участника).
   *   3. speakerName — fallback по имени спикера.
   * Все ветки tenant-scoped. Возвращает null, если автора определить нельзя.
   */
  async resolveSubjectEntityId(
    tenantId: string,
    input: {
      authorPersonId?: string | null;
      authorEmail?: string | null;
      speakerParticipantId?: string | null;
      speakerName?: string | null;
      authorUserId?: string | null;
    },
  ): Promise<string | null> {
    const personToEntity = async (person: {
      id: string;
      entityId: string | null;
    }): Promise<string | null> => {
      if (person.entityId) return person.entityId;
      return this.ensurePersonEntity({ tenantId, personId: person.id });
    };

    // 0. authorPersonId — прямой Person.id (chatbox responsible / dump uploader).
    if (input.authorPersonId) {
      const p = await this.prisma.person.findFirst({
        where: { id: input.authorPersonId, tenantId, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (p) return personToEntity(p);
    }

    // 0b. authorEmail — Person по email (email-источник).
    if (input.authorEmail) {
      const p = await this.prisma.person.findFirst({
        where: {
          tenantId,
          email: { equals: input.authorEmail, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true, entityId: true },
      });
      if (p) return personToEntity(p);
    }

    // 1. authorUserId — текстовые каналы.
    if (input.authorUserId) {
      const p = await this.prisma.person.findFirst({
        where: { tenantId, userId: input.authorUserId, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (p) return personToEntity(p);
    }

    // 2. speakerParticipantId — встречи.
    if (input.speakerParticipantId) {
      const part = await this.prisma.participant.findUnique({
        where: { id: input.speakerParticipantId },
        select: { personId: true, userId: true },
      });
      if (part) {
        if (part.personId) {
          const p = await this.prisma.person.findUnique({
            where: { id: part.personId },
            select: { id: true, entityId: true, deletedAt: true },
          });
          if (p && !p.deletedAt) {
            return personToEntity({ id: p.id, entityId: p.entityId });
          }
        }
        if (part.userId) {
          const p = await this.prisma.person.findFirst({
            where: { tenantId, userId: part.userId, deletedAt: null },
            select: { id: true, entityId: true },
          });
          if (p) return personToEntity(p);
        }
      }
    }

    // 3. speakerName — fallback по имени спикера.
    if (input.speakerName) {
      const pid = await this.resolvePersonByHint(tenantId, input.speakerName);
      if (pid) {
        const p = await this.prisma.person.findUnique({
          where: { id: pid },
          select: { id: true, entityId: true },
        });
        if (p) return personToEntity(p);
      }
    }

    return null;
  }

  /**
   * ТЗ-D (2026-06-05) — детерминированный резолв АВТОРА обещания в Person.id.
   * Зеркало resolveSubjectEntityId, но возвращает person.id напрямую (поле
   * IdeaBlock.commitmentAuthorPersonId ссылается на Person, не Entity).
   * Приоритет: authorPersonId → authorEmail → authorUserId →
   * speakerParticipantId → speakerName. Все ветки tenant-scoped. NULL если
   * identity не разрешилась (best-effort).
   */
  async resolveSubjectPersonId(
    tenantId: string,
    input: {
      authorPersonId?: string | null;
      authorEmail?: string | null;
      speakerParticipantId?: string | null;
      speakerName?: string | null;
      authorUserId?: string | null;
    },
  ): Promise<string | null> {
    // 0. authorPersonId — прямой Person.id (chatbox responsible / dump uploader).
    if (input.authorPersonId) {
      const p = await this.prisma.person.findFirst({
        where: { id: input.authorPersonId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (p) return p.id;
    }
    // 0b. authorEmail — Person по email (email-источник).
    if (input.authorEmail) {
      const p = await this.prisma.person.findFirst({
        where: {
          tenantId,
          email: { equals: input.authorEmail, mode: 'insensitive' },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (p) return p.id;
    }
    // 1. authorUserId — текстовые каналы.
    if (input.authorUserId) {
      const p = await this.prisma.person.findFirst({
        where: { tenantId, userId: input.authorUserId, deletedAt: null },
        select: { id: true },
      });
      if (p) return p.id;
    }
    // 2. speakerParticipantId — встречи.
    if (input.speakerParticipantId) {
      const part = await this.prisma.participant.findUnique({
        where: { id: input.speakerParticipantId },
        select: { personId: true, userId: true },
      });
      if (part) {
        if (part.personId) {
          const p = await this.prisma.person.findUnique({
            where: { id: part.personId },
            select: { id: true, deletedAt: true },
          });
          if (p && !p.deletedAt) return p.id;
        }
        if (part.userId) {
          const p = await this.prisma.person.findFirst({
            where: { tenantId, userId: part.userId, deletedAt: null },
            select: { id: true },
          });
          if (p) return p.id;
        }
      }
    }
    // 3. speakerName — fallback по имени спикера.
    if (input.speakerName) {
      const pid = await this.resolvePersonByHint(tenantId, input.speakerName);
      if (pid) return pid;
    }
    return null;
  }

  // ─────────────────────────── SBA α-3: Vendor/Event helpers ──────────────

  /**
   * Найти или создать Entity{type=vendor} + связанную Vendor-запись.
   * Приоритет дедупа:
   *   1. metadata.inn — если задан, ищем Vendor по `inn` (юр.лицо).
   *   2. canonicalName — case-insensitive по Entity (как в findOrCreateEntity).
   *
   * Возвращает { entity, vendor, created } — created=true если Vendor создан
   * в этом вызове (Entity может уже существовать).
   */
  async findOrCreateVendorEntity(args: {
    tenantId: string;
    name: string;
    inn?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; vendorId: string; created: boolean }> {
    const normalized = args.name.trim();
    if (normalized.length === 0) {
      throw new Error('EntityResolution: пустое имя vendor');
    }

    // 1. Ищем Vendor по inn (если задан) — самый строгий ключ.
    if (args.inn && args.inn.trim().length > 0) {
      const innClean = args.inn.trim();
      const byInn = await this.prisma.vendor.findFirst({
        where: { tenantId: args.tenantId, inn: innClean, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (byInn) {
        const ent = await this.prisma.entity.findUnique({
          where: { id_tenantId: { id: byInn.entityId, tenantId: args.tenantId } },
        });
        if (ent) {
          await this.prisma.entity.update({
            where: { id_tenantId: { id: ent.id, tenantId: args.tenantId } },
            data: { mentionsCount: { increment: 1 } },
          });
          return { entity: ent, vendorId: byInn.id, created: false };
        }
      }
    }

    // 2. Fallback на findOrCreateEntity по name (Entity dedup'ится по lower(name)).
    const meta: Record<string, unknown> = { ...(args.metadata ?? {}) };
    if (args.inn) meta['inn'] = args.inn;
    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'vendor',
      name: normalized,
      metadata: meta,
    });

    // Привязываем Vendor-запись 1:1 на Entity. Если она уже есть — переиспользуем.
    const existingVendor = await this.prisma.vendor.findUnique({
      where: { entityId: entity.id },
      select: { id: true },
    });
    if (existingVendor) {
      return { entity, vendorId: existingVendor.id, created: false };
    }

    const vendor = await this.prisma.vendor.create({
      data: {
        tenantId: args.tenantId,
        entityId: entity.id,
        name: normalized.slice(0, 300),
        inn: args.inn ?? null,
        // Дефолт — active. Меняется через PATCH (на α-3 read-only API,
        // PATCH появится в α-6 вместе с UI Vendor management).
        status: 'active',
      },
      select: { id: true },
    });
    return { entity, vendorId: vendor.id, created: true };
  }

  async findOrCreateCustomerEntity(args: {
    tenantId: string;
    name: string;
    inn?: string | null;
    email?: string | null;
    phone?: string | null;
    domain?: string | null;
    ogrn?: string | null;
    source?: string | null;
    externalCrmId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; customerId: string; created: boolean }> {
    const normalized = args.name.trim();
    if (normalized.length === 0) {
      throw new Error('EntityResolution: пустое имя customer');
    }

    const externalCrmId = args.externalCrmId?.trim();
    if (externalCrmId && externalCrmId.length > 0) {
      const byCrm = await this.prisma.customer.findFirst({
        where: {
          tenantId: args.tenantId,
          externalCrmId,
          deletedAt: null,
        },
        select: { id: true, entityId: true },
      });
      if (byCrm) {
        const ent = await this.prisma.entity.findUnique({
          where: { id_tenantId: { id: byCrm.entityId, tenantId: args.tenantId } },
        });
        if (ent) {
          const updated = await this.prisma.entity.update({
            where: { id_tenantId: { id: ent.id, tenantId: args.tenantId } },
            data: { mentionsCount: { increment: 1 } },
          });
          return { entity: updated, customerId: byCrm.id, created: false };
        }
      }
    }

    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'customer',
      name: normalized,
      inn: args.inn,
      ogrn: args.ogrn,
      email: args.email,
      phone: args.phone,
      domain: args.domain,
      metadata: args.metadata,
    });

    const existingCustomer = await this.prisma.customer.findUnique({
      where: { entityId: entity.id },
      select: { id: true },
    });
    if (existingCustomer) {
      return { entity, customerId: existingCustomer.id, created: false };
    }

    const customer = await this.prisma.customer.create({
      data: {
        tenantId: args.tenantId,
        entityId: entity.id,
        name: normalized.slice(0, 300),
        inn: args.inn ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        source: args.source ?? null,
        externalCrmId: args.externalCrmId ?? null,
        status: 'active',
      },
      select: { id: true },
    });
    return { entity, customerId: customer.id, created: true };
  }

  /**
   * Найти или создать Entity{type=event} + связанный Event-запись.
   * Дедуп по `(tenantId, title, startAt within ±1 день)` — события с тем же
   * заголовком в течение одного дня считаются одним событием.
   */
  async findOrCreateEventEntity(args: {
    tenantId: string;
    title: string;
    startAt: Date;
    kind?:
      | 'meeting'
      | 'incident'
      | 'release'
      | 'transition'
      | 'milestone'
      | 'other';
    relatedMeetingId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; eventId: string; created: boolean }> {
    const normalizedTitle = args.title.trim();
    if (normalizedTitle.length === 0) {
      throw new Error('EntityResolution: пустой title event');
    }

    // Окно ±1 день.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const from = new Date(args.startAt.getTime() - DAY_MS);
    const to = new Date(args.startAt.getTime() + DAY_MS);

    const existing = await this.prisma.event.findFirst({
      where: {
        tenantId: args.tenantId,
        title: normalizedTitle.slice(0, 300),
        startAt: { gte: from, lte: to },
        deletedAt: null,
      },
      select: { id: true, entityId: true },
    });
    if (existing) {
      const ent = await this.prisma.entity.findUnique({
        where: { id_tenantId: { id: existing.entityId, tenantId: args.tenantId } },
      });
      if (ent) {
        await this.prisma.entity.update({
          where: { id_tenantId: { id: ent.id, tenantId: args.tenantId } },
          data: { mentionsCount: { increment: 1 } },
        });
        return { entity: ent, eventId: existing.id, created: false };
      }
    }

    // Создаём новый Entity + Event.
    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'event',
      name: normalizedTitle,
      metadata: args.metadata,
    });

    const created = await this.prisma.event.create({
      data: {
        tenantId: args.tenantId,
        entityId: entity.id,
        kind: args.kind ?? 'other',
        title: normalizedTitle.slice(0, 300),
        startAt: args.startAt,
        relatedMeetingId: args.relatedMeetingId ?? null,
      },
      select: { id: true },
    });
    return { entity, eventId: created.id, created: true };
  }

  // ─────────────────────────── private helpers ─────────────────────────────

  /**
   * Точный поиск типизированной сущности по нормализованному name.
   * Использует prisma делегаты соответствующего типа.
   */
  private async findTypedEntityByName(
    tenantId: string,
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
    loweredName: string,
  ): Promise<{ id: string } | null> {
    // У всех типов group-Б есть @@unique([tenantId, name]) — но мы делаем
    // case-insensitive поиск через findMany + filter (без citext-колонки в
    // schema.prisma это самый дешёвый путь).
    switch (type) {
      case 'process': {
        const rows = await this.prisma.process.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'regulation': {
        const rows = await this.prisma.regulation.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'policy': {
        const rows = await this.prisma.policy.findMany({
          where: { tenantId, deletedAt: null },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'metric': {
        const rows = await this.prisma.metric.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'tool': {
        const rows = await this.prisma.tool.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      default:
        return null;
    }
  }

  /**
   * Fuzzy-поиск через pg_trgm `similarity()`. Если pg_trgm не установлен —
   * упадёт; catch на уровне caller'а сделает graceful fallback.
   *
   * Порог: 0.78 (по ТЗ §8.2 для cosine — повторно используем как порог
   * trigram-сходства; на практике 0.78 trigram достаточно «строгий»).
   */
  private async findTypedEntityByPgTrgm(
    tenantId: string,
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
    name: string,
  ): Promise<{ id: string } | null> {
    const table = this.tableForType(type);
    const softDeleteClause =
      type === 'process' || type === 'regulation' || type === 'policy'
        ? 'AND "deletedAt" IS NULL'
        : '';
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; sim: number }>
    >(
      `SELECT id, similarity(name, $1) AS sim
       FROM ${table}
       WHERE "tenantId" = $2
         ${softDeleteClause}
         AND similarity(name, $1) >= 0.78
       ORDER BY sim DESC
       LIMIT 1`,
      name,
      tenantId,
    );
    if (rows && rows[0]) {
      return { id: rows[0].id };
    }
    return null;
  }

  private tableForType(
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
  ): string {
    switch (type) {
      case 'process':
        return '"processes"';
      case 'regulation':
        return '"regulations"';
      case 'policy':
        return '"policies"';
      case 'metric':
        return '"metrics"';
      case 'tool':
        return '"tools"';
    }
  }

  /**
   * Нормализация имени: trim + collapse whitespace + удаление кавычек.
   * Лемматизация (`morpher` / stemmer) — TODO в γ.
   */
  private normalizeName(input: string): string {
    return normalizeEntityName(input);
  }

  /**
   * Мерджит metadata: существующие ключи остаются как есть, новые ключи
   * из `incoming` добавляются. Если оба null — возвращает undefined,
   * чтобы caller не трогал поле.
   */
  private mergeMetadata(
    existing: Prisma.JsonValue | null,
    incoming: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!incoming || Object.keys(incoming).length === 0) return undefined;
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    let changed = false;
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in merged)) {
        merged[k] = v;
        changed = true;
      }
    }
    return changed ? (merged as Prisma.InputJsonValue) : undefined;
  }

  /**
   * Postgres pgvector литерал: `[0.1,0.2,...]`.
   */
  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }
}
