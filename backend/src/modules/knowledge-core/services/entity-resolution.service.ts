import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type Entity, type EntityType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import {
  ENTITY_CREATED,
  ENTITY_UPDATED,
  type EntitySyncEventName,
} from '../../tables/events/entity-sync.events';

import { KnowledgeEmbeddingService } from './embedding.service';

@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
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
    @Optional()
    @Inject(EventEmitter2)
    private readonly events?: EventEmitter2,
  ) {}

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

  async findOrCreateEntity(args: {
    tenantId: string;
    type: EntityType;
    name: string;
    metadata?: Record<string, unknown>;
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

    const strong = this.normalizeStrongIds(args);
    const strongHit = await this.resolveByStrongIds({
      tenantId: args.tenantId,
      type: args.type,
      ...strong,
    });
    if (strongHit) {
      const merged = this.mergeMetadata(strongHit.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id: strongHit.id },
        data: {
          mentionsCount: { increment: 1 },
          ...(strong.inn && !strongHit.inn ? { inn: strong.inn } : {}),
          ...(strong.ogrn && !strongHit.ogrn ? { ogrn: strong.ogrn } : {}),
          ...(strong.email && !strongHit.email ? { email: strong.email } : {}),
          ...(strong.phone && !strongHit.phone ? { phone: strong.phone } : {}),
          ...(strong.domain && !strongHit.domain ? { domain: strong.domain } : {}),
          ...(merged !== undefined ? { metadata: merged } : {}),
        },
      });
      const cacheKey = this.buildCacheKey(args.tenantId, args.type, lowered);
      await this.writeCache(cacheKey, updated.id);
      this.metrics?.incKcEntityResolvePath({ path: 'strong_id' });
      observeLatency();
      this.emitEntityEvent(ENTITY_UPDATED, updated);
      return { entity: updated, created: false };
    }

    const cacheKey = this.buildCacheKey(args.tenantId, args.type, lowered);
    const cachedId = await this.readCache(cacheKey);
    if (cachedId) {
      const cached = await this.prisma.entity.findUnique({
        where: { id: cachedId },
      });
      if (cached && cached.mergedIntoId === null) {
        const merged = this.mergeMetadata(cached.metadata, args.metadata);
        const updated = await this.prisma.entity.update({
          where: { id: cached.id },
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
      await this.deleteCache(cacheKey);
    }

    const exact = await this.findExactByLowerName(args.tenantId, args.type, lowered);
    if (exact) {
      const found = await this.prisma.entity.findUnique({
        where: { id: exact.id },
      });
      if (found) {
        const merged = this.mergeMetadata(found.metadata, args.metadata);
        const updated = await this.prisma.entity.update({
          where: { id: found.id },
          data: {
            mentionsCount: { increment: 1 },
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

    const knnHit = await this.knnResolve({
      tenantId: args.tenantId,
      type: args.type,
      name: normalized,
    });
    if (knnHit) {
      const merged = this.mergeMetadata(knnHit.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id: knnHit.id },
        data: {
          mentionsCount: { increment: 1 },
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
    if (this.coreQueue) {
      await this.coreQueue.enqueueEntityResolver(created.id).catch((err) => {
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
    const dist = typeof best.distance === 'string' ? Number(best.distance) : best.distance;
    if (!Number.isFinite(dist)) return null;
    const similarity = 1 - dist;
    if (similarity < threshold) return null;
    const entity = await this.prisma.entity.findUnique({
      where: { id: best.id },
    });
    return entity;
  }

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
    domainRaw = domainRaw.split('/')[0] ?? '';
    const domain = domainRaw.includes('.') && domainRaw.length >= 3 ? domainRaw : null;

    return { inn, ogrn, email, phone, domain };
  }

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
      return this.prisma.entity.findUnique({ where: { id: hit.id } });
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
    if (args.phone) {
      const e = await lookupField('phone', args.phone);
      if (e) return e;
    }
    return null;
  }

  private buildCacheKey(tenantId: string, type: EntityType, loweredName: string): string {
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
    } catch {}
  }

  private async deleteCache(key: string): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.client.del(key);
    } catch {}
  }

  async resolveRoleByHint(tenantId: string, hint: string): Promise<string | null> {
    const normalized = this.normalizeName(hint);
    if (normalized.length === 0) return null;

    const roles = await this.prisma.role.findMany({
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
    if (fuzzy.length === 1 && fuzzy[0]) {
      return fuzzy[0].id;
    }
    if (fuzzy.length > 1) {
      this.logger.debug(
        { tenantId, hint, candidates: fuzzy.length },
        'resolveRoleByHint: неоднозначная подсказка — пропуск',
      );
    }
    return null;
  }

  async resolvePersonByHint(tenantId: string, hint: string): Promise<string | null> {
    const normalized = this.normalizeName(hint);
    if (normalized.length === 0) return null;

    const persons = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (persons.length === 0) return null;

    const lowered = normalized.toLowerCase();
    const exact = persons.find((p) => p.name.trim().toLowerCase() === lowered);
    if (exact) return exact.id;

    const fuzzy = persons.filter((p) => {
      const pn = p.name.trim().toLowerCase();
      return pn.includes(lowered) || lowered.includes(pn);
    });
    if (fuzzy.length === 1 && fuzzy[0]) {
      return fuzzy[0].id;
    }
    if (fuzzy.length > 1) {
      this.logger.debug(
        { tenantId, hint, candidates: fuzzy.length },
        'resolvePersonByHint: неоднозначная подсказка — пропуск',
      );
    }
    return null;
  }

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

    const exact = await this.findTypedEntityByName(args.tenantId, args.type, lowered);
    if (exact) {
      return { existingId: exact.id, matchKind: 'exact' };
    }

    try {
      const fuzzyMatch = await this.findTypedEntityByPgTrgm(args.tenantId, args.type, normalized);
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

    return { existingId: null, matchKind: 'none' };
  }

  async linkPersonEntity(args: { tenantId: string; personId: string }): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { tenantId: true, name: true, entityId: true, deletedAt: true },
    });
    if (!person || person.deletedAt || person.tenantId !== args.tenantId) {
      return;
    }
    if (person.entityId) return;

    const lowered = this.normalizeName(person.name).toLowerCase();
    if (lowered.length === 0) return;

    const entities = await this.prisma.entity.findMany({
      where: {
        tenantId: args.tenantId,
        type: 'person',
        mergedIntoId: null,
      },
      select: { id: true, canonicalName: true },
    });
    const entity = entities.find(
      (e) => this.normalizeName(e.canonicalName).toLowerCase() === lowered,
    );
    if (!entity) {
      return;
    }

    await this.prisma.person.update({
      where: { id: args.personId },
      data: { entityId: entity.id },
    });
    this.logger.debug(
      { personId: args.personId, entityId: entity.id },
      'person ↔ entity линковка установлена (Person.entityId заполнен)',
    );
  }

  async linkEntityPerson(args: { tenantId: string; entityId: string }): Promise<void> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: args.entityId },
      select: { tenantId: true, type: true, canonicalName: true },
    });
    if (!entity || entity.type !== 'person' || entity.tenantId !== args.tenantId) {
      return;
    }
    const lowered = this.normalizeName(entity.canonicalName).toLowerCase();
    if (lowered.length === 0) return;

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        entityId: null,
      },
      select: { id: true, name: true },
    });
    const match = persons.find((p) => this.normalizeName(p.name).toLowerCase() === lowered);
    if (!match) return;
    await this.prisma.person.update({
      where: { id: match.id },
      data: { entityId: args.entityId },
    });
    this.logger.debug(
      { personId: match.id, entityId: args.entityId },
      'entity ↔ person линковка установлена (новый Entity нашёл Person-а)',
    );
  }

  async ensurePersonEntity(args: { tenantId: string; personId: string }): Promise<string | null> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { tenantId: true, name: true, entityId: true, deletedAt: true },
    });
    if (!person || person.deletedAt || person.tenantId !== args.tenantId) {
      return null;
    }
    if (person.entityId) return person.entityId;

    if (this.normalizeName(person.name).length === 0) {
      return null;
    }

    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'person',
      name: person.name,
    });
    await this.prisma.person.update({
      where: { id: args.personId },
      data: { entityId: entity.id },
    });
    this.logger.debug(
      { personId: args.personId, entityId: entity.id },
      'ensurePersonEntity: person-Entity создан/найден, Person.entityId заполнен',
    );
    return entity.id;
  }

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

    if (input.authorPersonId) {
      const p = await this.prisma.person.findFirst({
        where: { id: input.authorPersonId, tenantId, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (p) return personToEntity(p);
    }

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

    if (input.authorUserId) {
      const p = await this.prisma.person.findFirst({
        where: { tenantId, userId: input.authorUserId, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (p) return personToEntity(p);
    }

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
    if (input.authorPersonId) {
      const p = await this.prisma.person.findFirst({
        where: { id: input.authorPersonId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (p) return p.id;
    }
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
    if (input.authorUserId) {
      const p = await this.prisma.person.findFirst({
        where: { tenantId, userId: input.authorUserId, deletedAt: null },
        select: { id: true },
      });
      if (p) return p.id;
    }
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
    if (input.speakerName) {
      const pid = await this.resolvePersonByHint(tenantId, input.speakerName);
      if (pid) return pid;
    }
    return null;
  }

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

    if (args.inn && args.inn.trim().length > 0) {
      const innClean = args.inn.trim();
      const byInn = await this.prisma.vendor.findFirst({
        where: { tenantId: args.tenantId, inn: innClean, deletedAt: null },
        select: { id: true, entityId: true },
      });
      if (byInn) {
        const ent = await this.prisma.entity.findUnique({
          where: { id: byInn.entityId },
        });
        if (ent) {
          await this.prisma.entity.update({
            where: { id: ent.id },
            data: { mentionsCount: { increment: 1 } },
          });
          return { entity: ent, vendorId: byInn.id, created: false };
        }
      }
    }

    const meta: Record<string, unknown> = { ...(args.metadata ?? {}) };
    if (args.inn) meta['inn'] = args.inn;
    const { entity } = await this.findOrCreateEntity({
      tenantId: args.tenantId,
      type: 'vendor',
      name: normalized,
      metadata: meta,
    });

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
        status: 'active',
      },
      select: { id: true },
    });
    return { entity, vendorId: vendor.id, created: true };
  }

  async findOrCreateEventEntity(args: {
    tenantId: string;
    title: string;
    startAt: Date;
    kind?: 'meeting' | 'incident' | 'release' | 'transition' | 'milestone' | 'other';
    relatedMeetingId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; eventId: string; created: boolean }> {
    const normalizedTitle = args.title.trim();
    if (normalizedTitle.length === 0) {
      throw new Error('EntityResolution: пустой title event');
    }

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
        where: { id: existing.entityId },
      });
      if (ent) {
        await this.prisma.entity.update({
          where: { id: ent.id },
          data: { mentionsCount: { increment: 1 } },
        });
        return { entity: ent, eventId: existing.id, created: false };
      }
    }

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

  private async findTypedEntityByName(
    tenantId: string,
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
    loweredName: string,
  ): Promise<{ id: string } | null> {
    switch (type) {
      case 'process': {
        const rows = await this.prisma.process.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName) ?? null;
      }
      case 'regulation': {
        const rows = await this.prisma.regulation.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName) ?? null;
      }
      case 'policy': {
        const rows = await this.prisma.policy.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName) ?? null;
      }
      case 'metric': {
        const rows = await this.prisma.metric.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName) ?? null;
      }
      case 'tool': {
        const rows = await this.prisma.tool.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName) ?? null;
      }
      default:
        return null;
    }
  }

  private async findTypedEntityByPgTrgm(
    tenantId: string,
    type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool',
    name: string,
  ): Promise<{ id: string } | null> {
    const table = this.tableForType(type);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; sim: number }>>(
      `SELECT id, similarity(name, $1) AS sim
       FROM ${table}
       WHERE "tenantId" = $2
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

  private tableForType(type: 'process' | 'regulation' | 'policy' | 'metric' | 'tool'): string {
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

  private normalizeName(input: string): string {
    if (!input) return '';
    return input
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/["'«»“”„‟]/g, '');
  }

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

  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }
}
