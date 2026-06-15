import { createHash } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * Smart-tables auto-creation (2026-06-02, Фаза 5) — NL Saved Views.
 *
 * Конвертирует NL-запрос пользователя («покажи клиентов, кому месяц никто не
 * писал») в JSON-фильтр таблицы:
 *   1. Загружает таблицу (проверка tenantId) + её колонки (id, name, type).
 *   2. Смотрит Redis-кэш по (tableId, normalizedQuery). Hit → возвращает сразу.
 *   3. Miss → LLM (`table-semantic-filter`, DeepSeek V4 Flash, json_object) →
 *      парс JSON → `validateFilters` против реальной схемы колонок → кэш 7 дней.
 *
 * Применяет фильтр фронт клиент-сайд (по семантике операторов из table-filter.dto).
 *
 * Отказоустойчивость: любая ошибка LLM/парсинга НЕ валит запрос — логируем и
 * возвращаем пустой фильтр (`{ filters: [], cached: false }`), что на фронте
 * означает «не удалось понять запрос, показываем все строки».
 *
 * Cache-friendly: prompt-builder держит стабильный SYSTEM (каталог операторов +
 * правила), переменные данные (колонки + дата + запрос) — в USER.
 */
@Injectable()
export class TableSemanticFilterService {
  private readonly logger = new Logger(TableSemanticFilterService.name);

  /** TTL кэша фильтра — 7 дней. */
  private static readonly CACHE_TTL_SEC = 604_800;

  /** Zod-схема ответа LLM (мягкая — жёсткую валидацию делает validateFilters). */
  private static readonly LlmResultSchema = z.object({
    filters: TableFilterConditionsSchema.optional(),
  });

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * Главный метод. Возвращает очищенный (валидный против схемы) набор условий
   * + флаг попадания в кэш.
   */
  async parseSemanticFilter(args: {
    tenantId: string;
    tableId: string;
    nlQuery: string;
  }): Promise<{ filters: TableFilterCondition[]; cached: boolean }> {
    // ── 1. Таблица + колонки (с проверкой tenant) ─────────────────────────
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

    // ── 2. Кэш по (tableId, normalizedQuery) ──────────────────────────────
    const normalized = this.normalizeQuery(args.nlQuery);
    const cacheKey = this.cacheKey(args.tableId, normalized);
    const cachedFilters = await this.readCache(cacheKey, properties);
    if (cachedFilters) {
      return { filters: cachedFilters, cached: true };
    }

    // ── 3. LLM → парс → валидация ─────────────────────────────────────────
    const rawFilters = await this.callLlm({
      tenantId: args.tenantId,
      nlQuery: args.nlQuery,
      properties,
    });
    // LLM упал / вернул мусор → пустой фильтр, запрос НЕ валим. Пустой результат
    // не кэшируем (вдруг это была временная ошибка провайдера).
    if (rawFilters === null) {
      return { filters: [], cached: false };
    }

    const filters = validateFilters(rawFilters, properties);

    // ── 4. Кэш на 7 дней ──────────────────────────────────────────────────
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

  /**
   * Chat-v2 как параллельный источник (ТЗ 2026-06-15 §7, ЧАСТЬ B) — применяет
   * набор условий фильтра к строкам таблицы НА СЕРВЕРЕ и возвращает совпавшие
   * строки (для подмешивания в контекст AI-чата).
   *
   * Раньше фильтр применялся только на фронте (клиент-сайд). chat_v2 не может
   * полагаться на фронт → считаем здесь. Оператор eq/in/empty можно было бы
   * протолкнуть в JSONB-предикат (GIN `table_row_cells_gin`), но строк/таблиц у
   * тенанта немного, а остальные операторы (gt/lt/before/after/older_than/
   * contains) всё равно требуют TS-семантики → берём живые строки таблицы по
   * `tableId` и фильтруем в TS через `rowMatchesConditions` (единый источник
   * семантики операторов с фронтом, см. table-filter.dto).
   *
   * `conditions` ожидаются УЖЕ валидированными (`validateFilters`) — но даже
   * сырые не опасны: `rowMatchesConditions` молча не-матчит кривые условия.
   * Пустой `conditions` → строка проходит (нет фильтра) → вернём первые `limit`
   * живых строк таблицы.
   *
   * Fail-safe (R-INV): любая ошибка БД/приведения → лог + `[]` (ветка таблиц
   * НЕ должна валить графовый ответ chat_v2).
   */
  async applyFilterToRows(args: {
    tenantId: string;
    tableId: string;
    conditions: ReadonlyArray<TableFilterCondition>;
    limit: number;
  }): Promise<
    Array<{ id: string; entityId: string | null; cells: Record<string, unknown> }>
  > {
    const cap = Math.max(0, Math.floor(args.limit));
    if (cap === 0) return [];
    try {
      // Живые строки таблицы (не архив / не soft-deleted), под tenant-scope.
      // Берём с запасом (cap * 10, но не более 2000): фильтр в TS отсеет лишнее,
      // а ограничивать выборку ДО фильтра нельзя (потеряем релевантные строки).
      const fetchCap = Math.min(2000, Math.max(cap * 10, cap));
      const rows = await this.prisma.tableRow.findMany({
        where: {
          tableId: args.tableId,
          tenantId: args.tenantId,
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

  // ──────────────────────────── private ────────────────────────────────────

  /** Безопасное приведение JSONB `cells` к `Record<string, unknown>`. */
  private asCells(raw: unknown): Record<string, unknown> {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw as Record<string, unknown>;
    }
    return {};
  }

  /** Нормализация запроса для ключа кэша: trim + lower + схлопывание пробелов. */
  private normalizeQuery(q: string): string {
    return q.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Redis-ключ `table:semfilter:{tableId}:{sha1(normalizedQuery)}`. */
  private cacheKey(tableId: string, normalizedQuery: string): string {
    const hash = createHash('sha1').update(normalizedQuery).digest('hex');
    return `table:semfilter:${tableId}:${hash}`;
  }

  /**
   * Читает кэш: распарсенные условия → повторная валидация против актуальной
   * схемы (на случай если колонки таблицы изменились после кэширования).
   * Возвращает null при miss / ошибке чтения / битом JSON.
   */
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
    // Перевалидируем под актуальную схему — кэш мог пережить изменение колонок.
    const revalidated = validateFilters(result.data, properties);
    // Если после ревалидации не осталось ни одного условия (кэш протух: колонки
    // переименованы/удалены, или там лежал пустой фильтр) — НЕ выдаём это как
    // успешный cache-hit. Возвращаем null, чтобы parseSemanticFilter пошёл по
    // LLM-пути, а не вернул ложный `{ filters: [], cached: true }`.
    if (revalidated.length === 0) return null;
    return revalidated;
  }

  /**
   * Вызывает LLM (json_object) и парсит ответ. Возвращает «сырые» условия
   * (ещё НЕ валидированные против схемы) или null при ошибке/мусоре.
   */
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

  /** Достаёт `{ filters }` из ответа LLM (срезает markdown-обёртки). */
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
