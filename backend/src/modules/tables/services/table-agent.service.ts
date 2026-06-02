import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { TablePropType } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { buildTableArchitectPassPrompt } from '../../ai/services/prompts/table-architect-pass.prompt';
import { buildTableEntityCheckPrompt } from '../../ai/services/prompts/table-entity-check.prompt';
import { buildTableInferSchemaPrompt } from '../../ai/services/prompts/table-infer-schema.prompt';
import { SYSTEM_TABLES_CATALOG } from '../templates/system-tables.catalog';

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
    const result = this.normalize(entityRaw, availableSyncTypes);
    this.logger.log(
      {
        tenantId: args.tenantId,
        passes: 3,
        columns: result.properties.length,
        entitySync: result.entitySync?.type ?? null,
      },
      'table-agent: схема сгенерирована',
    );
    return result;
  }

  /**
   * Доступные entitySync-типы тенанта. Фаза 1 — возвращаем все 4.
   * TODO Фаза 2: учитывать фактические EntityType, заведённые в тенанте
   * (фильтровать список по реальным сущностям графа знаний).
   */
  async getAvailableSyncTypes(_tenantId: string): Promise<AvailableSyncType[]> {
    return [...ALL_SYNC_TYPES];
  }

  // ──────────────────────────── private ────────────────────────────────────

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
