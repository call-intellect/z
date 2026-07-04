import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TablePropType } from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { buildTableSemanticFilterPrompt } from '../../ai/services/prompts/table-semantic-filter.prompt';
import {
  rowMatchesConditions,
  type TableFilterCondition,
  TableFilterConditionsSchema,
  validateFilters,
} from '../dto/table-filter.dto';

@Injectable()
export class TableSemanticFilterService {
  private readonly logger = new Logger(TableSemanticFilterService.name);

  private static readonly CACHE_TTL_SEC = 604_800;

  private static readonly LlmResultSchema = z.object({
    filters: TableFilterConditionsSchema.optional(),
  });

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  async parseSemanticFilter(args: {
    tenantId: string;
    tableId: string;
    nlQuery: string;
  }): Promise<{ filters: TableFilterCondition[]; cached: boolean }> {
    const table = await this.prisma.table.findUnique({
      where: { id: args.tableId },
      select: {
        tenantId: true,
        deletedAt: true,
        properties: { select: { id: true, name: true, type: true } },
      },
    });
    if (!table || table.deletedAt || table.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'table_not_found', message: 'Таблица не найдена' },
      });
    }
    const properties = table.properties;

    const normalized = this.normalizeQuery(args.nlQuery);
    const cacheKey = this.cacheKey(args.tableId, normalized);
    const cachedFilters = await this.readCache(cacheKey, properties);
    if (cachedFilters) {
      return { filters: cachedFilters, cached: true };
    }

    const rawFilters = await this.callLlm({
      tenantId: args.tenantId,
      nlQuery: args.nlQuery,
      properties,
    });
    if (rawFilters === null) {
      return { filters: [], cached: false };
    }

    const filters = validateFilters(rawFilters, properties);

    try {
      await this.redis.client.set(
        cacheKey,
        JSON.stringify(filters),
        'EX',
        TableSemanticFilterService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'table-semantic-filter: не удалось записать кэш (не критично)',
      );
    }

    return { filters, cached: false };
  }

  async applyFilterToRows(args: {
    tenantId: string;
    tableId: string;
    conditions: ReadonlyArray<TableFilterCondition>;
    limit: number;
  }): Promise<Array<{ id: string; entityId: string | null; cells: Record<string, unknown> }>> {
    const cap = Math.max(0, Math.floor(args.limit));
    if (cap === 0) return [];
    try {
      const fetchCap = Math.min(2000, Math.max(cap * 10, cap));
      const rows = await this.prisma.tableRow.findMany({
        where: {
          tableId: args.tableId,
          tenantId: args.tenantId,
          status: 'active',
          archivedAt: null,
          deletedAt: null,
        },
        select: { id: true, entityId: true, cells: true },
        orderBy: { order: 'asc' },
        take: fetchCap,
      });

      const out: Array<{
        id: string;
        entityId: string | null;
        cells: Record<string, unknown>;
      }> = [];
      for (const row of rows) {
        const cells = this.asCells(row.cells);
        if (!rowMatchesConditions(cells, args.conditions)) continue;
        out.push({ id: row.id, entityId: row.entityId ?? null, cells });
        if (out.length >= cap) break;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        {
          tableId: args.tableId,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-semantic-filter.applyFilterToRows: сбой — возвращаем [] (fail-safe)',
      );
      return [];
    }
  }

  private asCells(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  private normalizeQuery(q: string): string {
    return q.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private cacheKey(tableId: string, normalizedQuery: string): string {
    const hash = createHash('sha1').update(normalizedQuery).digest('hex');
    return `table:semfilter:${tableId}:${hash}`;
  }

  private async readCache(
    cacheKey: string,
    properties: ReadonlyArray<{ id: string; type: TablePropType }>,
  ): Promise<TableFilterCondition[] | null> {
    let raw: string | null;
    try {
      raw = await this.redis.client.get(cacheKey);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'table-semantic-filter: не удалось прочитать кэш',
      );
      return null;
    }
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = TableFilterConditionsSchema.safeParse(parsed);
    if (!result.success) return null;
    const revalidated = validateFilters(result.data, properties);
    if (revalidated.length === 0) return null;
    return revalidated;
  }

  private async callLlm(args: {
    tenantId: string;
    nlQuery: string;
    properties: ReadonlyArray<{ id: string; name: string; type: string }>;
  }): Promise<TableFilterCondition[] | null> {
    const today = new Date().toISOString().slice(0, 10);
    const prompt = buildTableSemanticFilterPrompt({
      properties: args.properties.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
      })),
      nlQuery: args.nlQuery,
      today,
    });

    let text: string;
    try {
      const res = await this.llm.call({
        taskType: 'table-semantic-filter',
        systemPrompt: prompt.system,
        userMessage: prompt.user,
        tenantId: args.tenantId,
        responseFormat: { type: 'json_object' },
        dataClass: 'internal',
        maxTokens: 1200,
      });
      text = res.text;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'table-semantic-filter: LLM call failed',
      );
      return null;
    }
    return this.parseLlmJson(text);
  }

  private parseLlmJson(text: string): TableFilterCondition[] | null {
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
    const result = TableSemanticFilterService.LlmResultSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data.filters ?? [];
  }
}
