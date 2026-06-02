import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Entity, TablePropType } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { buildTableArchitectPassPrompt } from '../../ai/services/prompts/table-architect-pass.prompt';
import { buildTableEntityCheckPrompt } from '../../ai/services/prompts/table-entity-check.prompt';
import { buildTableInferSchemaPrompt } from '../../ai/services/prompts/table-infer-schema.prompt';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { SYSTEM_TABLES_CATALOG } from '../templates/system-tables.catalog';

import { parseEntitySync, resolveEntityTypes } from './entity-sync.util';

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 1) — TableAgentService.
 *
 * Text-to-Schema: по NL-описанию пользователя генерирует схему Smart-таблицы
 * в 3 LLM-pass'а:
 *   1. DRAFT     (`table-infer-schema`)   — NL -> черновик схемы.
 *   2. ARCHITECT (`table-architect-pass`) — дедуп колонок, оптимальные типы, 1 isPrimary.
 *   3. ENTITY    (`table-entity-check`)    — сверка entitySync.type с доступными.
 *
 * После 3 pass'ов сервис ЖЁСТКО валидирует инварианты (≥1 property, ровно одна
 * isPrimary, валидные TablePropType, непустые имена, entitySync ∈ available).
 * Это страховка от галлюцинаций LLM: финальная схема всегда консистентна.
 *
 * Cache-friendly: prompt-builder'ы держат стабильный SYSTEM, переменные данные
 * (запрос/черновик) — в USER.
 */

export type AvailableSyncType = 'org' | 'person' | 'meeting' | 'document';

export interface InferredTableSchema {
  name: string;
  description: string | null;
  icon: string | null;
  entitySync: { type: AvailableSyncType } | null;
  properties: Array<{
    name: string;
    type: TablePropType;
    isPrimary: boolean;
    config?: Record<string, unknown>;
  }>;
}

/** Допустимые значения `TablePropType`, которые может задавать LLM (без auto-типов). */
const ALLOWED_PROP_TYPES: ReadonlySet<TablePropType> = new Set<TablePropType>([
  'text',
  'longtext',
  'number',
  'currency',
  'percent',
  'date',
  'status',
  'selectSingle',
  'selectMulti',
  'checkbox',
  'person',
  'url',
  'email',
  'phone',
  'file',
  'formula',
  'relation',
  'rollup',
]);

const ALL_SYNC_TYPES: readonly AvailableSyncType[] = [
  'org',
  'person',
  'meeting',
  'document',
];

