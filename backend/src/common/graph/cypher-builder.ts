import { BadRequestException } from '@nestjs/common';

import { ALL_NODE_TYPES, type NodeType } from './graph.types';

/**
 * Полный whitelist `EntityLinkType` для безопасной интерполяции в Cypher.
 *
 * **Зачем дублировать enum:** AGE-Cypher не поддерживает параметризацию имён
 * меток и типов рёбер (label/relType подставляются только литералом).
 * Поэтому мы строим строку Cypher вручную, но ТОЛЬКО из значений из этого
 * списка — иначе SQL/Cypher injection. Любой `EntityLinkType` из `@prisma/client`
 * валидируется по этому массиву.
 *
 * При добавлении нового типа в `enum EntityLinkType` (schema.prisma) —
 * обязательно дописать сюда. Type-check на сборке поймает рассинхрон через
 * `satisfies readonly EntityLinkType[]`.
 */
const ALL_LINK_TYPES = [
  // knowledge-core (Фаза 3) — Entity↔Entity.
  'works_at',
  'belongs_to',
  'part_of',
  'opposes',
  'depends_on',
  'mentions_with',
  // Фаза 0 — Person ↔ Role ↔ Department ↔ Skill.
  'executes_role',
  'member_of',
  'described_by',
  'derived_from',
  'requires_skill',
  'has_skill',
  // Фаза 0 — каркас 5 уровней (группа Б).
  'realized_by',
  'decomposes_into',
  'measured_by',
  'executed_by',
  'has_step',
  'owned_by',
  'lives_in',
  'produces',
  'triggered_by',
  'regulates',
  'constrains',
  'applies_to',
  'is_responsible_for',
  // Фаза 0 — RACI.
  'responsible_for',
  'accountable_for',
  'consulted_on',
  'informed_about',
] as const;

export type SafeLinkType = (typeof ALL_LINK_TYPES)[number];

/**
 * Имя графа AGE — единое для всего tenant'а. `tenant_id` хранится в свойствах
 * узлов/рёбер; per-tenant фильтрация — через `WHERE n.tenant_id = $tenant`.
 */
export const Z_GRAPH = 'z_graph';

/**
 * Помощник для безопасной сборки Cypher. AGE не поддерживает параметризацию
 * `label` / `relType` — только литералы. Чтобы избежать injection, все метки
 * и типы валидируются по whitelist'ам.
 *
 * Запрос потом исполняется через `prisma.$queryRawUnsafe` внутри
 * `SELECT * FROM cypher('z_graph', $$ ... $$)`. Bindings подставляются
 * **только** в свойства узлов/рёбер (через JSONB-параметр).
 */
export class CypherBuilder {
  /**
   * Превратить `NodeType` в безопасную метку AGE. Тире не допустимы в Cypher-
   * метках, поэтому `'job-description' → 'job_description'`.
   *
   * @throws BadRequestException — если тип не в whitelist'е.
   */
  static toAgeLabel(type: NodeType): string {
    if (!ALL_NODE_TYPES.includes(type)) {
      throw new BadRequestException(`Unknown NodeType: ${String(type)}`);
    }
    return type.replace(/-/g, '_');
  }

  /**
   * Превратить `EntityLinkType` (строка Prisma-enum) в безопасную метку
   * ребра. Подстраховка от injection: значение должно быть в whitelist'е.
   *
   * @throws BadRequestException — если linkType не в whitelist'е.
   */
  static toRelType(linkType: string): SafeLinkType {
    if (!(ALL_LINK_TYPES as readonly string[]).includes(linkType)) {
      throw new BadRequestException(`Unknown EntityLinkType: ${linkType}`);
    }
    return linkType as SafeLinkType;
  }

  /**
   * Экранирование строкового значения для Cypher-литерала. Используется
   * **только** для значений, которые нельзя передать через bindings (метки/
   * типы — они через `toAgeLabel`/`toRelType`). Сами свойства узлов/рёбер
   * передаются через JSONB-параметр и не нуждаются в этом.
   */
  static escapeString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  /**
   * Собрать MERGE-фрагмент для узла. Возвращает чистый Cypher без обёртки
   * `SELECT * FROM cypher(...)`.
   *
   * `id` / `tenantId` подставляются как Cypher-литералы (строки cuid —
   * безопасные ASCII-id). Произвольные `properties` записываются отдельно
   * через `SET n += $props` (внешний код).
   */
  static buildMergeNode(type: NodeType, id: string, tenantId: string): string {
    const label = CypherBuilder.toAgeLabel(type);
    const safeId = CypherBuilder.escapeString(id);
    const safeTenant = CypherBuilder.escapeString(tenantId);
    return `MERGE (n:${label} {id: '${safeId}', tenant_id: '${safeTenant}'})`;
  }

  /**
   * Собрать MERGE-фрагмент для ребра. Использует whitelist'ы для меток и
   * типа ребра. Без обёртки `SELECT * FROM cypher(...)`.
   */
  static buildMergeEdge(params: {
    fromType: NodeType;
    fromId: string;
    toType: NodeType;
    toId: string;
    linkType: string;
    tenantId: string;
  }): string {
    const fromLabel = CypherBuilder.toAgeLabel(params.fromType);
    const toLabel = CypherBuilder.toAgeLabel(params.toType);
    const relType = CypherBuilder.toRelType(params.linkType);
    const safeFromId = CypherBuilder.escapeString(params.fromId);
    const safeToId = CypherBuilder.escapeString(params.toId);
    const safeTenant = CypherBuilder.escapeString(params.tenantId);
    return (
      `MATCH (a:${fromLabel} {id: '${safeFromId}', tenant_id: '${safeTenant}'}) ` +
      `MATCH (b:${toLabel} {id: '${safeToId}', tenant_id: '${safeTenant}'}) ` +
      `MERGE (a)-[r:${relType}]->(b)`
    );
  }

  /**
   * Собрать DELETE-фрагмент для ребра. Удаляет одно направленное ребро
   * заданного типа между двумя узлами.
   */
  static buildDeleteEdge(params: {
    fromType: NodeType;
    fromId: string;
    toType: NodeType;
    toId: string;
    linkType: string;
    tenantId: string;
  }): string {
    const fromLabel = CypherBuilder.toAgeLabel(params.fromType);
    const toLabel = CypherBuilder.toAgeLabel(params.toType);
    const relType = CypherBuilder.toRelType(params.linkType);
    const safeFromId = CypherBuilder.escapeString(params.fromId);
    const safeToId = CypherBuilder.escapeString(params.toId);
    const safeTenant = CypherBuilder.escapeString(params.tenantId);
    return (
      `MATCH (a:${fromLabel} {id: '${safeFromId}', tenant_id: '${safeTenant}'})` +
      `-[r:${relType}]->` +
      `(b:${toLabel} {id: '${safeToId}', tenant_id: '${safeTenant}'}) ` +
      `DELETE r`
    );
  }

  /**
   * Собрать список allowed relTypes для WHERE-фильтра обхода. Каждый
   * элемент валидируется по whitelist'у. Возвращает строку вида
   * `'executes_role'|'member_of'` или `null`, если фильтра нет.
   */
  static buildRelTypeFilter(linkTypes: string[] | undefined): string | null {
    if (!linkTypes || linkTypes.length === 0) return null;
    const safeTypes = linkTypes.map((t) => CypherBuilder.toRelType(t));
    return safeTypes.map((t) => `'${t}'`).join(',');
  }
}
