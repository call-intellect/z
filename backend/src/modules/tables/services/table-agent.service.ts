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

import { parseNumericLoose } from './_num.util';
import { parseEntitySync, resolveEntityTypes } from './entity-sync.util';

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

const ALL_SYNC_TYPES: readonly AvailableSyncType[] = ['org', 'person', 'meeting', 'document'];

const DRAFT_RETRY_BACKOFF_MS = 300;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const SELECT_OPTION_PALETTE = ['info', 'warning', 'success', 'danger', 'neutral'] as const;

const RawLlmSchemaZod = z.object({
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  entitySync: z.object({ type: z.string() }).nullable().optional(),
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
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

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

    const aligned = this.alignToHeaders(schema, args.headers);

    const r4 = this.reconcileTypesWithData(aligned, args.sampleRows);
    const r2 = this.completeSelectOptions(r4.schema, args.sampleRows);
    const finalSchema = r2.schema;

    this.logger.log(
      {
        tenantId: args.tenantId,
        downgraded: r4.downgraded,
        optionsAdded: r2.optionsAdded,
      },
      'table-agent: tabular post-pass',
    );
    this.logger.log(
      {
        tenantId: args.tenantId,
        source: 'tabular',
        passes: 3,
        headers: args.headers.length,
        columns: finalSchema.properties.length,
        entitySync: finalSchema.entitySync?.type ?? null,
      },
      'table-agent: схема сгенерирована из файла',
    );
    return finalSchema;
  }

  private async runThreePassPipeline(args: {
    tenantId: string;
    userPrompt: string;
  }): Promise<InferredTableSchema> {
    const availableSyncTypes = await this.getAvailableSyncTypes(args.tenantId);

    const draftPrompt = buildTableInferSchemaPrompt({
      userPrompt: args.userPrompt,
      availableSyncTypes,
      systemTableExamples: SYSTEM_TABLES_CATALOG.map((t) => ({
        systemKey: t.systemKey,
        name: t.name,
        icon: t.icon,
      })),
    });
    const draftAttempts = await this.getDraftMaxAttempts();
    let draftRaw: RawLlmSchema | null = null;
    for (let attempt = 1; attempt <= draftAttempts; attempt++) {
      draftRaw = await this.callJson({
        taskType: 'table-infer-schema',
        tenantId: args.tenantId,
        system: draftPrompt.system,
        user: draftPrompt.user,
      });
      if (draftRaw) break;
      this.logger.warn({ tenantId: args.tenantId, attempt }, 'table-agent: DRAFT pass retry');
      if (attempt < draftAttempts) await sleep(DRAFT_RETRY_BACKOFF_MS);
    }
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

    return this.normalize(entityRaw, availableSyncTypes);
  }

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

  private alignToHeaders(schema: InferredTableSchema, headers: string[]): InferredTableSchema {
    if (headers.length === 0) return schema;
    const props: InferredTableSchema['properties'] = [];
    for (let j = 0; j < headers.length; j++) {
      const fromLlm = schema.properties[j];
      if (fromLlm) {
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
    const llmPrimaryIdx = schema.properties.findIndex((p) => p.isPrimary);
    const primaryIdx = llmPrimaryIdx >= 0 && llmPrimaryIdx < props.length ? llmPrimaryIdx : 0;
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

  private reconcileTypesWithData(
    schema: InferredTableSchema,
    sampleRows: string[][],
  ): { schema: InferredTableSchema; downgraded: number } {
    let downgraded = 0;
    const properties = schema.properties.map((p, j) => {
      const vals = sampleRows.map((r) => (r[j] ?? '').trim()).filter((v) => v.length > 0);
      if (vals.length === 0) return p;
      let type: TablePropType = p.type;
      if (type === 'number' || type === 'currency' || type === 'percent') {
        const ok = vals.filter((v) => parseNumericLoose(v) !== null).length;
        if (ok / vals.length < 0.5) {
          type = 'text';
          downgraded++;
        }
      } else if (type === 'date') {
        const ok = vals.filter((v) => this.looksLikeDate(v)).length;
        if (ok / vals.length < 0.5) {
          type = 'text';
          downgraded++;
        }
      }
      if (type === 'text') {
        const long = vals.filter((v) => v.length > 80).length;
        if (long / vals.length >= 0.5) type = 'longtext';
      }
      if (type === p.type) return p;
      return { ...p, type };
    });
    return { schema: { ...schema, properties }, downgraded };
  }

  private looksLikeDate(v: string): boolean {
    return (
      /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(v) || /^\d{1,2}[./]\d{1,2}[./]\d{2,4}$/.test(v)
    );
  }

  private completeSelectOptions(
    schema: InferredTableSchema,
    sampleRows: string[][],
  ): { schema: InferredTableSchema; optionsAdded: number } {
    let optionsAdded = 0;
    const properties = schema.properties.map((p, j) => {
      if (p.type !== 'selectSingle' && p.type !== 'selectMulti' && p.type !== 'status') {
        return p;
      }
      const seenLower = new Set<string>();
      const distinct: string[] = [];
      for (const r of sampleRows) {
        const v = (r[j] ?? '').trim();
        if (!v) continue;
        const key = v.toLowerCase();
        if (seenLower.has(key)) continue;
        seenLower.add(key);
        distinct.push(v);
      }
      if (distinct.length === 0 || distinct.length > 30) return p;

      type SelectOption = { id: string; name: string; color: string };
      const cfg =
        p.config && typeof p.config === 'object'
          ? { ...(p.config as Record<string, unknown>) }
          : {};
      const rawOptions = Array.isArray((cfg as { options?: unknown }).options)
        ? ((cfg as { options?: unknown }).options as unknown[])
        : [];
      const options: SelectOption[] = rawOptions
        .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
        .map((o) => ({
          id: typeof o.id === 'string' ? o.id : '',
          name: typeof o.name === 'string' ? o.name : '',
          color: typeof o.color === 'string' ? o.color : 'neutral',
        }));
      const existingNames = new Set(
        options.map((o) => o.name.trim().toLowerCase()).filter((s) => s.length > 0),
      );
      let maxIdx = 0;
      for (const o of options) {
        const m = /^opt-(\d+)$/.exec(o.id);
        if (m) maxIdx = Math.max(maxIdx, Number(m[1]));
      }
      let paletteIdx = options.length;
      let added = 0;
      for (const v of distinct) {
        if (existingNames.has(v.toLowerCase())) continue;
        maxIdx++;
        options.push({
          id: `opt-${maxIdx}`,
          name: v,
          color: SELECT_OPTION_PALETTE[paletteIdx % SELECT_OPTION_PALETTE.length] ?? 'neutral',
        });
        existingNames.add(v.toLowerCase());
        paletteIdx++;
        added++;
      }
      if (added === 0) return p;
      optionsAdded += added;
      return { ...p, config: { ...cfg, options } };
    });
    return { schema: { ...schema, properties }, optionsAdded };
  }

  async getAvailableSyncTypes(_tenantId: string): Promise<AvailableSyncType[]> {
    return [...ALL_SYNC_TYPES];
  }

  async findSimilarTables(args: {
    tenantId: string;
    schema: InferredTableSchema;
  }): Promise<Array<{ tableId: string; name: string; cosine: number }>> {
    const proposedCols = args.schema.properties.map((p) => p.name);
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

    const cosineByTable = new Map<string, number>();
    if (this.embeddings) {
      const tableTexts = tables.map((t) =>
        this.schemaToText(
          t.name,
          t.properties.map((p) => ({ name: p.name })),
        ),
      );
      try {
        const vectors = await this.embeddings.embed([proposedText, ...tableTexts]);
        const proposedVec = vectors[0];
        if (proposedVec) {
          for (let i = 0; i < tables.length; i++) {
            const t = tables[i];
            const vec = vectors[i + 1];
            if (!t || !vec) continue;
            cosineByTable.set(t.id, this.cosine(proposedVec, vec));
          }
        }
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'table-agent: embedding для dedup недоступен — используем только Jaccard',
        );
      }
    }

    const cosineThreshold = await this.getDedupThreshold();
    const jaccardThreshold = await this.getJaccardThreshold();
    const out: Array<{ tableId: string; name: string; cosine: number }> = [];
    for (const t of tables) {
      const jac = this.colJaccard(
        proposedCols,
        t.properties.map((p) => p.name),
      );
      const cos = cosineByTable.get(t.id) ?? 0;
      const score = Math.max(cos, jac);
      if (cos >= cosineThreshold || jac >= jaccardThreshold) {
        out.push({ tableId: t.id, name: t.name, cosine: score });
      }
    }
    out.sort((a, b) => b.cosine - a.cosine);
    return out.slice(0, 3);
  }

  async linkRowsToEntities(args: {
    tenantId: string;
    entitySync: { type: AvailableSyncType } | null;
    primaryValues: Array<string | null>;
  }): Promise<{ entityIds: Array<string | null>; linkedCount: number }> {
    const empty = args.primaryValues.map(() => null as string | null);
    if (!args.entitySync) return { entityIds: empty, linkedCount: 0 };

    const types = resolveEntityTypes(parseEntitySync(args.entitySync));
    if (types.length === 0) return { entityIds: empty, linkedCount: 0 };

    const hasAnyValue = args.primaryValues.some((v) => (v ?? '').trim().length > 0);
    if (!hasAnyValue) return { entityIds: empty, linkedCount: 0 };

    const candidates = await this.prisma.entity.findMany({
      where: {
        tenantId: args.tenantId,
        type: { in: types as Entity['type'][] },
        mergedIntoId: null,
      },
      select: { id: true, canonicalName: true, aliases: true },
    });

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

  private schemaToText(name: string, properties: ReadonlyArray<{ name: string }>): string {
    return `${name} ${properties.map((p) => p.name).join(', ')}`.trim();
  }

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

  private async getDedupThreshold(): Promise<number> {
    if (!this.cfg) return 0.85;
    try {
      return await this.cfg.getDynamic<number>('table.import.dedup_threshold', undefined, 0.85);
    } catch {
      return 0.85;
    }
  }

  private async getJaccardThreshold(): Promise<number> {
    if (!this.cfg) return 0.6;
    try {
      const n = await this.cfg.getDynamic<number>('table.import.dedup_col_jaccard', undefined, 0.6);
      return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.6;
    } catch {
      return 0.6;
    }
  }

  private colJaccard(aNames: string[], bNames: string[]): number {
    const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
    const a = new Set(aNames.map(norm).filter((s) => s.length > 0));
    const b = new Set(bNames.map(norm).filter((s) => s.length > 0));
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  private async getDraftMaxAttempts(): Promise<number> {
    if (!this.cfg) return 3;
    try {
      const n = await this.cfg.getDynamic<number>('table.agent.draft_max_attempts', undefined, 3);
      return Number.isFinite(n) && n >= 1 && n <= 5 ? Math.floor(n) : 3;
    } catch {
      return 3;
    }
  }

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

  private parseSchemaJson(text: string): RawLlmSchema | null {
    if (!text) return null;
    let candidate = text.trim();
    const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) candidate = fence[1].trim();
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
      const type: TablePropType = rawType && ALLOWED_PROP_TYPES.has(rawType) ? rawType : 'text';
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

    if (properties.length === 0) {
      properties.push({ name: 'Название', type: 'text', isPrimary: true });
    }

    const primaryCount = properties.filter((p) => p.isPrimary).length;
    if (primaryCount !== 1) {
      properties.forEach((p, i) => {
        p.isPrimary = i === 0;
      });
    }

    let entitySync: InferredTableSchema['entitySync'] = null;
    const syncType = raw.entitySync?.type;
    if (syncType && (availableSyncTypes as ReadonlyArray<string>).includes(syncType)) {
      entitySync = { type: syncType as AvailableSyncType };
    }

    const name =
      typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Новая таблица';
    const description =
      typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : null;
    const icon = typeof raw.icon === 'string' && raw.icon.trim() ? raw.icon.trim() : null;

    return { name, description, icon, entitySync, properties };
  }
}