// Zod-схема для парсинга «сырого» JSON от LLM. Намеренно мягкая: type — любая
// строка (жёсткую фильтрацию по ALLOWED_PROP_TYPES делаем в коде, чтобы
// невалидный тип не ронял весь парс, а отбрасывался/заменялся).
const RawLlmSchemaZod = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  entitySync: z
    .object({ type: z.string() })
    .nullable()
    .optional(),
  properties: z
    .array(
      z.object({
        name: z.string().optional(),
        type: z.string().optional(),
        isPrimary: z.boolean().optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .optional(),
});
type RawLlmSchema = z.infer<typeof RawLlmSchemaZod>;

@Injectable()
export class TableAgentService {
  private readonly logger = new Logger(TableAgentService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    // Document-to-Table (Фаза 4) — cosine-dedup схем + порог из admin-setting.
    // @Optional: существующие unit-тесты TableAgentService конструируют сервис
    // двумя аргументами (llm, prisma); без embeddings/cfg dedup просто вернёт [].
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * Главный метод Text-to-Schema. Возвращает консистентную `InferredTableSchema`.
   *
   * @throws BadRequestException code `table_schema_generation_failed` если LLM
   *   вернул невалидный JSON на pass 1 (DRAFT).
   */
  async inferSchemaFromText(args: {
    tenantId: string;
    userPrompt: string;
  }): Promise<InferredTableSchema> {
    const result = await this.runThreePassPipeline({
      tenantId: args.tenantId,
      userPrompt: args.userPrompt,
    });
    this.logger.log(
      {
        tenantId: args.tenantId,
        source: 'text',
        passes: 3,
        columns: result.properties.length,
        entitySync: result.entitySync?.type ?? null,
      },
      'table-agent: схема сгенерирована',
    );
    return result;
  }

  /**
   * Document-to-Table (Фаза 4) — инференс схемы по плоской таблице из файла
   * (Excel/CSV). Переиспользует тот же 3-pass pipeline, что и Text-to-Schema,
   * собирая из заголовков+примеров строк синтетический NL-запрос.
   *
   * КРИТИЧНО — маппинг столбец↔property: после 3 pass'ов гарантируем строгое
   * соответствие «столбец файла j ↔ property j» по ПОРЯДКУ. LLM может
   * объединить/разбить/переименовать колонки — поэтому если число properties ≠
   * числу headers, выравниваем по входным заголовкам:
   *   - лишние properties отбрасываем (берём первые `headers.length`);
   *   - недостающие дополняем `text`-колонкой с именем исходного заголовка.
   * Так строки переносятся 1:1 по индексу без потери данных.
   *
   * @throws BadRequestException code `table_schema_generation_failed` если LLM
   *   вернул невалидный JSON на pass 1 (DRAFT).
   */
  async inferSchemaFromTabular(args: {
    tenantId: string;
    headers: string[];
    sampleRows: string[][];
  }): Promise<InferredTableSchema> {
    const userPrompt = this.buildTabularPrompt(args.headers, args.sampleRows);
    const schema = await this.runThreePassPipeline({
      tenantId: args.tenantId,
      userPrompt,
    });

    // Жёсткое выравнивание property↔header по порядку (см. JSDoc).
    const aligned = this.alignToHeaders(schema, args.headers);

    this.logger.log(
      {
        tenantId: args.tenantId,
        source: 'tabular',
        passes: 3,
        headers: args.headers.length,
        columns: aligned.properties.length,
        entitySync: aligned.entitySync?.type ?? null,
      },
      'table-agent: схема сгенерирована из файла',
    );
    return aligned;
  }

  // ─────────────────────── 3-pass pipeline (shared) ─────────────────────────

  /**
   * Общий 3-pass конвейер (DRAFT → ARCHITECT → ENTITY-CHECK → normalize).
   * Используется и Text-to-Schema, и Document-to-Table — разница только в том,
   * какой `userPrompt` ушёл в pass 1.
   */
  private async runThreePassPipeline(args: {
    tenantId: string;
    userPrompt: string;
  }): Promise<InferredTableSchema> {
    const availableSyncTypes = await this.getAvailableSyncTypes(args.tenantId);

    // ── pass 1: DRAFT ──────────────────────────────────────────────────────
    const draftPrompt = buildTableInferSchemaPrompt({
      userPrompt: args.userPrompt,
      availableSyncTypes,
      systemTableExamples: SYSTEM_TABLES_CATALOG.map((t) => ({
        systemKey: t.systemKey,
        name: t.name,
        icon: t.icon,
      })),
    });
    const draftRaw = await this.callJson({
      taskType: 'table-infer-schema',
      tenantId: args.tenantId,
      system: draftPrompt.system,
      user: draftPrompt.user,
    });
    if (!draftRaw) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'table_schema_generation_failed',
          message:
            'Не удалось сгенерировать схему таблицы по описанию. Попробуйте переформулировать запрос.',
        },
      });
    }

    // ── pass 2: ARCHITECT ────────────────────────────────────────────────
    let architectRaw: RawLlmSchema = draftRaw;
    const architectPrompt = buildTableArchitectPassPrompt({ draftSchema: draftRaw });
    const architectParsed = await this.callJson({
      taskType: 'table-architect-pass',
      tenantId: args.tenantId,
      system: architectPrompt.system,
      user: architectPrompt.user,
    });
    if (architectParsed) {
      architectRaw = architectParsed;
    } else {
      this.logger.warn(
        { tenantId: args.tenantId },
        'table-agent: ARCHITECT pass вернул невалидный JSON, используем DRAFT',
      );
    }

    // ── pass 3: ENTITY-CHECK ─────────────────────────────────────────────
    let entityRaw: RawLlmSchema = architectRaw;
    const entityPrompt = buildTableEntityCheckPrompt({
      schema: architectRaw,
      availableSyncTypes,
    });
    const entityParsed = await this.callJson({
      taskType: 'table-entity-check',
      tenantId: args.tenantId,
      system: entityPrompt.system,
      user: entityPrompt.user,
    });
    if (entityParsed) {
      entityRaw = entityParsed;
    } else {
      this.logger.warn(
        { tenantId: args.tenantId },
        'table-agent: ENTITY-CHECK pass вернул невалидный JSON, используем ARCHITECT',
      );
    }

    // ── финальная нормализация + инварианты ──────────────────────────────
    return this.normalize(entityRaw, availableSyncTypes);
  }

  /**
   * Строит cache-friendly NL-запрос из заголовков + первых ~20 строк файла.
   * Переменные данные — в конце; SYSTEM остаётся стабильным (см. prompt-builder).
   */
  private buildTabularPrompt(headers: string[], sampleRows: string[][]): string {
    const SAMPLE_LIMIT = 20;
    const sample = sampleRows.slice(0, SAMPLE_LIMIT);
    const colLines = headers.map((h, j) => {
      const examples = sample
        .map((r) => (r[j] ?? '').trim())
        .filter((v) => v.length > 0)
        .slice(0, 5);
      const ex = examples.length > 0 ? ` — примеры: ${examples.join('; ')}` : '';
      return `${j + 1}. ${h}${ex}`;
    });
    return [
      'Пользователь загрузил таблицу из файла. Ниже — её столбцы по порядку с примерами значений. Создай схему Smart-таблицы по этим данным.',
      '',
      'Столбцы файла (в исходном порядке):',
      ...colLines,
      '',
      'Требования:',
      '- Верни РОВНО одну колонку на каждый входной столбец, СОХРАНЯЯ их порядок.',
      '- Тип каждой колонки выведи из примеров значений (даты → date, суммы → currency, числа → number, e-mail → email, телефон → phone, и т.п.).',
      '- Ровно одна колонка должна быть isPrimary (обычно первая именующая).',
      '- Названия колонок бери из заголовков файла (можно слегка причесать), на русском.',
    ].join('\n');
  }

  /**
   * Выравнивает сгенерированную схему под входные заголовки строго по порядку:
   * берём `headers.length` колонок, лишние LLM-колонки отбрасываем, недостающие
   * дополняем `text`-колонками с именем исходного заголовка. Это гарантирует, что
   * значение `rows[i][j]` ляжет в property с индексом `j`.
   */
  private alignToHeaders(
    schema: InferredTableSchema,
    headers: string[],
  ): InferredTableSchema {
    if (headers.length === 0) return schema;
    const props: InferredTableSchema['properties'] = [];
    for (let j = 0; j < headers.length; j++) {
      const fromLlm = schema.properties[j];
      if (fromLlm) {
        // Имя колонки фиксируем по заголовку файла (надёжный якорь для UI),
        // тип/config берём от LLM.
        props.push({
          name: headers[j]?.trim() || fromLlm.name,
          type: fromLlm.type,
          isPrimary: false,
          ...(fromLlm.config ? { config: fromLlm.config } : {}),
        });
      } else {
        props.push({
          name: headers[j]?.trim() || `Столбец ${j + 1}`,
          type: 'text',
          isPrimary: false,
        });
      }
    }
    // Ровно одна isPrimary: сохраняем выбор LLM, если он попал в диапазон,
    // иначе — первая колонка.
    const llmPrimaryIdx = schema.properties.findIndex((p) => p.isPrimary);
    const primaryIdx =
      llmPrimaryIdx >= 0 && llmPrimaryIdx < props.length ? llmPrimaryIdx : 0;
    props.forEach((p, i) => {
      p.isPrimary = i === primaryIdx;
    });

    return {
      name: schema.name,
      description: schema.description,
      icon: schema.icon,
      entitySync: schema.entitySync,
      properties: props,
    };
  }

  /**
   * Доступные entitySync-типы тенанта. Фаза 1 — возвращаем все 4.
   * TODO Фаза 2: учитывать фактические EntityType, заведённые в тенанте
   * (фильтровать список по реальным сущностям графа знаний).
   */
  async getAvailableSyncTypes(_tenantId: string): Promise<AvailableSyncType[]> {
    return [...ALL_SYNC_TYPES];
  }

  // ─────────────────── Document-to-Table (Фаза 4) — dedup ───────────────────

  /**
   * Cosine-dedup: ищет существующие НЕ-архивные таблицы тенанта, чья схема
   * семантически близка к предложенной. Возвращает топ-3 кандидата на «слияние»
   * с cosine ≥ порог (`table.import.dedup_threshold`, default 0.85),
   * отсортированных по убыванию схожести.
   *
   * schemaText = `name + ' ' + properties.map(p => p.name).join(', ')`. Эмбеддим
   * предложенную схему и каждую существующую, считаем cosine в JS. Если
   * embeddings недоступны (вернулся null или провайдеры упали) — возвращаем []
   * (не падаем: пользователь просто не увидит предложения слияния).
   */
  async findSimilarTables(args: {
    tenantId: string;
    schema: InferredTableSchema;
  }): Promise<Array<{ tableId: string; name: string; cosine: number }>> {
    if (!this.embeddings) return [];

    const proposedText = this.schemaToText(args.schema.name, args.schema.properties);

    const tables = await this.prisma.table.findMany({
      where: { tenantId: args.tenantId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        name: true,
        properties: { select: { name: true } },
      },
    });
    if (tables.length === 0) return [];

    // Один batch-вызов эмбеддингов на весь набор: [proposed, ...existing].
    // Сопоставляем вектора по индексу. При сбое провайдеров → [] (graceful).
    const tableTexts = tables.map((t) =>
      this.schemaToText(
        t.name,
        t.properties.map((p) => ({ name: p.name })),
      ),
    );
    let vectors: Array<number[] | undefined>;
    try {
      vectors = await this.embeddings.embed([proposedText, ...tableTexts]);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'table-agent: embedding для dedup недоступен — пропускаем',
      );
      return [];
    }
    const proposedVec = vectors[0];
    if (!proposedVec) return [];

    const threshold = await this.getDedupThreshold();
    const out: Array<{ tableId: string; name: string; cosine: number }> = [];
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i];
      const vec = vectors[i + 1]; // +1 — нулевой вектор у proposed
      if (!t || !vec) continue;
      const cosine = this.cosine(proposedVec, vec);
      if (cosine >= threshold) {
        out.push({ tableId: t.id, name: t.name, cosine });
      }
    }
    out.sort((a, b) => b.cosine - a.cosine);
    return out.slice(0, 3);
  }

  // ──────────────── Document-to-Table (Фаза 4) — entity-linking ─────────────

  /**
   * Привязывает импортируемые строки к существующим Entity графа знаний по
   * значению primary-колонки (имя). НЕ создаёт новых Entity (вне scope Фазы 4) —
   * только проставляет `entityId` там, где нашлось точное совпадение.
   *
   * Матч: `Entity.type ∈ resolveEntityTypes(entitySync)`, не слита (mergedIntoId
   * null), и (canonicalName == value ИЛИ value ∈ aliases) — без учёта регистра.
   *
   * Реализация: ОДИН batch-запрос всех подходящих сущностей тенанта + in-memory
   * Map по lowercased ключам (canonicalName + alias'ы). Без N+1, alias-матч
   * регистронезависимый, резолв детерминированный (первое вхождение выигрывает).
   *
   * @returns массив `entityId | null` той же длины, что и `rows`, в том же
   *   порядке (caller проставит в TableRow.entityId).
   */
  async linkRowsToEntities(args: {
    tenantId: string;
    entitySync: { type: AvailableSyncType } | null;
    primaryValues: Array<string | null>;
  }): Promise<{ entityIds: Array<string | null>; linkedCount: number }> {
    const empty = args.primaryValues.map(() => null as string | null);
    if (!args.entitySync) return { entityIds: empty, linkedCount: 0 };

    const types = resolveEntityTypes(parseEntitySync(args.entitySync));
    if (types.length === 0) return { entityIds: empty, linkedCount: 0 };

    // Собираем distinct trimmed непустые primary-значения. Если нечего искать —
    // не дёргаем БД вовсе.
    const hasAnyValue = args.primaryValues.some(
      (v) => (v ?? '').trim().length > 0,
    );
    if (!hasAnyValue) return { entityIds: empty, linkedCount: 0 };

    // ОДИН batch-запрос: все не-слитые сущности нужных типов тенанта (в MVP их
    // немного). Дальше — in-memory case-insensitive матч → убирает N+1 (#8),
    // делает alias-матч регистронезависимым (#6), детерминирует резолв (#7).
    const candidates = await this.prisma.entity.findMany({
      where: {
        tenantId: args.tenantId,
        type: { in: types as Entity['type'][] },
        mergedIntoId: null,
      },
      select: { id: true, canonicalName: true, aliases: true },
    });

    // Map по lowercased ключам: canonicalName и каждый alias → id. Первое
    // вхождение выигрывает (детерминированно по порядку выборки).
    const byLower = new Map<string, string>();
    for (const e of candidates) {
      const cn = (e.canonicalName ?? '').trim().toLowerCase();
      if (cn.length > 0 && !byLower.has(cn)) byLower.set(cn, e.id);
      for (const a of e.aliases ?? []) {
        const al = (a ?? '').trim().toLowerCase();
        if (al.length > 0 && !byLower.has(al)) byLower.set(al, e.id);
      }
    }

    const entityIds: Array<string | null> = [];
    let linkedCount = 0;
    for (const raw of args.primaryValues) {
      const value = (raw ?? '').trim();
      if (value.length === 0) {
        entityIds.push(null);
        continue;
      }
      const id = byLower.get(value.toLowerCase()) ?? null;
      entityIds.push(id);
      if (id) linkedCount++;
    }
    return { entityIds, linkedCount };
  }

  // ──────────────────────────── private ────────────────────────────────────

  /** schemaText для эмбеддинга dedup'а: `name + ' ' + col1, col2, …`. */
  private schemaToText(
    name: string,
    properties: ReadonlyArray<{ name: string }>,
  ): string {
    return `${name} ${properties.map((p) => p.name).join(', ')}`.trim();
  }

  /** Косинусная близость двух векторов одинаковой длины. */
  private cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /** Порог cosine-dedup из admin-setting (`table.import.dedup_threshold`, def 0.85). */
  private async getDedupThreshold(): Promise<number> {
    if (!this.cfg) return 0.85;
    try {
      return await this.cfg.getDynamic<number>(
        'table.import.dedup_threshold',
        undefined,
        0.85,
      );
    } catch {
      return 0.85;
    }
  }

  /**
   * Вызывает LLM (json_object) и парсит ответ Zod-схемой. Возвращает null,
   * если ответ не парсится как JSON или не проходит мягкую Zod-проверку
   * (caller решает, фатально это или нет).
   */
  private async callJson(args: {
    taskType: 'table-infer-schema' | 'table-architect-pass' | 'table-entity-check';
    tenantId: string;
    system: string;
    user: string;
  }): Promise<RawLlmSchema | null> {
    let text: string;
    try {
      const res = await this.llm.call({
        taskType: args.taskType,
        systemPrompt: args.system,
        userMessage: args.user,
        tenantId: args.tenantId,
        responseFormat: { type: 'json_object' },
        dataClass: 'internal',
        maxTokens: 2000,
      });
      text = res.text;
    } catch (err) {
      this.logger.warn(
        {
          taskType: args.taskType,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-agent: LLM call failed',
      );
      return null;
    }
    return this.parseSchemaJson(text);
  }

  /** Достаёт JSON-объект из ответа LLM (срезает возможные ```json-обёртки). */
  private parseSchemaJson(text: string): RawLlmSchema | null {
    if (!text) return null;
    let candidate = text.trim();
    // Снять markdown-fence, если модель его добавила.
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) candidate = fence[1].trim();
    // Если вокруг JSON есть лишний текст — выделим первый {...} блок.
    if (!candidate.startsWith('{')) {
      const start = candidate.indexOf('{');
      const end = candidate.lastIndexOf('}');
      if (start >= 0 && end > start) {
        candidate = candidate.slice(start, end + 1);
      }
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      return null;
    }
    const result = RawLlmSchemaZod.safeParse(parsed);
    return result.success ? result.data : null;
  }

  /**
   * Превращает «сырую» схему LLM в консистентную `InferredTableSchema`:
   *   - отбрасывает колонки без имени; невалидный type → 'text';
   *   - гарантирует ≥1 колонку;
   *   - гарантирует ровно одну isPrimary;
   *   - entitySync.type не из available → null.
   */
  private normalize(
    raw: RawLlmSchema,
    availableSyncTypes: ReadonlyArray<AvailableSyncType>,
  ): InferredTableSchema {
    const rawProps = Array.isArray(raw.properties) ? raw.properties : [];
    const properties: InferredTableSchema['properties'] = [];
    for (const p of rawProps) {
      const name = typeof p.name === 'string' ? p.name.trim() : '';
      if (!name) continue;
      const rawType = p.type as TablePropType | undefined;
      const type: TablePropType =
        rawType && ALLOWED_PROP_TYPES.has(rawType) ? rawType : 'text';
      const entry: InferredTableSchema['properties'][number] = {
        name,
        type,
        isPrimary: p.isPrimary === true,
      };
      if (p.config && typeof p.config === 'object') {
        entry.config = p.config as Record<string, unknown>;
      }
      properties.push(entry);
    }

    // Инвариант: ≥1 колонка. Если LLM не дал ни одной валидной — дефолт.
    if (properties.length === 0) {
      properties.push({ name: 'Название', type: 'text', isPrimary: true });
    }

    // Инвариант: ровно одна isPrimary.
    const primaryCount = properties.filter((p) => p.isPrimary).length;
    if (primaryCount !== 1) {
      properties.forEach((p, i) => {
        p.isPrimary = i === 0;
      });
    }

    // entitySync: только если type входит в available.
    let entitySync: InferredTableSchema['entitySync'] = null;
    const syncType = raw.entitySync?.type;
    if (
      syncType &&
      (availableSyncTypes as ReadonlyArray<string>).includes(syncType)
    ) {
      entitySync = { type: syncType as AvailableSyncType };
    }

    const name =
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : 'Новая таблица';
    const description =
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : null;
    const icon =
      typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : null;

    return { name, description, icon, entitySync, properties };
  }
}
