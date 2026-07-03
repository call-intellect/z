import { BadRequestException } from '@nestjs/common';

import { ALL_NODE_TYPES, type NodeType } from './graph.types';

const ALL_LINK_TYPES = [
  'works_at',
  'belongs_to',
  'part_of',
  'opposes',
  'depends_on',
  'mentions_with',
  'executes_role',
  'member_of',
  'described_by',
  'derived_from',
  'requires_skill',
  'has_skill',
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
  'responsible_for',
  'accountable_for',
  'consulted_on',
  'informed_about',
] as const;

export type SafeLinkType = (typeof ALL_LINK_TYPES)[number];

export const Z_GRAPH = 'z_graph';

export class CypherBuilder {
  static toAgeLabel(type: NodeType): string {
    if (!ALL_NODE_TYPES.includes(type)) {
      throw new BadRequestException(`Unknown NodeType: ${String(type)}`);
    }
    return type.replace(/-/g, '_');
  }

  static toRelType(linkType: string): SafeLinkType {
    if (!(ALL_LINK_TYPES as readonly string[]).includes(linkType)) {
      throw new BadRequestException(`Unknown EntityLinkType: ${linkType}`);
    }
    return linkType as SafeLinkType;
  }

  static escapeString(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  static dollarQuote(cypher: string): string {
    let tag = 'cypher';
    while (cypher.includes(`$${tag}$`)) {
      tag = `${tag}x`;
    }
    return `$${tag}$ ${cypher} $${tag}$`;
  }

  static buildMergeNode(type: NodeType, id: string, tenantId: string): string {
    const label = CypherBuilder.toAgeLabel(type);
    const safeId = CypherBuilder.escapeString(id);
    const safeTenant = CypherBuilder.escapeString(tenantId);
    return `MERGE (n:${label} {id: '${safeId}', tenant_id: '${safeTenant}'})`;
  }

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

  static buildRelTypeFilter(linkTypes: string[] | undefined): string | null {
    if (!linkTypes || linkTypes.length === 0) return null;
    const safeTypes = linkTypes.map((t) => CypherBuilder.toRelType(t));
    return safeTypes.map((t) => `'${t}'`).join(',');
  }
}
