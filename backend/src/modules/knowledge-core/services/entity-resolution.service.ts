import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Entity, type EntityType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

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
  ) {}

  async findOrCreateEntity(args: {
    tenantId: string;
    type: EntityType;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; created: boolean }> {
    const normalized = args.name.trim();
    if (normalized.length === 0) {
      throw new Error('EntityResolution: пустое имя сущности');
    }
    const lowered = normalized.toLowerCase();

    // findFirst по (tenantId, type) + ручная фильтрация по lower(canonicalName).
    // На больших тенантах это упрётся — Шаг 4 заменит на ts_vector + KNN.
    const candidates = await this.prisma.entity.findMany({
      where: { tenantId: args.tenantId, type: args.type, mergedIntoId: null },
      select: { id: true, canonicalName: true, metadata: true, mentionsCount: true },
    });
    const found = candidates.find(
      (c) => c.canonicalName.trim().toLowerCase() === lowered,
    );
    if (found) {
      const mergedMeta = this.mergeMetadata(found.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id: found.id },
        data: {
          mentionsCount: { increment: 1 },
          ...(mergedMeta !== undefined ? { metadata: mergedMeta } : {}),
        },
      });
      // Если это Person-Entity — попробуем найти/слинковать с Person.
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
      return { entity: updated, created: false };
    }

    // Создаём новую entity. Embedding кладётся вторым шагом — через executeRaw.
    const created = await this.prisma.entity.create({
      data: {
        tenantId: args.tenantId,
        type: args.type,
        canonicalName: normalized,
        mentionsCount: 1,
        metadata: (args.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
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
    return { entity: created, created: true };
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

    // Fuzzy: ищем те, чьё имя содержит подстроку нашей подсказки или наоборот.
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

  /**
   * Резолвит подсказку имени персоны (`decidedByPersonHint` из extraction'а)
   * в реальный Person.id. Алгоритм аналогичен resolveRoleByHint.
   */
  async resolvePersonByHint(
    tenantId: string,
    hint: string,
  ): Promise<string | null> {
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

    const entity = await this.prisma.entity.findFirst({
      where: {
        tenantId: args.tenantId,
        type: 'person',
        mergedIntoId: null,
      },
      select: { id: true, canonicalName: true },
    });
    if (!entity) return;

    if (entity.canonicalName.trim().toLowerCase() !== lowered) {
      // Точного совпадения нет — fuzzy/cosine — TODO.
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
      where: { id: args.entityId },
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
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        entityId: null,
      },
      select: { id: true, name: true },
    });
    const match = persons.find(
      (p) => this.normalizeName(p.name).toLowerCase() === lowered,
    );
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
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'regulation': {
        const rows = await this.prisma.regulation.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        });
        return rows.find((r) => r.name.trim().toLowerCase() === loweredName)
          ?? null;
      }
      case 'policy': {
        const rows = await this.prisma.policy.findMany({
          where: { tenantId },
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
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; sim: number }>
    >(
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
    if (!input) return '';
    return input
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/["'«»“”„‟]/g, '');
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
